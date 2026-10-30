import { DisconnectReason } from 'livekit-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ERROR_DISCONNECT_REASONS, LOST_DISCONNECT_REASONS } from '../../src/session-outcome.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { activeCall } from '../__setup__/active-call.js';
import { wayloVoiceErrorFrom } from '../__setup__/errors.js';
import { audioElements, behavior, FakeRoom, flush, lastRoom } from '../__setup__/fake-room.js';
import { createCall, START } from '../__setup__/fake-session-endpoint.js';

afterEach(() => {
  vi.useRealTimers();
});

async function expectCleanedUp(room: FakeRoom) {
  await flush();
  expect(room.listenersAtDisconnect).toBe(0);
  expect(room.listenerCount()).toBe(0);
  expect(room.disconnect).toHaveBeenCalledTimes(1);
  expect(audioElements()).toBe(0);
  expect(room.localParticipant.microphone?.track.mediaStreamTrack.readyState).toBe('ended');
}

async function rejoinWithoutAgent() {
  const room = lastRoom();

  room.state = 'reconnecting';
  room.emit('reconnecting');
  room.removeParticipant('agent');
  await flush();
  room.state = 'connected';
  room.emit('reconnected');
  await flush();
}

describe('WayloVoice', () => {
  describe('room disconnected while active', () => {
    it.each([...ERROR_DISCONNECT_REASONS].map(reason => [DisconnectReason[reason], reason]))(
      'fails with CONNECTION_FAILED on %s',
      async (name, reason) => {
        const { call, room } = await activeCall();

        room.serverDisconnect(reason);
        expect(inspectCall(call).phase).toBe('failed');
        expect(inspectCall(call).error?.code).toBe('CONNECTION_FAILED');
        expect(inspectCall(call).error?.cause).toMatchObject({ disconnectReason: name });
        await expectCleanedUp(room);
      },
    );

    it.each([...LOST_DISCONNECT_REASONS].map(reason => [DisconnectReason[reason], reason]))(
      'fails with CONNECTION_LOST on %s',
      async (name, reason) => {
        const { call, room } = await activeCall();

        room.serverDisconnect(reason);
        expect(inspectCall(call).phase).toBe('failed');
        expect(inspectCall(call).error?.code).toBe('CONNECTION_LOST');
        expect(inspectCall(call).error?.cause).toMatchObject({ disconnectReason: name });
        await expectCleanedUp(room);
      },
    );

    it.each(['reconnecting', 'signalReconnecting'])(
      'fails once with CONNECTION_LOST when LiveKit gives up after %s',
      async event => {
        const { call, errors, room, states } = await activeCall();

        room.state = 'reconnecting';
        room.emit(event);
        room.serverDisconnect(undefined);
        await flush();
        expect(inspectCall(call).phase).toBe('failed');
        expect(errors.map(error => error.code)).toEqual(['CONNECTION_LOST']);
        expect(states.filter(state => state.end)).toHaveLength(1);
        expect(call.getState()).toMatchObject({
          end: { error: { code: 'CONNECTION_LOST' }, status: 'failed' },
          stage: 'ended',
        });
        await expectCleanedUp(room);
      },
    );

    it('ends on a clean disconnect after a reconnect succeeded', async () => {
      const { call, room } = await activeCall();

      room.emit('reconnecting');
      room.emit('reconnected');
      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      expect(inspectCall(call).phase).toBe('ended');
    });

    it('ends completed with caller_hangup on stop()', async () => {
      const { call, errors, room } = await activeCall();

      await call.stop();
      expect(errors).toEqual([]);
      expect(call.getState().end).toEqual({ reason: 'caller_hangup', status: 'completed' });
      await expectCleanedUp(room);
    });

    it.each([
      ['ROOM_DELETED', DisconnectReason.ROOM_DELETED],
      ['PARTICIPANT_REMOVED', DisconnectReason.PARTICIPANT_REMOVED],
      ['CLIENT_INITIATED', DisconnectReason.CLIENT_INITIATED],
      ['no reason', undefined],
    ])('ends on %s', async (_name, reason) => {
      const { call, room } = await activeCall();

      room.serverDisconnect(reason);
      expect(inspectCall(call).phase).toBe('ended');
      expect(inspectCall(call).error).toBeUndefined();
      await expectCleanedUp(room);
    });

    it('fails when session_status=failed, even on a clean disconnect', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'failed', session_end_reason: 'worker_error' };
      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      expect(inspectCall(call).phase).toBe('failed');
      expect(inspectCall(call).error?.code).toBe('AGENT_ERROR');
      await expectCleanedUp(room);
    });

    it('ends when session_status=completed, even on an error reason', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'completed', session_end_reason: 'agent_end' };
      room.serverDisconnect(DisconnectReason.SIGNAL_CLOSE);
      expect(inspectCall(call).phase).toBe('ended');
    });

    it('resolves stop() after the agent ended the call without disconnecting twice', async () => {
      const { call, room } = await activeCall();

      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      await call.stop();
      await call.stop();
      expect(room.disconnect).toHaveBeenCalledTimes(1);
      expect(inspectCall(call).phase).toBe('ended');
    });

    it('keeps the call active through reconnecting and reconnected', async () => {
      const { call, room } = await activeCall();

      room.emit('reconnecting');
      room.emit('reconnected');
      expect(inspectCall(call).phase).toBe('active');
      expect(audioElements()).toBe(1);
    });
  });

  describe('agent left while active', () => {
    it('fails with AGENT_LEFT when the agent leaves without a verdict', async () => {
      const { call, room } = await activeCall();

      room.removeParticipant('agent', DisconnectReason.CLIENT_INITIATED);
      await flush();
      expect(inspectCall(call).phase).toBe('failed');
      expect(inspectCall(call).error?.code).toBe('AGENT_LEFT');
      expect(inspectCall(call).error?.cause).toMatchObject({
        disconnectReason: 'CLIENT_INITIATED',
        message: 'Agent left the room unexpectedly.',
      });
      await expectCleanedUp(room);
    });

    it('fails with AGENT_ERROR when the agent leaves after session_status=failed', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'failed' };
      room.removeParticipant('agent');
      await flush();
      expect(inspectCall(call).phase).toBe('failed');
      expect(inspectCall(call).error?.code).toBe('AGENT_ERROR');
      await expectCleanedUp(room);
    });

    it('ends when the agent leaves after session_status=completed', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'completed', session_end_reason: 'agent_end' };
      room.removeParticipant('agent');
      await flush();
      expect(inspectCall(call).phase).toBe('ended');
      expect(inspectCall(call).error).toBeUndefined();
      await expectCleanedUp(room);
    });

    it('ignores other participants leaving', async () => {
      const { call, room } = await activeCall();

      room.addHuman();
      room.removeParticipant('someone');
      await flush();
      expect(inspectCall(call).phase).toBe('active');
    });

    it('ignores the agent "leaving" as part of a full reconnect', async () => {
      const { call, room } = await activeCall();

      room.removeParticipant('agent');
      room.state = 'reconnecting';
      room.emit('reconnecting');
      await flush();
      expect(inspectCall(call).phase).toBe('active');
    });

    it('lets a room Disconnected in the same tick decide instead', async () => {
      const { call, room } = await activeCall();

      room.removeParticipant('agent');
      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      await flush();
      expect(inspectCall(call).phase).toBe('ended');
    });
  });

  describe('agent check after a reconnect', () => {
    it('keeps the call when the agent is in the room at Reconnected', async () => {
      const { call, room, states } = await activeCall();

      vi.useFakeTimers();
      room.emit('reconnecting');
      room.emit('reconnected');
      await vi.advanceTimersByTimeAsync(5000);
      expect(inspectCall(call).phase).toBe('active');
      expect(states.some(state => state.end)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the call when the agent reappears within 5 s', async () => {
      const { call, room } = await activeCall();

      vi.useFakeTimers();
      await rejoinWithoutAgent();
      expect(call.getState().agent).toBe('none');
      await vi.advanceTimersByTimeAsync(3000);
      room.addAgent();
      await flush();
      await vi.advanceTimersByTimeAsync(5000);
      expect(inspectCall(call).phase).toBe('active');
      expect(call.getState()).toMatchObject({ agent: 'listening', connection: 'connected' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('fails with CONNECTION_LOST when no agent is back within 5 s', async () => {
      const { call, errors, room, states } = await activeCall();

      vi.useFakeTimers();
      await rejoinWithoutAgent();
      await vi.advanceTimersByTimeAsync(4999);
      expect(inspectCall(call).phase).toBe('active');

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(inspectCall(call).phase).toBe('failed');
      expect(errors.map(error => error.code)).toEqual(['CONNECTION_LOST']);
      expect(states.filter(state => state.end)).toHaveLength(1);
      expect(call.getState()).toMatchObject({
        end: { error: { code: 'CONNECTION_LOST' }, status: 'failed' },
        stage: 'ended',
      });
      expect(vi.getTimerCount()).toBe(0);
      await expectCleanedUp(room);
    });

    it('cancels the wait on stop() without an error', async () => {
      const { call, errors, room } = await activeCall();

      vi.useFakeTimers();
      await rejoinWithoutAgent();
      expect(vi.getTimerCount()).toBe(1);
      await call.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(inspectCall(call).phase).toBe('stopped');
      expect(errors).toEqual([]);
      expect(call.getState().end).toEqual({ reason: 'caller_hangup', status: 'completed' });
      await expectCleanedUp(room);
    });

    it('cancels the wait when a new reconnect starts', async () => {
      const { call, room } = await activeCall();

      vi.useFakeTimers();
      await rejoinWithoutAgent();
      expect(vi.getTimerCount()).toBe(1);
      room.state = 'reconnecting';
      room.emit('reconnecting');
      await vi.advanceTimersByTimeAsync(5000);
      expect(inspectCall(call).phase).toBe('active');
      expect(call.getState().connection).toBe('reconnecting');
    });

    it('ends once when the agent-left event comes during the wait', async () => {
      const { agent, call, errors, room, states } = await activeCall();

      vi.useFakeTimers();
      room.state = 'reconnecting';
      room.emit('reconnecting');
      room.remoteParticipants.delete('agent');
      room.state = 'connected';
      room.emit('reconnected');
      await flush();
      room.emit('participantDisconnected', agent, DisconnectReason.CLIENT_INITIATED);
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(errors.map(error => error.code)).toEqual(['AGENT_LEFT']);
      expect(inspectCall(call).error?.cause).toMatchObject({
        disconnectReason: 'CLIENT_INITIATED',
      });
      expect(states.filter(state => state.end)).toHaveLength(1);
      await expectCleanedUp(room);
    });
  });

  describe('room disconnected while starting', () => {
    it('fails with CONNECTION_FAILED after connect, while waiting for the agent', async () => {
      behavior.agent = 'later';
      const call = createCall();
      const started = call.start(START);

      await flush();
      lastRoom().serverDisconnect(DisconnectReason.SERVER_SHUTDOWN);
      const error = await wayloVoiceErrorFrom(started);

      expect(error.code).toBe('CONNECTION_FAILED');
      expect(inspectCall(call).phase).toBe('failed');
      await expectCleanedUp(lastRoom());
    });
  });
});
