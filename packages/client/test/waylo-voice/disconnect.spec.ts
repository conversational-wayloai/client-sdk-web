import { DisconnectReason } from 'livekit-client';
import { describe, expect, it } from 'vitest';

import { WayloVoice } from '../../src/index.js';
import { ERROR_DISCONNECT_REASONS } from '../../src/session-outcome.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { wayloVoiceErrorFrom } from '../__setup__/errors.js';
import { audioElements, behavior, FakeRoom, flush, lastRoom } from '../__setup__/fake-room.js';
import { webSessionBootstrap } from '../__setup__/fixtures.js';

async function activeCall() {
  const call = new WayloVoice();

  await call.start(webSessionBootstrap());
  const room = lastRoom();
  const agent = room.remoteParticipants.get('agent');

  if (!agent) throw new Error('no agent');

  return { agent, call, room };
}

async function expectCleanedUp(room: FakeRoom) {
  await flush();
  expect(room.listenersAtDisconnect).toBe(0);
  expect(room.listenerCount()).toBe(0);
  expect(room.disconnect).toHaveBeenCalledTimes(1);
  expect(audioElements()).toBe(0);
  expect(room.localParticipant.microphone?.track.mediaStreamTrack.readyState).toBe('ended');
}

describe('WayloVoice', () => {
  describe('room disconnected while active', () => {
    it.each([...ERROR_DISCONNECT_REASONS].map(reason => [DisconnectReason[reason], reason]))(
      'fails with connection_failed on %s',
      async (name, reason) => {
        const { call, room } = await activeCall();

        room.serverDisconnect(reason);
        expect(inspectCall(call).state).toBe('failed');
        expect(inspectCall(call).error?.code).toBe('connection_failed');
        expect(inspectCall(call).error?.cause).toMatchObject({ disconnectReason: name });
        await expectCleanedUp(room);
      },
    );

    it.each([
      ['ROOM_DELETED', DisconnectReason.ROOM_DELETED],
      ['PARTICIPANT_REMOVED', DisconnectReason.PARTICIPANT_REMOVED],
      ['CLIENT_INITIATED', DisconnectReason.CLIENT_INITIATED],
      ['no reason', undefined],
    ])('ends on %s', async (_name, reason) => {
      const { call, room } = await activeCall();

      room.serverDisconnect(reason);
      expect(inspectCall(call).state).toBe('ended');
      expect(inspectCall(call).error).toBeUndefined();
      await expectCleanedUp(room);
    });

    it('fails when session_status=failed, even on a clean disconnect', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'failed', session_end_reason: 'worker_error' };
      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      expect(inspectCall(call).state).toBe('failed');
      await expectCleanedUp(room);
    });

    it('ends when session_status=completed, even on an error reason', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'completed', session_end_reason: 'agent_end' };
      room.serverDisconnect(DisconnectReason.SIGNAL_CLOSE);
      expect(inspectCall(call).state).toBe('ended');
    });

    it('resolves stop() after the agent ended the call without disconnecting twice', async () => {
      const { call, room } = await activeCall();

      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      await call.stop();
      await call.stop();
      expect(room.disconnect).toHaveBeenCalledTimes(1);
      expect(inspectCall(call).state).toBe('ended');
    });

    it('keeps the call active through reconnecting and reconnected', async () => {
      const { call, room } = await activeCall();

      room.emit('reconnecting');
      room.emit('reconnected');
      expect(inspectCall(call).state).toBe('active');
      expect(audioElements()).toBe(1);
    });
  });

  describe('agent left while active', () => {
    it('fails with agent_left when the agent leaves without a verdict', async () => {
      const { call, room } = await activeCall();

      room.removeParticipant('agent', DisconnectReason.CLIENT_INITIATED);
      await flush();
      expect(inspectCall(call).state).toBe('failed');
      expect(inspectCall(call).error?.code).toBe('agent_left');
      expect(inspectCall(call).error?.cause).toMatchObject({
        disconnectReason: 'CLIENT_INITIATED',
        message: 'Agent left the room unexpectedly.',
      });
      await expectCleanedUp(room);
    });

    it('fails with agent_left when the agent leaves after session_status=failed', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'failed' };
      room.removeParticipant('agent');
      await flush();
      expect(inspectCall(call).state).toBe('failed');
      expect(inspectCall(call).error?.code).toBe('agent_left');
      await expectCleanedUp(room);
    });

    it('ends when the agent leaves after session_status=completed', async () => {
      const { agent, call, room } = await activeCall();

      agent.attributes = { session_status: 'completed', session_end_reason: 'agent_end' };
      room.removeParticipant('agent');
      await flush();
      expect(inspectCall(call).state).toBe('ended');
      expect(inspectCall(call).error).toBeUndefined();
      await expectCleanedUp(room);
    });

    it('ignores other participants leaving', async () => {
      const { call, room } = await activeCall();

      room.addHuman();
      room.removeParticipant('someone');
      await flush();
      expect(inspectCall(call).state).toBe('active');
    });

    it('ignores the agent "leaving" as part of a full reconnect', async () => {
      const { call, room } = await activeCall();

      room.removeParticipant('agent');
      room.state = 'reconnecting';
      room.emit('reconnecting');
      await flush();
      expect(inspectCall(call).state).toBe('active');
    });

    it('lets a room Disconnected in the same tick decide instead', async () => {
      const { call, room } = await activeCall();

      room.removeParticipant('agent');
      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      await flush();
      expect(inspectCall(call).state).toBe('ended');
    });
  });

  describe('room disconnected while starting', () => {
    it('fails with connection_failed after connect, while waiting for the agent', async () => {
      behavior.agent = 'later';
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await flush();
      lastRoom().serverDisconnect(DisconnectReason.SERVER_SHUTDOWN);
      const error = await wayloVoiceErrorFrom(started);

      expect(error.code).toBe('connection_failed');
      expect(inspectCall(call).state).toBe('failed');
      await expectCleanedUp(lastRoom());
    });
  });
});
