import {
  ConnectionError,
  ConnectionErrorReason,
  DisconnectReason,
  MediaDeviceFailure,
} from 'livekit-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WayloVoice } from '../../src/index.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { record } from '../__setup__/active-call.js';
import { everyErrorSurface, jsonWithErrors, wayloVoiceErrorFrom } from '../__setup__/errors.js';
import {
  audioElements,
  behavior,
  deferred,
  FakeRoom,
  flush,
  lastRoom,
} from '../__setup__/fake-room.js';
import {
  createCall,
  fetchMock,
  opaqueRedirectResponse,
  serveSession,
  sessionEndpoint,
  sessionResponse,
  START,
  TEST_AGENT_ID,
  TEST_SESSION_ENDPOINT,
} from '../__setup__/fake-session-endpoint.js';
import { createTextStream } from '../__setup__/fake-text-stream.js';
import {
  TEST_LIVEKIT_URL,
  TEST_PARTICIPANT_TOKEN,
  TEST_TURN_SERVER,
  webSessionBootstrap,
} from '../__setup__/fixtures.js';

function domError(name: string): Error {
  return new DOMException('mic', name);
}

function expectCleanedUp(room: FakeRoom) {
  expect(room.disconnect).toHaveBeenCalledTimes(1);
  expect(room.listenersAtDisconnect).toBe(0);
  expect(room.listenerCount()).toBe(0);
}

async function expectMicReleased(room: FakeRoom) {
  await flush();
  expect(room.localParticipant.createTracks).toHaveBeenCalledTimes(1);
  expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  expect(
    room.localParticipant.microphoneTracks.map(track => track.mediaStreamTrack.readyState),
  ).toEqual(['ended']);
}

