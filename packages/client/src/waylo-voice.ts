import {
  ConnectionState,
  DeviceUnsupportedError,
  type DisconnectReason,
  type LocalTrack,
  type Participant,
  type RemoteParticipant,
  Room,
  type RoomConnectOptions,
  RoomEvent,
  type RoomEventCallbacks,
  Track,
  TrackEvent,
} from 'livekit-client';

import { abortable } from './abortable.js';
import { findAgent, waitForAgent } from './agent.js';
import { Emitter } from './emitter.js';
import { WayloVoiceError } from './errors.js';
import {
  disconnectCause,
  toConnectError,
  toMicrophoneError,
  toWayloVoiceError,
} from './livekit-errors.js';
import { RemoteAudio } from './remote-audio.js';
import { fetchSession, type SessionHeaders, type SessionRequest } from './session-endpoint.js';
import {
  type CallPhase,
  decideAgentLeft,
  decideDisconnect,
  readSessionOutcome,
  type SessionEndReason,
  type SessionOutcome,
} from './session-outcome.js';
import { isSessionExpired, type WebSessionBootstrap } from './session.js';
import {
  INITIAL_STATE,
  mergeState,
  toAgentState,
  type WayloVoiceEnd,
  type WayloVoiceEvents,
  type WayloVoiceState,
  type WayloVoiceTranscript,
} from './state.js';
import { listenToTranscripts, TRANSCRIPTION_TOPIC } from './transcripts.js';

interface CallInspection {
  readonly error: WayloVoiceError | undefined;
  onPhase(listener: (phase: CallPhase) => void): () => void;
  readonly phase: CallPhase;
}

interface PhaseEvents extends Record<string, unknown> {
  phase: CallPhase;
}

/** Options for `start()`. */
export type WayloVoiceStartOptions = SessionRequest;

/** Options for `new WayloVoice()`. */
export interface WayloVoiceOptions {
  /** How long `start()` waits for the agent to be ready before failing with `AGENT_TIMEOUT`. Default 20 s. */
  agentTimeoutMs?: number;
  /** Extra headers for the session endpoint, e.g. `Authorization`. Called once per `start()`; never logged. */
  headers?: SessionHeaders;
  /** Same-origin backend route that checks your login and returns the `POST /sessions/web` response. */
  sessionEndpoint: string;
}

const DEFAULT_AGENT_TIMEOUT_MS = 20_000;
const AGENT_LEFT = 'Agent left the room unexpectedly.';
const ROOM_DISCONNECTED = 'Room disconnected.';

let inspectInternals: (call: WayloVoice) => CallInspection;

/** One single-use voice call. Safe to create on page load. */
export class WayloVoice {
  static {
    inspectInternals = call => ({
      get error() {
        return call.#error;
      },
      onPhase: listener => call.#phaseEvents.on('phase', listener),
      get phase() {
        return call.#phase;
      },
    });
  }

  readonly #agentTimeoutMs: number;
  readonly #headers: SessionHeaders | undefined;
  readonly #sessionEndpoint: string;
  readonly #audio = new RemoteAudio();
  readonly #phaseEvents = new Emitter<PhaseEvents>();
  readonly #events = new Emitter<WayloVoiceEvents>();
  readonly #transcriptAbort = new AbortController();
  readonly #cleanups: (() => void)[] = [];
  #phase: CallPhase = 'idle';
  #state: WayloVoiceState = INITIAL_STATE;
  #ending = false;
  #closed = false;
  #muted = false;
  #error: WayloVoiceError | undefined;
  #room: Room | undefined;
  #agent: RemoteParticipant | undefined;
  #outcome: SessionOutcome | null = null;
  #isConnected = false;
  #startAbort: AbortController | undefined;
  #startSettled: Promise<void> | undefined;
  #stopPromise: Promise<void> | undefined;
  #releasePromise: Promise<void> | undefined;

  /** Throws `RangeError` for invalid options. */
  constructor(options: WayloVoiceOptions) {
    this.#sessionEndpoint = requireSessionEndpoint(options?.sessionEndpoint);
    this.#headers = requireHeaders(options.headers);
    this.#agentTimeoutMs = requireAgentTimeoutMs(options.agentTimeoutMs);
  }

