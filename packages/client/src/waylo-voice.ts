import {
  ConnectionState,
  type DisconnectReason,
  type RemoteParticipant,
  Room,
  type RoomConnectOptions,
  RoomEvent,
  type RoomEventCallbacks,
  Track,
} from 'livekit-client';

import { abortable } from './abortable.js';
import { waitForAgent } from './agent.js';
import { Emitter } from './emitter.js';
import { WayloVoiceError } from './errors.js';
import {
  disconnectCause,
  toConnectError,
  toMicrophoneError,
  toWayloVoiceError,
} from './livekit-errors.js';
import { RemoteAudio } from './remote-audio.js';
import {
  type CallState,
  decideAgentLeft,
  decideDisconnect,
  readSessionOutcome,
} from './session-outcome.js';
import { isSessionExpired, requireSession, type WebSessionBootstrap } from './session.js';

interface CallEvents extends Record<string, unknown> {
  state: CallState;
}

interface CallInspection {
  readonly error: WayloVoiceError | undefined;
  onState(listener: (state: CallState) => void): () => void;
  readonly state: CallState;
}

export interface WayloVoiceOptions {
  /** How long `start()` waits for the agent to join before failing with `AGENT_TIMEOUT`. Default 20 s. */
  agentTimeoutMs?: number;
}

