import type { DisconnectReason } from 'livekit-client';
import { vi } from 'vitest';

import {
  createAudioTrack,
  createLocalParticipant,
  createRemoteParticipant,
  type FakeRemoteParticipant,
} from './fake-media.js';

// This module backs the livekit-client mock, so it reads the real enum to avoid a cycle.
const { DisconnectReason: REASONS } =
  await vi.importActual<typeof import('livekit-client')>('livekit-client');

type Handler = (...arguments_: unknown[]) => void;

export interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  return { promise, resolve, reject };
}

export const behavior = {
  canChooseSpeaker: true,
  connect: (): Promise<void> => Promise.resolve(),
  switchDevice: (
    _kind: MediaDeviceKind,
    _deviceId: string,
    _exact: boolean,
  ): Promise<boolean | void> => Promise.resolve(),
  microphone: (_deviceId: string): Promise<boolean | void> => Promise.resolve(),
  agent: 'present' as 'present' | 'later',
  agentState: 'listening' as string | undefined,
  agentTracks: 1,
};

export class FakeRoom {
  static readonly instances: FakeRoom[] = [];
  readonly listeners = new Map<string, Set<Handler>>();
  readonly remoteParticipants = new Map<string, FakeRemoteParticipant>();
  readonly localParticipant = createLocalParticipant(
    deviceId => behavior.microphone(deviceId),
    deviceId => {
      this.activeDevices.set('audioinput', deviceId);
      this.emit('activeDeviceChanged', 'audioinput', deviceId);
    },
  );

  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'disconnected';
  listenersAtDisconnect: number | undefined;
  #disconnected = deferred<never>();

  constructor(readonly options: unknown) {
    FakeRoom.instances.push(this);
    this.#disconnected.promise.catch(() => undefined);
  }

  canPlaybackAudio = true;
  readonly activeDevices = new Map<MediaDeviceKind, string>();
  readonly textStreamHandlers = new Map<string, Handler>();

  startAudio = vi.fn(() => Promise.resolve());

  registerTextStreamHandler = vi.fn((topic: string, handler: Handler) => {
    if (this.textStreamHandlers.has(topic)) throw new Error(`handler for ${topic} already set`);
    this.textStreamHandlers.set(topic, handler);
  });

  unregisterTextStreamHandler = vi.fn((topic: string) => {
    this.textStreamHandlers.delete(topic);
  });

  getActiveDevice = vi.fn((kind: MediaDeviceKind) => this.activeDevices.get(kind));

  switchActiveDevice = vi.fn(async (kind: MediaDeviceKind, deviceId: string, exact = true) => {
    const track = kind === 'audioinput' ? this.localParticipant.microphone?.track : undefined;

    if (track) track.mediaStreamTrack.readyState = 'ended';
    const isChosenDevice = (await behavior.switchDevice(kind, deviceId, exact)) ?? true;

    if (track) track.mediaStreamTrack.readyState = 'live';
    this.activeDevices.set(kind, isChosenDevice ? deviceId : 'fallback');
    this.emit('activeDeviceChanged', kind, this.activeDevices.get(kind));

    return isChosenDevice;
  });

  connect = vi.fn(async (_url: string, _token: string, _options?: unknown) => {
    this.state = 'connecting';
    await Promise.race([behavior.connect(), this.#disconnected.promise]);
    this.state = 'connected';
    if (behavior.agent === 'present') this.addAgent();
  });

  // Like LiveKit, a client disconnect also emits Disconnected, so a listener left behind would run.
  disconnect = vi.fn(async () => {
    this.listenersAtDisconnect = this.listenerCount();
    this.state = 'disconnected';
    this.#disconnected.reject(new Error('disconnected during connect'));
    this.emit('disconnected', REASONS.CLIENT_INITIATED);
  });

  on(event: string, handler: Handler): this {
    let set = this.listeners.get(event);

    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }

    set.add(handler);

    return this;
  }

  off(event: string, handler: Handler): this {
    this.listeners.get(event)?.delete(handler);

    return this;
  }

  emit(event: string, ...arguments_: unknown[]): void {
    // eslint-disable-next-line unicorn/no-useless-spread -- snapshot: a handler may call off()
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler(...arguments_);
  }

  listenerCount(): number {
    let count = 0;

    for (const set of this.listeners.values()) count += set.size;

    return count;
  }

  addAgent(identity = 'agent'): FakeRemoteParticipant {
    const agent = createRemoteParticipant(identity, true);

    if (behavior.agentState) agent.attributes['lk.agent.state'] = behavior.agentState;
    this.remoteParticipants.set(identity, agent);
    this.emit('participantConnected', agent);

    for (let index = 0; index < behavior.agentTracks; index++) {
      const track = createAudioTrack();

      agent.trackPublications.set(`TR_${index}`, { track });
      this.emit('trackSubscribed', track, {}, agent);
    }

    return agent;
  }

  addHuman(identity = 'someone'): FakeRemoteParticipant {
    const participant = createRemoteParticipant(identity, false);

    this.remoteParticipants.set(identity, participant);
    this.emit('participantConnected', participant);

    return participant;
  }

  removeParticipant(identity: string, reason?: DisconnectReason): void {
    const participant = this.remoteParticipants.get(identity);

    this.remoteParticipants.delete(identity);
    this.emit('participantDisconnected', participant, reason);
  }

  setAttributes(identity: string, attributes: Record<string, string>): void {
    const participant = this.remoteParticipants.get(identity);

    if (!participant) throw new Error(`no participant ${identity}`);
    participant.attributes = { ...participant.attributes, ...attributes };
    this.emit('participantAttributesChanged', attributes, participant);
  }

  streamText(stream: unknown, identity: string): void {
    const handler = this.textStreamHandlers.get('lk.transcription');

    if (!handler) throw new Error('no lk.transcription handler');
    handler(stream, { identity });
  }

  setPlayback(canPlay: boolean): void {
    this.canPlaybackAudio = canPlay;
    this.emit('audioPlaybackChanged', canPlay);
  }

  serverDisconnect(reason?: number): void {
    this.state = 'disconnected';
    this.emit('disconnected', reason);
  }
}

export function audioElements(): number {
  return document.querySelectorAll('audio').length;
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

export function lastRoom(): FakeRoom {
  const room = FakeRoom.instances.at(-1);

  if (!room) throw new Error('no room created');

  return room;
}

export function resetBehavior(): void {
  behavior.canChooseSpeaker = true;
  behavior.switchDevice = () => Promise.resolve();
  behavior.connect = () => Promise.resolve();
  behavior.microphone = () => Promise.resolve();
  behavior.agent = 'present';
  behavior.agentState = 'listening';
  behavior.agentTracks = 1;
  FakeRoom.instances.length = 0;
}
