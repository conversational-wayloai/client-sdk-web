import {
  Room,
  type RoomConnectOptions,
  RoomEvent,
  type RoomEventCallbacks,
  Track,
} from 'livekit-client';

import { waitForAgent } from './agent.js';
import { Emitter } from './emitter.js';
import { WayloVoiceError } from './errors.js';
import { toConnectError, toMicrophoneError, toWayloVoiceError } from './livekit-errors.js';
import { RemoteAudio } from './remote-audio.js';
import { isSessionExpired, requireSession, type WebSessionBootstrap } from './session.js';

type CallState = 'active' | 'failed' | 'idle' | 'starting' | 'stopped' | 'stopping';

interface CallEvents extends Record<string, unknown> {
  state: CallState;
}

interface CallInspection {
  readonly error: WayloVoiceError | undefined;
  onState(listener: (state: CallState) => void): () => void;
  readonly state: CallState;
}

export interface WayloVoiceOptions {
  /** How long `start()` waits for the agent to join before failing with `agent_timeout`. Default 20 s. */
  agentTimeoutMs?: number;
}

const DEFAULT_AGENT_TIMEOUT_MS = 20_000;

let inspectInternals: (call: WayloVoice) => CallInspection;

/**
 * One voice call. Single use: after it ends, create a new `WayloVoice` for the next call. It does
 * nothing until `start()`, so it is safe to create on page load.
 */
export class WayloVoice {
  static {
    inspectInternals = call => ({
      get error() {
        return call.#error;
      },
      onState: listener => call.#emitter.on('state', listener),
      get state() {
        return call.#state;
      },
    });
  }

  readonly #agentTimeoutMs: number;
  readonly #audio = new RemoteAudio();
  readonly #emitter = new Emitter<CallEvents>();
  readonly #roomListenerRemovers: (() => void)[] = [];
  #state: CallState = 'idle';
  #error: WayloVoiceError | undefined;
  #room: Room | undefined;
  #stopPromise: Promise<void> | undefined;
  #releasePromise: Promise<void> | undefined;

  /** Throws a `RangeError` for an `agentTimeoutMs` that is not a finite number above 0. */
  constructor(options: WayloVoiceOptions = {}) {
    this.#agentTimeoutMs = requireAgentTimeoutMs(options.agentTimeoutMs);
  }

  /**
   * Connects to the room, turns on the microphone and resolves once the agent has joined.
   * Call it from a click handler so the browser lets the agent's audio play. Rejects with a
   * `WayloVoiceError`; a second call rejects with `already_started`.
   */
  start(session: WebSessionBootstrap): Promise<void> {
    if (this.#state !== 'idle') return Promise.reject(new WayloVoiceError('already_started'));
    this.#setState('starting');

    return this.#startCall(session);
  }

  /** Hangs up an active call and releases the room, microphone and audio elements. */
  async stop(): Promise<void> {
    await this.#stopOnce();
    this.#room = undefined;
  }

  #stopOnce(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;

    if (this.#state !== 'active') return this.#releasePromise ?? Promise.resolve();

    this.#stopPromise = (async () => {
      this.#setState('stopping');
      await this.#releaseRoom();
      this.#setState('stopped');
    })();

    return this.#stopPromise;
  }

  async #startCall(input: WebSessionBootstrap): Promise<void> {
    let secrets: string[] = [];

    try {
      const session = requireSession(input);

      secrets = secretsFrom(session);
      if (isSessionExpired(session)) throw new WayloVoiceError('session_expired');

      // Audio-only call: adaptive stream and dynacast only manage video layers.
      const room = new Room({ adaptiveStream: false, dynacast: false });

      this.#room = room;
      // Runs before any await so it still counts as the caller's click gesture for autoplay.
      room.startAudio().catch(() => undefined);
      this.#listenToRoom(room);

      await this.#connect(room, session, secrets);
      await this.#enableMicrophone(room, secrets);

      this.#attachSubscribedAudio(room);
      await waitForAgent(room, this.#agentTimeoutMs);

      this.#setState('active');
    } catch (error) {
      const failure = toWayloVoiceError(error, secrets);

      await this.#fail(failure);
      throw failure;
    }
  }

  async #connect(
    room: Room,
    session: WebSessionBootstrap,
    secrets: readonly string[],
  ): Promise<void> {
    // LiveKit advertises no relay here; the issued TURN is the only path through symmetric NAT.
    const options: RoomConnectOptions = session.turn
      ? { rtcConfig: { iceServers: [session.turn], iceTransportPolicy: 'relay' } }
      : {};

    try {
      await room.connect(session.livekitUrl, session.participantToken, options);
    } catch (error) {
      throw toConnectError(error, secrets);
    }
  }

  async #enableMicrophone(room: Room, secrets: readonly string[]): Promise<void> {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (error) {
      throw toMicrophoneError(error, secrets);
    }
  }

  #attachSubscribedAudio(room: Room): void {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) this.#audio.attach(publication.track);
      }
    }
  }

  #listenToRoom(room: Room): void {
    this.#addRoomListener(room, RoomEvent.TrackSubscribed, track => {
      if (this.#isLive()) this.#audio.attach(track);
    });
    this.#addRoomListener(room, RoomEvent.TrackUnsubscribed, track => {
      this.#audio.detach(track);
    });
  }

  #addRoomListener<E extends keyof RoomEventCallbacks>(
    room: Room,
    event: E,
    handler: RoomEventCallbacks[E],
  ): void {
    room.on(event, handler);
    this.#roomListenerRemovers.push(() => room.off(event, handler));
  }

  async #fail(error: WayloVoiceError): Promise<void> {
    this.#error = error;
    if (this.#isLive()) this.#setState('failed');
    await this.#releaseRoom();
  }

  #releaseRoom(): Promise<void> {
    this.#releasePromise ??= this.#disconnectRoom();

    return this.#releasePromise;
  }

  async #disconnectRoom(): Promise<void> {
    const room = this.#room;

    if (!room) return;
    this.#audio.clear();

    for (const removeListener of this.#roomListenerRemovers.splice(0)) removeListener();

    room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.stop();
    await room.disconnect().catch(() => undefined);
  }

  #isLive(): boolean {
    return this.#state === 'starting' || this.#state === 'active';
  }

  #setState(state: CallState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#emitter.emit('state', state);
  }
}

function requireAgentTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AGENT_TIMEOUT_MS;

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError('agentTimeoutMs must be a finite number of milliseconds above 0.');
  }

  return value;
}

function secretsFrom(session: WebSessionBootstrap): string[] {
  return session.turn
    ? [session.participantToken, session.turn.credential]
    : [session.participantToken];
}

// Test-only view of the state machine. index.ts does not re-export it, so the package hides it.
export function inspectCall(call: WayloVoice): CallInspection {
  return inspectInternals(call);
}