const DEFAULT_AGENT_TIMEOUT_MS = 20_000;
const AGENT_LEFT = 'Agent left the room unexpectedly.';
const ROOM_DISCONNECTED = 'Room disconnected.';

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
  #agent: RemoteParticipant | undefined;
  #isConnected = false;
  #startAbort: AbortController | undefined;
  #startSettled: Promise<void> | undefined;
  #stopPromise: Promise<void> | undefined;
  #releasePromise: Promise<void> | undefined;

  /** Throws a `RangeError` for an `agentTimeoutMs` that is not a finite number above 0. */
  constructor(options: WayloVoiceOptions = {}) {
    this.#agentTimeoutMs = requireAgentTimeoutMs(options.agentTimeoutMs);
  }

  /**
   * Connects to the room, turns on the microphone and resolves once the agent has joined.
   * Call it from a click handler so the browser lets the agent's audio play. Rejects with a
   * `WayloVoiceError`; a second call rejects with `ALREADY_STARTED`.
   */
  start(session: WebSessionBootstrap): Promise<void> {
    if (this.#state !== 'idle') return Promise.reject(new WayloVoiceError('ALREADY_STARTED'));
    this.#setState('starting');
    const started = this.#startCall(session);

    // stop() only waits for start() to settle; the caller of start() gets the rejection.
    this.#startSettled = started.then(
      () => undefined,
      () => undefined,
    );

    return started;
  }

  /** Hangs up and releases the room, microphone and audio elements. Safe to call at any time. */
  async stop(): Promise<void> {
    await this.#stopOnce();
    this.#room = undefined;
    this.#agent = undefined;
  }

  #stopOnce(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;

    if (!this.#isLive()) return this.#releasePromise ?? Promise.resolve();

    this.#stopPromise = (async () => {
      this.#startAbort?.abort(new WayloVoiceError('CANCELLED'));
      this.#setState('stopping');
      await this.#releaseRoom();
      await this.#startSettled;
      this.#setState('stopped');
    })();

    return this.#stopPromise;
  }

  async #startCall(input: WebSessionBootstrap): Promise<void> {
    const startAbort = new AbortController();
    const { signal } = startAbort;
    let secrets: string[] = [];

    this.#startAbort = startAbort;

    try {
      const session = requireSession(input);

      secrets = secretsFrom(session);
      if (isSessionExpired(session)) throw new WayloVoiceError('SESSION_EXPIRED');

      // Audio-only call: adaptive stream and dynacast only manage video layers.
      const room = new Room({ adaptiveStream: false, dynacast: false });

      this.#room = room;
      // Runs before any await so it still counts as the caller's click gesture for autoplay.
      room.startAudio().catch(() => undefined);
      this.#listenToRoom(room);

      await this.#connect(room, session, signal, secrets);
      this.#isConnected = true;
      signal.throwIfAborted();

      await this.#enableMicrophone(room, signal, secrets);
      signal.throwIfAborted();

      this.#attachSubscribedAudio(room);
      this.#agent = await waitForAgent(room, this.#agentTimeoutMs, signal);
      signal.throwIfAborted();

      this.#setState('active');
    } catch (error) {
      const { reason } = signal;
      const isCancelled = reason instanceof WayloVoiceError && reason.code === 'CANCELLED';
      const failure = isCancelled ? reason : toWayloVoiceError(error, secrets);

      if (!isCancelled) await this.#fail(failure);
      throw failure;
    }
  }

  #connect(
    room: Room,
    session: WebSessionBootstrap,
    signal: AbortSignal,
    secrets: readonly string[],
  ): Promise<void> {
    // LiveKit advertises no relay here; the issued TURN is the only path through symmetric NAT.
    const options: RoomConnectOptions = session.turn
      ? { rtcConfig: { iceServers: [session.turn], iceTransportPolicy: 'relay' } }
      : {};

    return abortableStep(
      room.connect(session.livekitUrl, session.participantToken, options),
      signal,
      error => toConnectError(error, secrets),
    );
  }

  async #enableMicrophone(
    room: Room,
    signal: AbortSignal,
    secrets: readonly string[],
  ): Promise<void> {
    const enabling = room.localParticipant.setMicrophoneEnabled(true);

    // A cancelled start stops waiting, but getUserMedia still finishes later; stop that track so
    // the browser's mic indicator turns off.
    enabling
      .then(publication => {
        if (signal.aborted) publication?.track?.stop();
      })
      .catch(() => undefined);

    await abortableStep(enabling, signal, error => toMicrophoneError(error, secrets));
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
    this.#addRoomListener(room, RoomEvent.ParticipantDisconnected, (participant, reason) => {
      if (participant.identity !== this.#agent?.identity) return;
      // A full reconnect also reports every participant as disconnected, then switches the room
      // to reconnecting in the same tick. Looking one microtask later tells the two apart.
      queueMicrotask(() => this.#onAgentLeft(room, participant, reason));
    });
    this.#addRoomListener(room, RoomEvent.Disconnected, reason => {
      this.#onDisconnected(reason);
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

  #onAgentLeft(room: Room, agent: RemoteParticipant, reason: DisconnectReason | undefined): void {
    if (this.#state !== 'active' || room.state !== ConnectionState.Connected) return;

    if (decideAgentLeft(readSessionOutcome(agent.attributes)) === 'end') {
      this.#end();
    } else {
      this.#fail(new WayloVoiceError('AGENT_LEFT', disconnectCause(AGENT_LEFT, reason)));
    }
  }

  #onDisconnected(reason: DisconnectReason | undefined): void {
    const decision = decideDisconnect({
      isConnected: this.#isConnected,
      outcome: readSessionOutcome(this.#agent?.attributes),
      reason,
      state: this.#state,
    });
    const failure = () =>
      new WayloVoiceError('CONNECTION_FAILED', disconnectCause(ROOM_DISCONNECTED, reason));

    switch (decision) {
      case 'abort_start':
        this.#startAbort?.abort(failure());
        break;
      case 'end':
        this.#end();
        break;
      case 'fail':
        this.#fail(failure());
        break;
      case 'ignore':
        break;
      // no default
    }
  }

  #end(): void {
    this.#setState('ended');
    this.#releaseRoom();
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

async function abortableStep<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  toError: (error: unknown) => WayloVoiceError,
): Promise<T> {
  try {
    return await abortable(promise, signal);
  } catch (error) {
    throw signal.aborted ? signal.reason : toError(error);
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