  /** Connects and resolves once the agent is ready. Call it from a click so audio can play. */
  start(options: WayloVoiceStartOptions): Promise<void> {
    let request: SessionRequest;

    try {
      request = requireStartOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }

    if (this.#phase !== 'idle') return Promise.reject(new WayloVoiceError('ALREADY_STARTED'));
    this.#setPhase('starting');
    const started = this.#startCall(request);

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

  /** The current state. A new frozen object whenever something changes. */
  getState(): WayloVoiceState {
    return this.#state;
  }

  /** Adds a listener and returns a function that removes it. */
  on<E extends keyof WayloVoiceEvents>(
    event: E,
    listener: (payload: WayloVoiceEvents[E]) => void,
  ): () => void {
    return this.#events.on(event, listener);
  }

  /** Removes a listener added with `on()`. */
  off<E extends keyof WayloVoiceEvents>(
    event: E,
    listener: (payload: WayloVoiceEvents[E]) => void,
  ): void {
    this.#events.off(event, listener);
  }

  /** Mutes or unmutes the mic, even before `start()`; unmuting can reject with a mic error. */
  async setMuted(muted: boolean): Promise<void> {
    if (typeof muted !== 'boolean') throw new RangeError('muted must be a boolean.');
    if (this.#ending || muted === this.#muted) return;
    const room = this.#room;

    if (!room || !microphoneTrack(room)) {
      this.#muted = muted;

      return;
    }

    try {
      await room.localParticipant.setMicrophoneEnabled(!muted);
    } catch (error) {
      throw toMicrophoneError(error, []);
    }

    this.#muted = muted;
    this.#syncMicrophone(room);
  }

  /** Sets the agent's volume, 0 to 1, for every audio track now and later. */
  setVolume(volume: number): void {
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new RangeError('volume must be a number from 0 to 1.');
    }

    if (this.#ending || volume === this.#state.volume) return;
    this.#audio.setVolume(volume);
    this.#updateState({ volume });
  }

  /** Lets the browser play the agent's audio when `playback` is `blocked`. Call it from a click. */
  async resumeAudio(): Promise<void> {
    const room = this.#room;

    if (this.#ending || !room) return;
    await room.startAudio().catch(() => undefined);
    this.#syncPlayback(room);
  }

  #stopOnce(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;

    if (!this.#isLive()) return this.#releasePromise ?? Promise.resolve();

    this.#stopPromise = (async () => {
      const wasActive = this.#phase === 'active';

      this.#startAbort?.abort(new WayloVoiceError('CANCELLED'));
      this.#ending = true;
      this.#setPhase('stopping');
      await this.#releaseRoom();
      await this.#startSettled;
      this.#setPhase('stopped');
      this.#close(
        wasActive ? completedEnd('caller_hangup') : failedEnd(new WayloVoiceError('CANCELLED')),
      );
    })();

    return this.#stopPromise;
  }

  async #startCall(request: SessionRequest): Promise<void> {
    const startAbort = new AbortController();
    const { signal } = startAbort;
    let secrets: string[] = [];

    this.#startAbort = startAbort;

    try {
      const room = this.#createRoom();
      const session = await this.#openSession(request, signal);

      secrets = secretsFrom(session);

      await this.#connect(room, session, signal, secrets);
      this.#isConnected = true;
      signal.throwIfAborted();

      await this.#enableMicrophone(room, signal, secrets);
      signal.throwIfAborted();

      this.#attachSubscribedAudio(room);
      this.#agent = await waitForAgent(room, this.#agentTimeoutMs, signal);
      signal.throwIfAborted();

      this.#syncAgent(room);
      this.#setPhase('active');
    } catch (error) {
      throw await this.#startFailure(error, signal, secrets);
    }
  }

  #createRoom(): Room {
    // Audio-only call: adaptive stream and dynacast only manage video layers.
    const room = new Room({ adaptiveStream: false, dynacast: false });

    this.#room = room;
    // Before any await, so it still counts as the click gesture for autoplay.
    room.startAudio().catch(() => undefined);
    this.#listenToRoom(room);

