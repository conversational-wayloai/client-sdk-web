import { describe, expect, it } from 'vitest';

import { readConnectionStats } from '../src/connection-monitor.js';

function report(...stats: Record<string, unknown>[]): RTCStatsReport {
  return new Map(stats.map(stat => [stat.id, stat])) as unknown as RTCStatsReport;
}

describe('readConnectionStats', () => {
  it('reads the selected candidate pair named by the transport', () => {
    const stats = report(
      { id: 'T1', type: 'transport', iceState: 'disconnected', selectedCandidatePairId: 'CP2' },
      { id: 'CP1', type: 'candidate-pair', bytesReceived: 1, timestamp: 10 },
      { id: 'CP2', type: 'candidate-pair', bytesReceived: 500, timestamp: 20 },
    );

    expect(readConnectionStats(stats, 'publisher')).toEqual({
      bytesReceived: 500,
      iceState: 'disconnected',
      id: 'publisher:T1',
      timestamp: 20,
    });
  });

  it.each([
    ['selected', { selected: true }],
    ['nominated and succeeded', { nominated: true, state: 'succeeded' }],
  ])('falls back to the %s pair without transport stats', (_name, flags) => {
    const stats = report(
      { id: 'CP1', type: 'candidate-pair', bytesReceived: 1, timestamp: 10 },
      { id: 'CP2', type: 'candidate-pair', bytesReceived: 300, timestamp: 20, ...flags },
    );

    expect(readConnectionStats(stats, 'subscriber')).toEqual({
      bytesReceived: 300,
      iceState: undefined,
      id: 'subscriber:CP2',
      timestamp: 20,
    });
  });

  it('falls back to the transport bytes without a selected pair', () => {
    const stats = report({ id: 'T1', type: 'transport', bytesReceived: 42, timestamp: 5 });

    expect(readConnectionStats(stats, 'publisher')).toMatchObject({
      bytesReceived: 42,
      id: 'publisher:T1',
    });
  });

  it('returns null without received bytes', () => {
    expect(readConnectionStats(report({ id: 'X', type: 'outbound-rtp' }), 'publisher')).toBeNull();
  });
});
