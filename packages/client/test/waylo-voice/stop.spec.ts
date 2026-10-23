import { describe, expect, it } from 'vitest';

import { inspectCall } from '../../src/waylo-voice.js';
import { errorCodeFrom } from '../__setup__/errors.js';
import { audioElements, FakeRoom, lastRoom } from '../__setup__/fake-room.js';
import { createCall, serveSession, START } from '../__setup__/fake-session-endpoint.js';

describe('WayloVoice', () => {
  describe('stop()', () => {
    it('leaves nothing behind after an active call', async () => {
      const call = createCall();

      await call.start(START);
      const room = lastRoom();
      const mic = room.localParticipant.microphone?.track;

      expect(audioElements()).toBe(1);

      await call.stop();

      expect(room.listenersAtDisconnect).toBe(0);
      expect(room.listenerCount()).toBe(0);
      expect(room.disconnect).toHaveBeenCalledTimes(1);
      expect(audioElements()).toBe(0);
      expect(document.body.children).toHaveLength(0);
      expect(mic?.stop).toHaveBeenCalled();
      expect(mic?.mediaStreamTrack.readyState).toBe('ended');
      expect(inspectCall(call).phase).toBe('stopped');
    });

    it('is safe to call twice, including concurrently', async () => {
      const call = createCall();

      await call.start(START);
      await Promise.all([call.stop(), call.stop()]);
      await call.stop();
      expect(lastRoom().disconnect).toHaveBeenCalledTimes(1);
      expect(inspectCall(call).phase).toBe('stopped');
    });

    it('is a no-op before start()', async () => {
      const call = createCall();

      await call.stop();
      expect(FakeRoom.instances).toHaveLength(0);
      expect(inspectCall(call).phase).toBe('idle');
    });

    it('detaches audio tracks the agent unpublishes mid-call', async () => {
      const call = createCall();

      await call.start(START);
      const room = lastRoom();
      const track = [...(room.remoteParticipants.get('agent')?.trackPublications.values() ?? [])][0]
        ?.track;

      room.emit('trackUnsubscribed', track);
      expect(audioElements()).toBe(0);
      expect(track?.detach).toHaveBeenCalledTimes(1);
      await call.stop();
    });
  });

  describe('start() on a used call', () => {
    it('rejects with ALREADY_STARTED after stop() and creates no room', async () => {
      const call = createCall();

      await call.start(START);
      await call.stop();
      await expect(call.stop()).resolves.toBeUndefined();
      await expect(errorCodeFrom(call.start(START))).resolves.toBe('ALREADY_STARTED');
      expect(FakeRoom.instances).toHaveLength(1);
      expect(inspectCall(call).phase).toBe('stopped');
    });

    it('rejects with ALREADY_STARTED after the call ended', async () => {
      const call = createCall();

      await call.start(START);
      lastRoom().serverDisconnect();
      expect(inspectCall(call).phase).toBe('ended');
      await expect(errorCodeFrom(call.start(START))).resolves.toBe('ALREADY_STARTED');
      await call.stop();
      expect(inspectCall(call).phase).toBe('ended');
    });

    it('rejects with ALREADY_STARTED after start() failed', async () => {
      const call = createCall();

      serveSession({});
      await expect(errorCodeFrom(call.start(START))).resolves.toBe('INVALID_SESSION');
      expect(inspectCall(call).phase).toBe('failed');
      await expect(errorCodeFrom(call.start(START))).resolves.toBe('ALREADY_STARTED');
      await expect(call.stop()).resolves.toBeUndefined();
      expect(inspectCall(call).phase).toBe('failed');
    });
  });

  describe('repeat calls', () => {
    it('leaves 0 listeners and 0 audio elements after 10 start/stop cycles on new objects', async () => {
      for (let index = 0; index < 10; index++) {
        const call = createCall();

        await call.start(START);
        await call.stop();
        expect(audioElements()).toBe(0);
      }

      expect(FakeRoom.instances).toHaveLength(10);

      for (const room of FakeRoom.instances) {
        expect(room.listenerCount()).toBe(0);
        expect(room.disconnect).toHaveBeenCalledTimes(1);
        expect(room.localParticipant.microphone?.track.mediaStreamTrack.readyState).toBe('ended');
      }

      expect(document.body.children).toHaveLength(0);
    });
  });
});
