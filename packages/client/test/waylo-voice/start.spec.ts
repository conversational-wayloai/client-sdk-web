import {
  ConnectionError,
  ConnectionErrorReason,
  DisconnectReason,
  MediaDeviceFailure,
} from 'livekit-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WayloVoice } from '../../src/index.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { everyErrorSurface, wayloVoiceErrorFrom } from '../__setup__/errors.js';
import { audioElements, behavior, FakeRoom, flush, lastRoom } from '../__setup__/fake-room.js';
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

beforeEach(() => {
  vi.useRealTimers();
});

describe('WayloVoice', () => {
  describe('start()', () => {
    it('connects, enables the mic, plays agent audio and resolves when the agent is in', async () => {
      const call = new WayloVoice();
      const states: string[] = [];

      inspectCall(call).onState(state => states.push(state));

      await call.start(webSessionBootstrap());
      const room = lastRoom();

      expect(room.options).toEqual({ adaptiveStream: false, dynacast: false });
      expect(room.startAudio).toHaveBeenCalledTimes(1);
      expect(room.connect).toHaveBeenCalledWith(TEST_LIVEKIT_URL, TEST_PARTICIPANT_TOKEN, {});
      expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
      expect(audioElements()).toBe(1);
      expect(states).toEqual(['starting', 'active']);
    });

    it('creates the room and unlocks audio synchronously, before any await', async () => {
      const started = new WayloVoice().start(webSessionBootstrap());
      const room = lastRoom();

      expect(room.startAudio).toHaveBeenCalledTimes(1);
      expect(room.connect).toHaveBeenCalledTimes(1);
      await started;
    });

    it('registers room listeners before connecting', async () => {
      let listenersAtConnect = 0;

      behavior.connect = () => {
        listenersAtConnect = lastRoom().listenerCount();

        return Promise.resolve();
      };

      await new WayloVoice().start(webSessionBootstrap());
      expect(listenersAtConnect).toBe(2);
    });

    it('forces relay ICE through the TURN server when the session has one', async () => {
      await new WayloVoice().start(webSessionBootstrap({ turn: TEST_TURN_SERVER }));
      expect(lastRoom().connect).toHaveBeenCalledWith(TEST_LIVEKIT_URL, TEST_PARTICIPANT_TOKEN, {
        rtcConfig: { iceServers: [TEST_TURN_SERVER], iceTransportPolicy: 'relay' },
      });
    });

    it('does not override rtcConfig without TURN', async () => {
      await new WayloVoice().start(webSessionBootstrap());
      const options = lastRoom().connect.mock.calls[0]?.[2];

      expect(options).not.toHaveProperty('rtcConfig');
    });

    it('plays every agent audio track, including background_audio', async () => {
      behavior.agentTracks = 2;
      await new WayloVoice().start(webSessionBootstrap());
      expect(audioElements()).toBe(2);
    });

    it('resolves at once when the agent is already in the room', async () => {
      vi.useFakeTimers();
      const call = new WayloVoice({ agentTimeoutMs: 1000 });

      await call.start(webSessionBootstrap());
      expect(inspectCall(call).state).toBe('active');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for an agent that joins later, ignoring non-agents', async () => {
      behavior.agent = 'later';
      const call = new WayloVoice();
      let isResolved = false;
      const started = call.start(webSessionBootstrap()).then(() => {
        isResolved = true;
      });

      await flush();
      lastRoom().addHuman();
      await flush();
      expect(isResolved).toBe(false);
      lastRoom().addAgent();
      await started;
      expect(inspectCall(call).state).toBe('active');
      expect(audioElements()).toBe(1);
    });

    it('fails with agent_timeout and cleans up when the agent never joins', async () => {
      vi.useFakeTimers();
      behavior.agent = 'later';
      const call = new WayloVoice({ agentTimeoutMs: 5000 });
      const failure = wayloVoiceErrorFrom(call.start(webSessionBootstrap()));

      await vi.advanceTimersByTimeAsync(4999);
      expect(inspectCall(call).state).toBe('starting');
      await vi.advanceTimersByTimeAsync(1);
      const { code } = await failure;

      expect(code).toBe('agent_timeout');
      expect(inspectCall(call).state).toBe('failed');
      expectCleanedUp(lastRoom());
    });

    it('defaults agentTimeoutMs to 20 s', async () => {
      vi.useFakeTimers();
      behavior.agent = 'later';
      const failure = wayloVoiceErrorFrom(new WayloVoice().start(webSessionBootstrap()));

      await vi.advanceTimersByTimeAsync(19_999);
      await vi.advanceTimersByTimeAsync(1);
      const { code } = await failure;

      expect(code).toBe('agent_timeout');
    });

    it.each([
      ['NotAllowedError', 'microphone_denied'],
      ['NotFoundError', 'microphone_unavailable'],
      ['NotReadableError', 'microphone_unavailable'],
    ])('maps a %s from the mic to %s', async (name, code) => {
      behavior.microphone = () => Promise.reject(domError(name));
      const call = new WayloVoice();
      const error = await wayloVoiceErrorFrom(call.start(webSessionBootstrap()));

      expect(error.code).toBe(code);
      expect(MediaDeviceFailure.getFailure(error.cause)).toBeDefined();
      expect(inspectCall(call).state).toBe('failed');
      expectCleanedUp(lastRoom());
    });

    it.each([
      ['an OverconstrainedError', domError('OverconstrainedError'), 'microphone_unavailable'],
      ['any other DOMException', domError('AbortError'), 'connection_failed'],
      ['an unknown mic error', new Error('boom'), 'connection_failed'],
    ])('maps %s from the mic to %s', async (_label, failure, code) => {
      behavior.microphone = () => Promise.reject(failure);
      const error = await wayloVoiceErrorFrom(new WayloVoice().start(webSessionBootstrap()));

      expect(error.code).toBe(code);
    });

    it('rejects a session more than 60 s past expiresAt without connecting', async () => {
      const expiresAt = new Date(Date.now() - 61_000).toISOString();
      const error = await wayloVoiceErrorFrom(
        new WayloVoice().start(webSessionBootstrap({ expiresAt })),
      );

      expect(error.code).toBe('session_expired');
      expect(FakeRoom.instances).toHaveLength(0);
    });

    it('lets LiveKit decide within the 60 s tolerance', async () => {
      const expiresAt = new Date(Date.now() - 30_000).toISOString();

      await new WayloVoice().start(webSessionBootstrap({ expiresAt }));
      expect(lastRoom().connect).toHaveBeenCalledTimes(1);
    });

    it('maps a LiveKit 401 / NotAllowed to session_expired and keeps the HTTP status', async () => {
      behavior.connect = () => Promise.reject(ConnectionError.notAllowed('invalid token', 401));
      const error = await wayloVoiceErrorFrom(new WayloVoice().start(webSessionBootstrap()));

      expect(error.code).toBe('session_expired');
      expect(error.cause).toMatchObject({
        name: 'ConnectionError',
        reason: ConnectionErrorReason.NotAllowed,
        status: 401,
      });
    });

    it('keeps the disconnect reason name of a LiveKit leave request', async () => {
      behavior.connect = () =>
        Promise.reject(ConnectionError.leaveRequest('left', DisconnectReason.JOIN_FAILURE));
      const error = await wayloVoiceErrorFrom(new WayloVoice().start(webSessionBootstrap()));

      expect(error.code).toBe('connection_failed');
      expect(error.cause).toMatchObject({
        disconnectReason: 'JOIN_FAILURE',
        name: 'ConnectionError',
        reason: ConnectionErrorReason.LeaveRequest,
      });
    });

    it('maps any other connect failure to connection_failed', async () => {
      behavior.connect = () => Promise.reject(ConnectionError.serverUnreachable('nope'));
      const call = new WayloVoice();
      const error = await wayloVoiceErrorFrom(call.start(webSessionBootstrap()));

      expect(error.code).toBe('connection_failed');
      expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
      expectCleanedUp(lastRoom());
    });

    it('rejects an invalid session with invalid_session', async () => {
      const error = await wayloVoiceErrorFrom(new WayloVoice().start({} as never));

      expect(error.code).toBe('invalid_session');
    });

    it('rejects a second start() with already_started', async () => {
      const call = new WayloVoice();

      await call.start(webSessionBootstrap());
      const { code } = await wayloVoiceErrorFrom(call.start(webSessionBootstrap()));

      expect(code).toBe('already_started');
    });

    it('rejects start() after a failed start with already_started', async () => {
      const call = new WayloVoice();

      await wayloVoiceErrorFrom(call.start({} as never));
      const { code } = await wayloVoiceErrorFrom(call.start(webSessionBootstrap()));

      expect(code).toBe('already_started');
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
      const error = await wayloVoiceErrorFrom(
        new WayloVoice().start(webSessionBootstrap({ turn: TEST_TURN_SERVER })),
      );
      const surfaces = everyErrorSurface(error);

      expect(error.code).toBe('session_expired');
      expect(surfaces).not.toContain(TEST_PARTICIPANT_TOKEN);
      expect(surfaces).not.toContain(credential);
    });
  });
});
