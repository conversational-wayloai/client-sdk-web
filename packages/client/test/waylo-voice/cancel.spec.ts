import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WayloVoice } from '../../src/index.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { errorCodeFrom } from '../__setup__/errors.js';
import { audioElements, behavior, deferred, flush, lastRoom } from '../__setup__/fake-room.js';
import { webSessionBootstrap } from '../__setup__/fixtures.js';

async function expectCancelledAndClean(call: WayloVoice, started: Promise<void>) {
  const states: string[] = [];

  inspectCall(call).onState(state => states.push(state));
  await call.stop();
  await expect(errorCodeFrom(started)).resolves.toBe('cancelled');
  await flush();
  const room = lastRoom();

  expect(room.listenersAtDisconnect).toBe(0);
  expect(room.listenerCount()).toBe(0);
  expect(room.disconnect).toHaveBeenCalledTimes(1);
  expect(audioElements()).toBe(0);
  expect(isMicLeftLive()).toBe(false);
  expect(states).toEqual(['stopping', 'stopped']);
  expect(inspectCall(call).error).toBeUndefined();
}

function isMicLeftLive(): boolean {
  return lastRoom().localParticipant.microphoneTracks.some(
    track => track.mediaStreamTrack.readyState === 'live',
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WayloVoice', () => {
  describe('stop() during start()', () => {
    it('cancels right after start() is called, before connect settles', async () => {
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await expectCancelledAndClean(call, started);
      expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('disconnects the room during connect so the pending connect rejects', async () => {
      const gate = deferred();

      behavior.connect = () => gate.promise;
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await flush();
      expect(lastRoom().state).toBe('connecting');
      await expectCancelledAndClean(call, started);
      gate.resolve();
      await flush();
      expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
      expect(lastRoom().state).toBe('disconnected');
    });

    it('stops a mic track that arrives after the cancel', async () => {
      const gate = deferred();

      behavior.microphone = () => gate.promise;
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await flush();
      expect(lastRoom().localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
      await expectCancelledAndClean(call, started);
      gate.resolve();
      await flush();
      expect(lastRoom().localParticipant.microphoneTracks).toHaveLength(1);
      expect(isMicLeftLive()).toBe(false);
      expect(inspectCall(call).state).toBe('stopped');
    });

    it('reports cancelled when the mic fails after the cancel', async () => {
      const gate = deferred();

      behavior.microphone = () => gate.promise;
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await flush();
      await call.stop();
      gate.reject(new DOMException('denied', 'NotAllowedError'));
      await expect(errorCodeFrom(started)).resolves.toBe('cancelled');
    });

    it('cancels while waiting for the agent', async () => {
      behavior.agent = 'later';
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await flush();
      expect(lastRoom().localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
      await expectCancelledAndClean(call, started);
      lastRoom().addAgent();
      expect(inspectCall(call).state).toBe('stopped');
      expect(audioElements()).toBe(0);
    });

    it('clears the agent timer when cancelled while waiting for the agent', async () => {
      vi.useFakeTimers();
      behavior.agent = 'later';
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await flush();
      await flush();
      expect(vi.getTimerCount()).toBe(1);
      await call.stop();
      await expect(errorCodeFrom(started)).resolves.toBe('cancelled');
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects start() after a cancelled start with already_started', async () => {
      const call = new WayloVoice();
      const started = call.start(webSessionBootstrap());

      await call.stop();
      await expect(errorCodeFrom(started)).resolves.toBe('cancelled');
      await expect(errorCodeFrom(call.start(webSessionBootstrap()))).resolves.toBe(
        'already_started',
      );
      expect(inspectCall(call).state).toBe('stopped');
    });
  });
});
