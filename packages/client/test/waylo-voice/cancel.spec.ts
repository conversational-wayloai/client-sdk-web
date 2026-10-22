import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WayloVoice } from '../../src/index.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { errorCodeFrom } from '../__setup__/errors.js';
import { audioElements, behavior, deferred, flush, lastRoom } from '../__setup__/fake-room.js';
import {
  createCall,
  fetchMock,
  sessionEndpoint,
  START,
} from '../__setup__/fake-session-endpoint.js';

async function expectCancelledAndClean(call: WayloVoice, started: Promise<void>) {
  const states: string[] = [];

  inspectCall(call).onState(state => states.push(state));
  await call.stop();
  await expect(errorCodeFrom(started)).resolves.toBe('CANCELLED');
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
    it('aborts the session fetch, never connects and never turns the mic on', async () => {
      const gate = deferred<Response>();

      sessionEndpoint.respond = () => gate.promise;
      const call = createCall();
      const started = call.start(START);

      await flush();
      const signal = fetchMock.mock.calls[0]?.[1]?.signal;

      expect(signal?.aborted).toBe(false);
      await expectCancelledAndClean(call, started);
      expect(signal?.aborted).toBe(true);
      gate.reject(new DOMException('aborted', 'AbortError'));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lastRoom().connect).not.toHaveBeenCalled();
      expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('cancels while headers() is pending and never calls the endpoint', async () => {
      const gate = deferred<Record<string, string>>();
      const call = createCall({ headers: () => gate.promise });
      const started = call.start(START);

      await flush();
      await expectCancelledAndClean(call, started);
      gate.resolve({ Authorization: 'Bearer late' });
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lastRoom().connect).not.toHaveBeenCalled();
    });

    it('cancels right after start() is called, before connect settles', async () => {
      const call = createCall();
      const started = call.start(START);

      await expectCancelledAndClean(call, started);
      expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('disconnects the room during connect so the pending connect rejects', async () => {
      const gate = deferred();

      behavior.connect = () => gate.promise;
      const call = createCall();
      const started = call.start(START);

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
      const call = createCall();
      const started = call.start(START);

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
      const call = createCall();
      const started = call.start(START);

      await flush();
      await call.stop();
      gate.reject(new DOMException('denied', 'NotAllowedError'));
      await expect(errorCodeFrom(started)).resolves.toBe('CANCELLED');
    });

    it('cancels while waiting for the agent', async () => {
      behavior.agent = 'later';
      const call = createCall();
      const started = call.start(START);

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
      const call = createCall();
      const started = call.start(START);

      await flush();
      await flush();
      expect(vi.getTimerCount()).toBe(1);
      await call.stop();
      await expect(errorCodeFrom(started)).resolves.toBe('CANCELLED');
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stays CANCELLED and clears the session timeout when stopped during the fetch', async () => {
      vi.useFakeTimers();
      sessionEndpoint.respond = () => deferred<Response>().promise;
      const call = createCall();
      const started = call.start(START);

      await vi.advanceTimersByTimeAsync(5000);
      await call.stop();
      await expect(errorCodeFrom(started)).resolves.toBe('CANCELLED');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(inspectCall(call).state).toBe('stopped');
      expect(inspectCall(call).error).toBeUndefined();
    });

    it('rejects start() after a CANCELLED start with ALREADY_STARTED', async () => {
      const call = createCall();
      const started = call.start(START);

      await call.stop();
      await expect(errorCodeFrom(started)).resolves.toBe('CANCELLED');
      await expect(errorCodeFrom(call.start(START))).resolves.toBe('ALREADY_STARTED');
      expect(inspectCall(call).state).toBe('stopped');
    });
  });
});