    return room;
  }

  async #openSession(request: SessionRequest, signal: AbortSignal): Promise<WebSessionBootstrap> {
    const session = await abortable(
      fetchSession(this.#sessionEndpoint, request, this.#headers, signal),
      signal,
    );

    if (isSessionExpired(session)) throw new WayloVoiceError('SESSION_EXPIRED');
    if (typeof session.sessionId === 'string') this.#updateState({ sessionId: session.sessionId });

    return session;
  }

  async #startFailure(
    error: unknown,
    signal: AbortSignal,
    secrets: readonly string[],
  ): Promise<WayloVoiceError> {
    const { reason } = signal;

    if (reason instanceof WayloVoiceError && reason.code === 'CANCELLED') return reason;
    const failure = toWayloVoiceError(error, secrets);

    await this.#fail(failure);

    return failure;
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
    const track = await abortableStep(this.#publishMicrophone(room, signal), signal, error =>
      toMicrophoneError(error, secrets),
    );

    // setMuted() during publishTrack only stored the flag; apply it now.
    if (this.#muted !== track.isMuted) await (this.#muted ? track.mute() : track.unmute());
    this.#watchMicrophone(room, track);
    this.#syncMicrophone(room);
  }

  // What setMicrophoneEnabled(true) does, with a mute applied between getUserMedia and publishing.
  async #publishMicrophone(room: Room, signal: AbortSignal): Promise<LocalTrack> {
    const [track] = await room.localParticipant.createTracks({ audio: true });

    if (!track) throw new DeviceUnsupportedError('No microphone track was created.');

    try {
      // getUserMedia finishes even after cancel; never publish then, and stop the track below.
      signal.throwIfAborted();
      if (this.#muted) await track.mute();
      await room.localParticipant.publishTrack(track);
      signal.throwIfAborted();

      return track;
    } catch (error) {
      track.stop();
      throw error;
    }
  }

  #watchMicrophone(room: Room, track: LocalTrack): void {
    const onEnded = () => {
      this.#syncMicrophone(room);
      this.#emitError(new WayloVoiceError('MICROPHONE_UNAVAILABLE'));
    };

    const onRestarted = () => this.#syncMicrophone(room);

    track.on(TrackEvent.Ended, onEnded);
    track.on(TrackEvent.Restarted, onRestarted);
    this.#cleanups.push(() => {
      track.off(TrackEvent.Ended, onEnded);
      track.off(TrackEvent.Restarted, onRestarted);
    });
  }

  #attachSubscribedAudio(room: Room): void {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) this.#audio.attach(publication.track);
      }
    }

    this.#syncPlayback(room);
  }

  #listenToRoom(room: Room): void {
    this.#listenToTranscripts(room);
    this.#listenToAudio(room);
    this.#listenToConnection(room);
    this.#listenToAgent(room);
  }

  #listenToTranscripts(room: Room): void {
    listenToTranscripts(room, this.#transcriptAbort.signal, {
      getSessionId: () => this.#state.sessionId,
      onError: error => this.#emitError(error),
      onTranscript: line => this.#emitTranscript(line),
    });
    this.#cleanups.push(() => room.unregisterTextStreamHandler(TRANSCRIPTION_TOPIC));
  }

  #listenToAudio(room: Room): void {
    this.#addRoomListener(room, RoomEvent.TrackSubscribed, track => {
      if (this.#isLive()) this.#audio.attach(track);
      this.#syncPlayback(room);
    });
    this.#addRoomListener(room, RoomEvent.TrackUnsubscribed, track => {
      this.#audio.detach(track);
      this.#syncPlayback(room);
    });
    this.#addRoomListener(room, RoomEvent.AudioPlaybackStatusChanged, () => {
      this.#syncPlayback(room);
    });
  }

  #listenToConnection(room: Room): void {
    this.#addRoomListener(room, RoomEvent.Reconnecting, () => {
      if (this.#phase === 'active') this.#updateState({ connection: 'reconnecting' });
    });
    this.#addRoomListener(room, RoomEvent.Reconnected, () => {
      if (this.#phase === 'active') this.#updateState({ connection: 'connected' });
    });
    this.#addRoomListener(room, RoomEvent.Disconnected, reason => {
      this.#onDisconnected(reason);
    });
  }

  #listenToAgent(room: Room): void {
    this.#addRoomListener(room, RoomEvent.ParticipantConnected, participant => {
      if (participant.isAgent && this.#phase === 'active') this.#agent = participant;
      this.#syncAgent(room);
    });
    this.#addRoomListener(
      room,
      RoomEvent.ParticipantAttributesChanged,
      (_changed, participant: Participant) => {
        if (!participant.isAgent) return;
        // Latched now: the attributes may be gone by the time the agent leaves.
        this.#outcome = readSessionOutcome(participant.attributes) ?? this.#outcome;
        this.#syncAgent(room);
      },
    );
    this.#addRoomListener(room, RoomEvent.ParticipantDisconnected, (participant, reason) => {
      this.#syncAgent(room);
      if (participant.identity !== this.#agent?.identity) return;
      // A full reconnect also reports every participant as disconnected, then switches the room
      // to reconnecting in the same tick. Looking one microtask later tells the two apart.
      queueMicrotask(() => this.#onAgentLeft(room, participant, reason));
    });
  }

  #addRoomListener<E extends keyof RoomEventCallbacks>(
    room: Room,
    event: E,
    handler: RoomEventCallbacks[E],
  ): void {
    room.on(event, handler);
    this.#cleanups.push(() => room.off(event, handler));
  }

  #onAgentLeft(room: Room, agent: RemoteParticipant, reason: DisconnectReason | undefined): void {
    if (this.#phase !== 'active' || room.state !== ConnectionState.Connected) return;
    const outcome = this.#outcome ?? readSessionOutcome(agent.attributes);

    if (decideAgentLeft(outcome) === 'end') {
      this.#end(outcome?.endReason);
    } else {
      this.#failFromOutcome(
        outcome,
        new WayloVoiceError('AGENT_LEFT', disconnectCause(AGENT_LEFT, reason)),
      );
    }
  }

  #onDisconnected(reason: DisconnectReason | undefined): void {
    const outcome = this.#outcome ?? readSessionOutcome(this.#agent?.attributes);
    const decision = decideDisconnect({
      isConnected: this.#isConnected,
      outcome,
      phase: this.#phase,
      reason,
    });

    switch (decision) {
      case 'abort_start':
        this.#startAbort?.abort(connectionFailed(reason));
        break;
      case 'end':
        this.#end(outcome?.endReason);
        break;
      case 'fail':
        this.#failFromOutcome(outcome, connectionFailed(reason));
        break;
      case 'ignore':
        break;
    }
  }

  #end(reason: SessionEndReason | undefined): void {
    this.#ending = true;
    this.#setPhase('ended');
    this.#releaseRoom()
      .then(() => this.#close(completedEnd(reason)))
      .catch(() => undefined);
  }

  async #fail(error: WayloVoiceError, reason?: SessionEndReason): Promise<void> {
    const wasActive = this.#phase === 'active';

    this.#error = error;
    // A failure with no promise left to reject is reported as an `error` event.
    if (wasActive) this.#emitError(error);
    this.#ending = true;
    if (this.#isLive()) this.#setPhase('failed');
    await this.#releaseRoom();
    this.#close(failedEnd(error, reason));
  }

  #failFromOutcome(outcome: SessionOutcome | null, fallback: WayloVoiceError): Promise<void> {
    if (outcome?.state === 'error') {
      return this.#fail(new WayloVoiceError('AGENT_ERROR'), outcome.endReason);
    }

    return this.#fail(fallback);
  }

  #releaseRoom(): Promise<void> {
    this.#releasePromise ??= this.#disconnectRoom();

    return this.#releasePromise;
  }

  async #disconnectRoom(): Promise<void> {
    const room = this.#room;

    this.#transcriptAbort.abort();
    if (!room) return;
    this.#audio.clear();

    for (const cleanup of this.#cleanups.splice(0)) cleanup();

    microphoneTrack(room)?.stop();
    await room.disconnect().catch(() => undefined);
  }

  #syncAgent(room: Room): void {
    const agent = findAgent(room);

    this.#updateState({ agent: agent ? toAgentState(agent.attributes) : 'none' });
  }

  #syncMicrophone(room: Room): void {
    const track = microphoneTrack(room);
    const isLive = track?.mediaStreamTrack.readyState === 'live';

    this.#updateState({ microphone: isLive ? (this.#muted ? 'muted' : 'on') : 'off' });
  }

  #syncPlayback(room: Room): void {
    if (!this.#audio.hasTracks()) {
      this.#updateState({ playback: 'stopped' });
    } else {
      this.#updateState({ playback: room.canPlaybackAudio ? 'playing' : 'blocked' });
    }
  }

  #updateState(changes: Partial<WayloVoiceState>): void {
    if (this.#ending) return;
    const next = mergeState(this.#state, changes);

    if (!next) return;
    this.#state = next;
    this.#events.emit('state', next);
  }

  #close(end: WayloVoiceEnd): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#state = Object.freeze({
      ...this.#state,
      agent: 'none',
      connection: 'disconnected',
      end,
      microphone: 'off',
      playback: 'stopped',
    });
    this.#events.emit('state', this.#state);
  }

  #emitError(error: WayloVoiceError): void {
    if (!this.#ending) this.#events.emit('error', error);
  }

  #emitTranscript(line: WayloVoiceTranscript): void {
    if (!this.#ending) this.#events.emit('transcript', line);
  }

  #isLive(): boolean {
    return this.#phase === 'starting' || this.#phase === 'active';
  }

  #setPhase(phase: CallPhase): void {
    if (this.#phase === phase) return;
    this.#phase = phase;
    this.#phaseEvents.emit('phase', phase);
    if (phase === 'starting') this.#updateState({ connection: 'connecting' });
    if (phase === 'active') this.#updateState({ connection: 'connected' });
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

function completedEnd(reason?: SessionEndReason): WayloVoiceEnd {
  return reason ? { reason, status: 'completed' } : { status: 'completed' };
}

function connectionFailed(reason: DisconnectReason | undefined): WayloVoiceError {
  return new WayloVoiceError('CONNECTION_FAILED', disconnectCause(ROOM_DISCONNECTED, reason));
}

function failedEnd(error: WayloVoiceError, reason?: SessionEndReason): WayloVoiceEnd {
  return reason ? { error, reason, status: 'failed' } : { error, status: 'failed' };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function microphoneTrack(room: Room): LocalTrack | undefined {
  return room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
}

function requireAgentTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AGENT_TIMEOUT_MS;

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError('agentTimeoutMs must be a finite number of milliseconds above 0.');
  }

  return value;
}

