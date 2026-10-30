import { DisconnectReason } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MIN_SHOWN_MS,
  RECONNECTING_AFTER_FLAT_MS,
  RECONNECTING_AFTER_SIGNAL_MS,
  RECONNECTING_LIMIT_MS,
  STATS_POLL_MS,
  UNSTABLE_AFTER_FLAT_MS,
  UNSTABLE_AFTER_ICE_DISCONNECTED_MS,
} from '../../src/connection-monitor.js';
import type { WayloVoiceState } from '../../src/index.js';
import { inspectCall, POOR_QUALITY_AFTER_MS } from '../../src/waylo-voice.js';
import { activeCall } from '../__setup__/active-call.js';
import { fakeNetwork } from '../__setup__/fake-media.js';
import { flush } from '../__setup__/fake-room.js';

beforeEach(() => {
  vi.useFakeTimers();
});

const calls: { stop(): Promise<void> }[] = [];

// A call left running would hear the next test's window events.
afterEach(async () => {
  await Promise.all(calls.splice(0).map(call => call.stop()));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function liveCall() {
  const started = await activeCall();

  calls.push(started.call);

  return started;
}

function view(state: WayloVoiceState) {
  return { connection: state.connection, network: state.network, stage: state.stage };
}

const CONNECTED = { connection: 'connected', network: 'good', stage: 'preparing' };
const UNSTABLE = { connection: 'connected', network: 'poor', stage: 'preparing' };
const RECONNECTING = { connection: 'reconnecting', network: 'poor', stage: 'reconnecting' };
const LIVEKIT_RECONNECTS: [string, (room: { emit(event: string): void }) => Promise<void>][] = [
  ['Reconnecting', async room => room.emit('reconnecting')],
  [
    'a 2 s SignalReconnecting',
    async room => {
      room.emit('signalReconnecting');
      await advance(RECONNECTING_AFTER_SIGNAL_MS);
    },
  ],
];

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

function spyWindowListeners() {
  const added = vi.spyOn(globalThis, 'addEventListener');
  const removed = vi.spyOn(globalThis, 'removeEventListener');

  return () => {
    const handler = added.mock.calls.find(([name]) => name === 'offline')?.[1];

    expect(handler).toBeDefined();
    expect(removed).toHaveBeenCalledWith('offline', handler);
  };
}

// Bytes last grew on the first poll, then stop.
async function stopBytes() {
  await advance(STATS_POLL_MS);
  fakeNetwork.isFlowing = false;
}

describe('WayloVoice connection health', () => {
  it('shows reconnecting at once when the browser goes offline', async () => {
    const { call } = await liveCall();

    globalThis.dispatchEvent(new Event('offline'));
    expect(view(call.getState())).toEqual(RECONNECTING);
  });

  it('shows nothing for 2 s without bytes', async () => {
    const { call, states } = await liveCall();
    const before = states.length;

    await stopBytes();
    await advance(UNSTABLE_AFTER_FLAT_MS - STATS_POLL_MS);
    fakeNetwork.isFlowing = true;
    await advance(5 * STATS_POLL_MS);
    expect(states).toHaveLength(before);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('shows a poor network after 3 s without bytes, keeping the call connected', async () => {
    const { call } = await liveCall();

    await stopBytes();
    await advance(UNSTABLE_AFTER_FLAT_MS - 1);
    expect(view(call.getState())).toEqual(CONNECTED);
    await advance(1);
    expect(view(call.getState())).toEqual(UNSTABLE);
  });

  it('shows reconnecting after 8 s without bytes', async () => {
    const { call } = await liveCall();

    await stopBytes();
    await advance(RECONNECTING_AFTER_FLAT_MS - STATS_POLL_MS);
    expect(view(call.getState())).toEqual(UNSTABLE);
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(RECONNECTING);
  });

  it('clears the poor network once bytes flow again for 1 s', async () => {
    const { call } = await liveCall();

    await stopBytes();
    await advance(UNSTABLE_AFTER_FLAT_MS);
    fakeNetwork.isFlowing = true;
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(UNSTABLE);
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('clears reconnecting from silence once bytes flow for 1 s while online', async () => {
    const { call } = await liveCall();

    await stopBytes();
    await advance(RECONNECTING_AFTER_FLAT_MS);
    expect(view(call.getState())).toEqual(RECONNECTING);
    fakeNetwork.isFlowing = true;
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(RECONNECTING);
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it.each(LIVEKIT_RECONNECTS)(
    'shows reconnecting again when LiveKit starts %s after it cleared on data return',
    async (_name, startReconnect) => {
      const { call, room } = await liveCall();

      await stopBytes();
      await advance(RECONNECTING_AFTER_FLAT_MS);
      fakeNetwork.isFlowing = true;
      await advance(2 * STATS_POLL_MS);
      expect(view(call.getState())).toEqual(CONNECTED);

      await advance(STATS_POLL_MS / 2);
      await startReconnect(room);
      expect(view(call.getState())).toEqual(RECONNECTING);
      room.emit('reconnected');
      await advance(MIN_SHOWN_MS - 1);
      expect(view(call.getState())).toEqual(RECONNECTING);
      await advance(1);
      expect(view(call.getState())).toEqual(CONNECTED);
    },
  );

  it('shows a poor network after ICE stays disconnected for 2 s', async () => {
    const { call } = await liveCall();

    fakeNetwork.iceState = 'disconnected';
    await advance(STATS_POLL_MS + UNSTABLE_AFTER_ICE_DISCONNECTED_MS - 1);
    expect(view(call.getState())).toEqual(CONNECTED);
    await advance(1);
    expect(view(call.getState())).toEqual(UNSTABLE);

    fakeNetwork.iceState = 'connected';
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('shows nothing when a signal reconnect resolves within 1 s', async () => {
    const { call, room, states } = await liveCall();
    const before = states.length;

    room.emit('signalReconnecting');
    await advance(1000);
    room.emit('reconnected');
    await advance(5 * STATS_POLL_MS);
    expect(states).toHaveLength(before);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('shows reconnecting once a signal reconnect lasts 2 s', async () => {
    const { call, room } = await liveCall();

    room.emit('signalReconnecting');
    await advance(RECONNECTING_AFTER_SIGNAL_MS - 1);
    expect(view(call.getState())).toEqual(CONNECTED);
    await advance(1);
    expect(view(call.getState())).toEqual(RECONNECTING);
  });

  it('clears a LiveKit reconnect only on Reconnected, not on online or flowing bytes', async () => {
    const { call, room } = await liveCall();

    room.emit('signalReconnecting');
    globalThis.dispatchEvent(new Event('offline'));
    globalThis.dispatchEvent(new Event('online'));
    await advance(10 * STATS_POLL_MS);
    expect(view(call.getState())).toEqual(RECONNECTING);

    room.emit('reconnected');
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('keeps reconnecting after offline while the browser is still offline', async () => {
    const { call } = await liveCall();

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    globalThis.dispatchEvent(new Event('offline'));
    await advance(5 * STATS_POLL_MS);
    expect(view(call.getState())).toEqual(RECONNECTING);
  });

  it('clears an offline blip once online with bytes flowing for 1 s', async () => {
    const { call } = await liveCall();

    globalThis.dispatchEvent(new Event('offline'));
    globalThis.dispatchEvent(new Event('online'));
    expect(view(call.getState())).toEqual(RECONNECTING);
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(RECONNECTING);
    await advance(STATS_POLL_MS);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('shows reconnecting for at least 1 s', async () => {
    const { call, room } = await liveCall();

    room.emit('reconnecting');
    room.emit('reconnected');
    expect(view(call.getState())).toEqual(RECONNECTING);
    await advance(MIN_SHOWN_MS - 1);
    expect(view(call.getState())).toEqual(RECONNECTING);
    await advance(1);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('keeps reconnecting when a new reconnect starts during the minimum display', async () => {
    const { call, room } = await liveCall();

    room.emit('reconnecting');
    room.emit('reconnected');
    room.emit('reconnecting');
    await advance(5 * MIN_SHOWN_MS);
    expect(view(call.getState())).toEqual(RECONNECTING);
  });

  it('shows the worse of LiveKit quality and the byte check', async () => {
    const { call, room } = await liveCall();

    await stopBytes();
    await advance(UNSTABLE_AFTER_FLAT_MS);
    room.emit('connectionQualityChanged', 'excellent', room.localParticipant);
    expect(call.getState().network).toBe('poor');
    room.emit('connectionQualityChanged', 'lost', room.localParticipant);
    await advance(POOR_QUALITY_AFTER_MS);
    expect(call.getState().network).toBe('lost');
    room.emit('connectionQualityChanged', 'good', room.localParticipant);
    fakeNetwork.isFlowing = true;
    await advance(2 * STATS_POLL_MS);
    expect(call.getState().network).toBe('good');
  });

  it('ignores a LiveKit poor quality that lasts under 2 s', async () => {
    const { call, room, states } = await liveCall();
    const before = states.length;

    room.emit('connectionQualityChanged', 'poor', room.localParticipant);
    await advance(POOR_QUALITY_AFTER_MS / 2);
    room.emit('connectionQualityChanged', 'good', room.localParticipant);
    await advance(5 * POOR_QUALITY_AFTER_MS);
    expect(states).toHaveLength(before);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it.each(['poor', 'lost'] as const)(
    'shows a LiveKit %s quality once it lasts 2 s',
    async quality => {
      const { call, room } = await liveCall();

      room.emit('connectionQualityChanged', quality, room.localParticipant);
      await advance(POOR_QUALITY_AFTER_MS - 1);
      expect(call.getState().network).toBe('good');
      await advance(1);
      expect(call.getState().network).toBe(quality);
      room.emit('connectionQualityChanged', 'good', room.localParticipant);
      expect(call.getState().network).toBe('good');
    },
  );

  it('keeps polling when a stats read fails', async () => {
    const { call, room } = await liveCall();
    const track = room.localParticipant.microphone?.track;

    track?.getRTCStatsReport.mockRejectedValue(new Error('closed'));
    await advance(5 * STATS_POLL_MS);
    expect(view(call.getState())).toEqual(CONNECTED);
  });

  it('fails with CONNECTION_LOST when LiveKit gives up while reconnecting', async () => {
    const { call, errors, room } = await liveCall();

    globalThis.dispatchEvent(new Event('offline'));
    room.state = 'reconnecting';
    room.emit('signalReconnecting');
    room.serverDisconnect(undefined);
    await flush();
    expect(errors.map(error => error.code)).toEqual(['CONNECTION_LOST']);
    expect(inspectCall(call).phase).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['LiveKit', (room: { emit(event: string): void }) => room.emit('reconnecting')],
    [
      'offline',
      () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        globalThis.dispatchEvent(new Event('offline'));
      },
    ],
  ])('fails with CONNECTION_LOST after 45 s of reconnecting from %s', async (_name, start) => {
    const { call, errors, room, states } = await liveCall();

    start(room);
    await advance(RECONNECTING_LIMIT_MS - 1);
    expect(view(call.getState())).toEqual(RECONNECTING);
    expect(errors).toEqual([]);

    await advance(1);
    await flush();
    expect(errors.map(error => error.code)).toEqual(['CONNECTION_LOST']);
    expect(inspectCall(call).phase).toBe('failed');
    expect(room.disconnect).toHaveBeenCalledOnce();
    expect(states.filter(state => state.end)).toEqual([
      expect.objectContaining({ end: expect.objectContaining({ status: 'failed' }) }),
    ]);
    expect(call.getState().end).toMatchObject({ error: { code: 'CONNECTION_LOST' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the call when LiveKit reconnects just before the 45 s limit', async () => {
    const { call, errors, room } = await liveCall();

    room.emit('reconnecting');
    await advance(RECONNECTING_LIMIT_MS - 1000);
    room.emit('reconnected');
    await advance(RECONNECTING_LIMIT_MS);
    expect(view(call.getState())).toEqual(CONNECTED);
    expect(errors).toEqual([]);
    expect(inspectCall(call).phase).toBe('active');
  });

  describe('cleanup', () => {
    it.each([
      ['stop()', async (call: { stop(): Promise<void> }) => call.stop()],
      [
        'an end from the room',
        async (_call: unknown, room: { serverDisconnect(reason?: number): void }) =>
          room.serverDisconnect(DisconnectReason.ROOM_DELETED),
      ],
      [
        'a lost connection',
        async (_call: unknown, room: { serverDisconnect(reason?: number): void }) =>
          room.serverDisconnect(DisconnectReason.SIGNAL_CLOSE),
      ],
    ])('leaves no timer or listener after %s', async (_name, end) => {
      const expectWindowListenersRemoved = spyWindowListeners();
      const { call, room, states } = await liveCall();

      room.emit('reconnecting');
      room.emit('reconnected');
      room.emit('reconnecting');
      room.emit('signalReconnecting');
      room.emit('connectionQualityChanged', 'poor', room.localParticipant);
      await end(call, room);
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      expect(room.listenerCount()).toBe(0);
      expectWindowListenersRemoved();

      const count = states.length;

      globalThis.dispatchEvent(new Event('offline'));
      await advance(RECONNECTING_LIMIT_MS);
      expect(states).toHaveLength(count);
    });
  });
});