function recordPublicOutput(call: WayloVoice): () => string {
  const events = record(call);

  return () => jsonWithErrors([events, call.getState()]);
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('WayloVoice', () => {
  describe('start()', () => {
    it('connects, enables the mic, plays agent audio and resolves when the agent is in', async () => {
      const call = createCall();
      const phases: string[] = [];

      inspectCall(call).onPhase(phase => phases.push(phase));

      await call.start(START);
      const room = lastRoom();

      expect(room.options).toEqual({ adaptiveStream: false, dynacast: false });
      expect(room.startAudio).toHaveBeenCalledTimes(1);
      expect(room.connect).toHaveBeenCalledWith(TEST_LIVEKIT_URL, TEST_PARTICIPANT_TOKEN, {});
      expect(room.localParticipant.createTracks).toHaveBeenCalledWith({ audio: true });
      expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
        room.localParticipant.microphoneTracks[0],
      );
      expect(call.getState().microphone).toBe('on');
      expect(audioElements()).toBe(1);
      expect(phases).toEqual(['starting', 'active']);
    });

    it('creates the room and unlocks audio synchronously, before fetching the session', async () => {
      const started = createCall().start(START);
      const room = lastRoom();

      expect(room.startAudio).toHaveBeenCalledTimes(1);
      expect(room.connect).not.toHaveBeenCalled();
      await started;
      expect(room.connect).toHaveBeenCalledTimes(1);
    });

    it('opens the mic while the session is fetched and publishes it once connected', async () => {
      const answer = deferred<Response>();

      sessionEndpoint.respond = () => answer.promise;
      const started = createCall().start(START);
      const room = lastRoom();

      expect(room.localParticipant.createTracks).toHaveBeenCalledWith({ audio: true });
      await flush();
      expect(room.connect).not.toHaveBeenCalled();
      expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
      answer.resolve(sessionResponse());
      await started;
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    });

    it('fails at once with the mic error while connecting and releases everything', async () => {
      const connecting = deferred();
      const prompt = deferred();

      behavior.connect = () => connecting.promise;
      behavior.microphone = () => prompt.promise;
      const call = createCall();
      const started = call.start(START);

      await flush();
      expect(lastRoom().state).toBe('connecting');
      prompt.reject(domError('NotAllowedError'));
      const error = await wayloVoiceErrorFrom(started);

      expect(error.code).toBe('MICROPHONE_DENIED');
      expect(inspectCall(call).phase).toBe('failed');
      expectCleanedUp(lastRoom());
      expect(lastRoom().localParticipant.publishTrack).not.toHaveBeenCalled();
    });

    it('registers room listeners before connecting', async () => {
      let listenersAtConnect = 0;

      behavior.connect = () => {
        listenersAtConnect = lastRoom().listenerCount();

        return Promise.resolve();
      };

      await createCall().start(START);
      expect(listenersAtConnect).toBe(15);
      expect(lastRoom().registerTextStreamHandler).toHaveBeenCalledWith(
        'lk.transcription',
        expect.any(Function),
      );
    });

    it('forces relay ICE through the TURN server when the session has one', async () => {
      serveSession(webSessionBootstrap({ turn: TEST_TURN_SERVER }));
      await createCall().start(START);
      expect(lastRoom().connect).toHaveBeenCalledWith(TEST_LIVEKIT_URL, TEST_PARTICIPANT_TOKEN, {
        rtcConfig: { iceServers: [TEST_TURN_SERVER], iceTransportPolicy: 'relay' },
      });
    });

    it('does not override rtcConfig without TURN', async () => {
      await createCall().start(START);
      const options = lastRoom().connect.mock.calls[0]?.[2];

      expect(options).not.toHaveProperty('rtcConfig');
    });

    it('plays every agent audio track, including background_audio', async () => {
      behavior.agentTracks = 2;
      await createCall().start(START);
      expect(audioElements()).toBe(2);
    });

    it('resolves at once when the agent is already in the room', async () => {
      vi.useFakeTimers();
      const call = createCall({ agentTimeoutMs: 1000 });

      await call.start(START);
      expect(inspectCall(call).phase).toBe('active');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for an agent that joins later, ignoring non-agents', async () => {
      behavior.agent = 'later';
      const call = createCall();
      let isResolved = false;
      const started = call.start(START).then(() => {
        isResolved = true;
      });

      await flush();
      lastRoom().addHuman();
      await flush();
      expect(isResolved).toBe(false);
      lastRoom().addAgent();
      await started;
      expect(inspectCall(call).phase).toBe('active');
      expect(audioElements()).toBe(1);
    });

    it('fails with AGENT_TIMEOUT and cleans up when the agent never joins', async () => {
      vi.useFakeTimers();
      behavior.agent = 'later';
      const call = createCall({ agentTimeoutMs: 5000 });
      const started = call.start(START);

      await vi.advanceTimersByTimeAsync(4999);
      expect(inspectCall(call).phase).toBe('starting');
      await vi.advanceTimersByTimeAsync(1);
      const { code } = await wayloVoiceErrorFrom(started);

      expect(code).toBe('AGENT_TIMEOUT');
      expect(inspectCall(call).phase).toBe('failed');
      expectCleanedUp(lastRoom());
    });

    it('defaults agentTimeoutMs to 20 s', async () => {
      vi.useFakeTimers();
      behavior.agent = 'later';
      const started = createCall().start(START);

      await vi.advanceTimersByTimeAsync(19_999);
      await vi.advanceTimersByTimeAsync(1);
      const { code } = await wayloVoiceErrorFrom(started);

      expect(code).toBe('AGENT_TIMEOUT');
    });

    it('fails with CONNECTION_FAILED and cleans up when the session endpoint does not answer within 15 s', async () => {
      vi.useFakeTimers();
      sessionEndpoint.respond = () => deferred<Response>().promise;
      const call = createCall();
      const started = call.start(START);

      await vi.advanceTimersByTimeAsync(14_999);
      expect(inspectCall(call).phase).toBe('starting');
      await vi.advanceTimersByTimeAsync(1);
      const { code } = await wayloVoiceErrorFrom(started);
      const room = lastRoom();

      expect(code).toBe('CONNECTION_FAILED');
      expect(inspectCall(call).phase).toBe('failed');
      expect(room.connect).not.toHaveBeenCalled();
      expectCleanedUp(room);
      await expectMicReleased(room);
    });

    it('starts when the session endpoint answers just under 15 s', async () => {
      vi.useFakeTimers();
      const answer = deferred<Response>();

      sessionEndpoint.respond = () => answer.promise;
      const call = createCall();
      const started = call.start(START);

      await vi.advanceTimersByTimeAsync(14_999);
      answer.resolve(sessionResponse());
      await started;

      expect(inspectCall(call).phase).toBe('active');
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      ['NotAllowedError', 'MICROPHONE_DENIED'],
      ['NotFoundError', 'MICROPHONE_UNAVAILABLE'],
      ['NotReadableError', 'MICROPHONE_IN_USE'],
    ])('maps a %s from the mic to %s', async (name, code) => {
      behavior.microphone = () => Promise.reject(domError(name));
      const call = createCall();
      const error = await wayloVoiceErrorFrom(call.start(START));

      expect(error.code).toBe(code);
      expect(MediaDeviceFailure.getFailure(error.cause)).toBeDefined();
      expect(inspectCall(call).phase).toBe('failed');
      expectCleanedUp(lastRoom());
    });

    it.each([
      ['an OverconstrainedError', domError('OverconstrainedError'), 'MICROPHONE_UNAVAILABLE'],
      ['an AbortError', domError('AbortError'), 'MICROPHONE_UNAVAILABLE'],
      ['a SecurityError', domError('SecurityError'), 'MICROPHONE_UNAVAILABLE'],
      ['an unknown mic error', new Error('boom'), 'MICROPHONE_UNAVAILABLE'],
    ])('maps %s from the mic to %s, keeping it as the cause', async (_label, failure, code) => {
      behavior.microphone = () => Promise.reject(failure);
      const error = await wayloVoiceErrorFrom(createCall().start(START));

      expect(error.code).toBe(code);
      expect(error.cause).toMatchObject({ message: failure.message, name: failure.name });
    });

    it('fails with CONNECTION_FAILED when the open mic cannot be published', async () => {
      const call = createCall();
      const started = call.start(START);

      lastRoom().localParticipant.publishTrack.mockRejectedValueOnce(
        new Error('publish timed out'),
      );
      const error = await wayloVoiceErrorFrom(started);

      expect(error.code).toBe('CONNECTION_FAILED');
      expect(lastRoom().localParticipant.microphoneTracks[0]?.mediaStreamTrack.readyState).toBe(
        'ended',
      );
      expectCleanedUp(lastRoom());
    });

    it('fails with MICROPHONE_UNAVAILABLE when LiveKit creates no mic track', async () => {
      behavior.microphone = () => Promise.resolve(false);
      const error = await wayloVoiceErrorFrom(createCall().start(START));

      expect(error.code).toBe('MICROPHONE_UNAVAILABLE');
      expect(lastRoom().localParticipant.publishTrack).not.toHaveBeenCalled();
      expectCleanedUp(lastRoom());
    });

    it('rejects a session more than 60 s past expiresAt without connecting', async () => {
      serveSession(webSessionBootstrap({ expiresAt: new Date(Date.now() - 61_000).toISOString() }));
      const error = await wayloVoiceErrorFrom(createCall().start(START));

      expect(error.code).toBe('SESSION_EXPIRED');
      expect(lastRoom().connect).not.toHaveBeenCalled();
      expectCleanedUp(lastRoom());
    });

    it('lets LiveKit decide within the 60 s tolerance', async () => {
      serveSession(webSessionBootstrap({ expiresAt: new Date(Date.now() - 30_000).toISOString() }));
      await createCall().start(START);
      expect(lastRoom().connect).toHaveBeenCalledTimes(1);
    });

    it('maps a LiveKit 401 / NotAllowed to SESSION_EXPIRED and keeps the HTTP status', async () => {
      behavior.connect = () => Promise.reject(ConnectionError.notAllowed('invalid token', 401));
      const error = await wayloVoiceErrorFrom(createCall().start(START));

      expect(error.code).toBe('SESSION_EXPIRED');
      expect(error.cause).toMatchObject({
        name: 'ConnectionError',
        reason: ConnectionErrorReason.NotAllowed,
        status: 401,
      });
    });

    it('keeps the disconnect reason name of a LiveKit leave request', async () => {
      behavior.connect = () =>
        Promise.reject(ConnectionError.leaveRequest('left', DisconnectReason.JOIN_FAILURE));
      const error = await wayloVoiceErrorFrom(createCall().start(START));

      expect(error.code).toBe('CONNECTION_FAILED');
      expect(error.cause).toMatchObject({
        disconnectReason: 'JOIN_FAILURE',
        name: 'ConnectionError',
        reason: ConnectionErrorReason.LeaveRequest,
      });
    });

    it('maps any other connect failure to CONNECTION_FAILED', async () => {
      behavior.connect = () => Promise.reject(ConnectionError.serverUnreachable('nope'));
      const call = createCall();
      const error = await wayloVoiceErrorFrom(call.start(START));

      expect(error.code).toBe('CONNECTION_FAILED');
      expectCleanedUp(lastRoom());
      await expectMicReleased(lastRoom());
    });

    it('keeps SESSION_EXPIRED when the room reports Disconnected before connect rejects', async () => {
      const gate = deferred();

      behavior.connect = () => gate.promise;
      const call = createCall();
      const started = call.start(START);

      await flush();
      lastRoom().serverDisconnect(DisconnectReason.JOIN_FAILURE);
      expect(inspectCall(call).phase).toBe('starting');
      gate.reject(ConnectionError.notAllowed('invalid token', 401));
      const error = await wayloVoiceErrorFrom(started);

      expect(error.code).toBe('SESSION_EXPIRED');
      expect(inspectCall(call).phase).toBe('failed');
      expectCleanedUp(lastRoom());
    });

    it('fails with CONNECTION_FAILED when the room drops while the mic is starting', async () => {
      const gate = deferred();

      behavior.microphone = () => gate.promise;
      const call = createCall();
      const started = call.start(START);

      await flush();
      lastRoom().serverDisconnect(DisconnectReason.SIGNAL_CLOSE);
      const error = await wayloVoiceErrorFrom(started);

      expect(error.code).toBe('CONNECTION_FAILED');
      expect(error.cause).toMatchObject({ disconnectReason: 'SIGNAL_CLOSE' });
      expect(inspectCall(call).phase).toBe('failed');
      expectCleanedUp(lastRoom());
      gate.resolve();
      await flush();
      expect(lastRoom().localParticipant.microphoneTracks[0]?.mediaStreamTrack.readyState).toBe(
        'ended',
      );
      expect(lastRoom().localParticipant.publishTrack).not.toHaveBeenCalled();
    });

    it('rejects an invalid session with INVALID_SESSION', async () => {
      serveSession({ livekitUrl: TEST_LIVEKIT_URL });
      const error = await wayloVoiceErrorFrom(createCall().start(START));

      expect(error.code).toBe('INVALID_SESSION');
      expect(lastRoom().connect).not.toHaveBeenCalled();
    });

    it.each([
      ['no options', undefined],
      ['null options', null],
      ['a string as options', '3f9c2a7e-1b4d-4c8a-9e2f-5d6b7a8c9e01'],
      ['a missing agentId', {}],
      ['an empty agentId', { agentId: '' }],
      ['a blank agentId', { agentId: '   ' }],
      ['a numeric agentId', { agentId: 42 }],
      ['null metadata', { agentId: TEST_AGENT_ID, metadata: null }],
      ['array metadata', { agentId: TEST_AGENT_ID, metadata: [] }],
      ['string metadata', { agentId: TEST_AGENT_ID, metadata: 'x' }],
    ])('rejects %s with a RangeError and stays idle', async (_label, options) => {
      const call = createCall();

      await expect(call.start(options as never)).rejects.toThrow(RangeError);
      expect(inspectCall(call).phase).toBe('idle');
      expect(FakeRoom.instances).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();

      await call.start(START);
      expect(inspectCall(call).phase).toBe('active');
    });

    it('rejects a second start() with ALREADY_STARTED', async () => {
      const call = createCall();

      await call.start(START);
      const { code } = await wayloVoiceErrorFrom(call.start(START));

      expect(code).toBe('ALREADY_STARTED');
    });

    it('rejects start() after a failed start with ALREADY_STARTED', async () => {
      const call = createCall();

      serveSession({});
      await wayloVoiceErrorFrom(call.start(START));
      const { code } = await wayloVoiceErrorFrom(call.start(START));

      expect(code).toBe('ALREADY_STARTED');
    });

    it('never puts the participant token or TURN credential in the error or its cause', async () => {
      const { credential } = TEST_TURN_SERVER;

      behavior.connect = () =>
        Promise.reject(
          ConnectionError.notAllowed(
            `${TEST_LIVEKIT_URL}/rtc?access_token=${TEST_PARTICIPANT_TOKEN} rejected (${TEST_PARTICIPANT_TOKEN}, ${credential})`,
            401,
            { token: TEST_PARTICIPANT_TOKEN } as never,
          ),
        );
      serveSession(webSessionBootstrap({ turn: TEST_TURN_SERVER }));
      const error = await wayloVoiceErrorFrom(createCall().start(START));
      const surfaces = everyErrorSurface(error);

      expect(error.code).toBe('SESSION_EXPIRED');
      expect(surfaces).not.toContain(TEST_PARTICIPANT_TOKEN);
      expect(surfaces).not.toContain(credential);
      expect(surfaces).not.toContain(TEST_LIVEKIT_URL);
    });
  });

  describe('start() and the session endpoint', () => {
    const HEADER_SECRET = 'Bearer app-token-123';

    it('fetches the session once, then connects with it', async () => {
      await createCall().start({ agentId: TEST_AGENT_ID, metadata: { orderId: '42' } });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(TEST_SESSION_ENDPOINT);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        body: JSON.stringify({ agentId: TEST_AGENT_ID, metadata: { orderId: '42' } }),
        credentials: 'same-origin',
        method: 'POST',
      });
      expect(lastRoom().connect).toHaveBeenCalledWith(TEST_LIVEKIT_URL, TEST_PARTICIPANT_TOKEN, {});
    });

    it.each([
      [401, 'AUTH_REQUIRED'],
      [403, 'ACCESS_DENIED'],
      [429, 'LIMIT_REACHED'],
      [500, 'CONNECTION_FAILED'],
    ])(
      'fails with %i → %s without connecting, publishing the mic or retrying',
      async (status, code) => {
        serveSession({ error: 'nope' }, status);
        const call = createCall();
        const error = await wayloVoiceErrorFrom(call.start(START));

        expect(error.code).toBe(code);
        expect(inspectCall(call).phase).toBe('failed');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(lastRoom().connect).not.toHaveBeenCalled();
        expectCleanedUp(lastRoom());
        await expectMicReleased(lastRoom());
      },
    );

    it('fails with AUTH_REQUIRED when the endpoint redirects', async () => {
      sessionEndpoint.respond = () => Promise.resolve(opaqueRedirectResponse());
      const call = createCall();
      const error = await wayloVoiceErrorFrom(call.start(START));

      expect(error.code).toBe('AUTH_REQUIRED');
      expect(inspectCall(call).phase).toBe('failed');
      expect(lastRoom().connect).not.toHaveBeenCalled();
      expectCleanedUp(lastRoom());
      await expectMicReleased(lastRoom());
    });

    it('fails with CONNECTION_FAILED on a network error, without retrying', async () => {
      sessionEndpoint.respond = () => Promise.reject(new TypeError('Failed to fetch'));
      const error = await wayloVoiceErrorFrom(createCall().start(START));

      expect(error.code).toBe('CONNECTION_FAILED');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lastRoom().connect).not.toHaveBeenCalled();
    });

    it('rejects a second start() while the first is fetching, with one fetch in total', async () => {
      const gate = deferred<Response>();

      sessionEndpoint.respond = () => gate.promise;
      const call = createCall();
      const started = call.start(START);
      const { code } = await wayloVoiceErrorFrom(call.start(START));

      expect(code).toBe('ALREADY_STARTED');
      gate.reject(new TypeError('Failed to fetch'));
      await wayloVoiceErrorFrom(started);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('calls headers() once per start() and sends the result only to the session endpoint', async () => {
      const headers = vi.fn(() => ({ Authorization: HEADER_SECRET }));

      await createCall({ headers }).start(START);
      const room = lastRoom();

      expect(headers).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
        Authorization: HEADER_SECRET,
        'Content-Type': 'application/json',
      });
      expect(JSON.stringify([room.options, room.connect.mock.calls])).not.toContain(HEADER_SECRET);
    });

    it('never logs header values or puts them in states or errors', async () => {
      const consoleSpies = (['debug', 'error', 'info', 'log', 'warn'] as const).map(method =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );

      sessionEndpoint.respond = () =>
        Promise.reject(new TypeError(`request with ${HEADER_SECRET} failed`));
      const call = createCall({ headers: () => ({ Authorization: HEADER_SECRET }) });
      const publicOutput = recordPublicOutput(call);
      const error = await wayloVoiceErrorFrom(call.start(START));

      expect(call.getState().end?.status).toBe('failed');
      expect(everyErrorSurface(error)).not.toContain(HEADER_SECRET);
      expect(publicOutput()).not.toContain(HEADER_SECRET);

      for (const spy of consoleSpies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(HEADER_SECRET);
        spy.mockRestore();
      }
    });

    it('exposes no connection details in the return value, states, errors or the instance', async () => {
      serveSession(webSessionBootstrap({ turn: TEST_TURN_SERVER }));
      const call = createCall();
      const publicOutput = recordPublicOutput(call);
      const secrets = [
        TEST_LIVEKIT_URL,
        TEST_PARTICIPANT_TOKEN,
        TEST_TURN_SERVER.credential,
        TEST_TURN_SERVER.username,
      ];

      const result = await call.start(START);

      const transcript = createTextStream('ST_A', { 'lk.segment_id': 'SG_A' });

      lastRoom().streamText(transcript, 'agent');
      transcript.push('Hello');
      transcript.end();
      await flush();
      lastRoom().serverDisconnect(DisconnectReason.SIGNAL_CLOSE);
      await flush();
      const { end } = call.getState();
      const surfaces = [
        JSON.stringify(result ?? null),
        publicOutput(),
        JSON.stringify(call),
        Object.keys(call).join(','),
        end?.status === 'failed' ? everyErrorSurface(end.error) : '',
      ].join('\n');

      expect(result).toBeUndefined();
      expect(end).toMatchObject({ error: { code: 'CONNECTION_FAILED' }, status: 'failed' });
      expect(publicOutput()).toContain('Hello');

      for (const secret of secrets) expect(surfaces).not.toContain(secret);
    });

    it('redacts the LiveKit address, token and TURN credential from a connect error', async () => {
      serveSession(webSessionBootstrap({ turn: TEST_TURN_SERVER }));
      behavior.connect = () =>
        Promise.reject(
          ConnectionError.serverUnreachable(
            `${TEST_LIVEKIT_URL} unreachable (${TEST_PARTICIPANT_TOKEN}, ${TEST_TURN_SERVER.credential})`,
          ),
        );
      const error = await wayloVoiceErrorFrom(createCall().start(START));
      const surfaces = everyErrorSurface(error);

      expect(error.code).toBe('CONNECTION_FAILED');

      for (const secret of [
        TEST_LIVEKIT_URL,
        TEST_PARTICIPANT_TOKEN,
        TEST_TURN_SERVER.credential,
      ]) {
        expect(surfaces).not.toContain(secret);
      }
    });
  });
});