function requireHeaders(value: SessionHeaders | undefined): SessionHeaders | undefined {
  if (value !== undefined && typeof value !== 'function') {
    throw new RangeError('headers must be a function that returns the request headers.');
  }

  return value;
}

function requireSessionEndpoint(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RangeError('sessionEndpoint must be a non-empty URL string.');
  }

  let url: URL;

  try {
    url = new URL(value, globalThis.location.href);
  } catch {
    throw new RangeError('sessionEndpoint must be a valid URL.');
  }

  if (url.origin !== globalThis.location.origin) {
    throw new RangeError('sessionEndpoint must be on the same origin as the page.');
  }

  return value;
}

function requireStartOptions(value: WayloVoiceStartOptions | undefined): SessionRequest {
  if (!isPlainObject(value)) throw new RangeError('start() options must be an object.');

  if (typeof value.agentId !== 'string' || value.agentId.trim() === '') {
    throw new RangeError('agentId must be a non-empty string.');
  }

  if (value.metadata !== undefined && !isPlainObject(value.metadata)) {
    throw new RangeError('metadata must be a plain object.');
  }

  return value;
}

function secretsFrom(session: WebSessionBootstrap): string[] {
  const secrets = [session.livekitUrl, session.participantToken];

  return session.turn ? [...secrets, session.turn.credential] : secrets;
}

// Test-only; not re-exported from index.ts.
export function inspectCall(call: WayloVoice): CallInspection {
  return inspectInternals(call);
}
