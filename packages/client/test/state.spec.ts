import { ConnectionQuality } from 'livekit-client';
import { describe, expect, it } from 'vitest';

import type { WayloVoiceState } from '../src/index.js';
import { INITIAL_STATE, mergeState, toAgentState, toNetwork, toStage } from '../src/state.js';

describe('toAgentState', () => {
  it.each([
    ['listening', 'listening'],
    ['idle', 'listening'],
    ['thinking', 'thinking'],
    ['speaking', 'speaking'],
    ['initializing', 'joining'],
    [undefined, 'joining'],
    ['something-new', 'joining'],
  ])('maps lk.agent.state %s to %s', (value, expected) => {
    const attributes = value === undefined ? {} : { 'lk.agent.state': value };

    expect(toAgentState(attributes)).toBe(expected);
  });
});

describe('toNetwork', () => {
  it.each([
    [ConnectionQuality.Excellent, 'good'],
    [ConnectionQuality.Good, 'good'],
    [ConnectionQuality.Poor, 'poor'],
    [ConnectionQuality.Lost, 'lost'],
    [ConnectionQuality.Unknown, undefined],
  ])('maps LiveKit quality %s to %s', (quality, expected) => {
    expect(toNetwork(quality)).toBe(expected);
  });
});

describe('toStage', () => {
  const joined = { connectedMs: 10, startedAt: 0 };

  it.each([
    [{ connection: 'idle' }, false, 'idle'],
    [{ connection: 'connecting' }, false, 'connecting'],
    [{ connection: 'connecting', timings: { startedAt: 0 } }, false, 'connecting'],
    [{ agent: 'none', connection: 'connecting', timings: joined }, false, 'joining'],
    [{ agent: 'listening', connection: 'connecting', timings: joined }, false, 'joining'],
    [{ agent: 'joining', connection: 'connected' }, true, 'joining'],
    [{ agent: 'listening', connection: 'connected' }, false, 'preparing'],
    [{ agent: 'thinking', connection: 'connected' }, false, 'preparing'],
    [{ agent: 'speaking', connection: 'connected' }, true, 'speaking'],
    [{ agent: 'listening', connection: 'connected' }, true, 'listening'],
    [{ agent: 'thinking', connection: 'connected' }, true, 'thinking'],
    [{ agent: 'speaking', connection: 'reconnecting' }, true, 'reconnecting'],
    [{ agent: 'none', connection: 'disconnected' }, true, 'ended'],
  ] as const)('maps %o (agent has spoken: %s) to %s', (changes, hasAgentSpoken, expected) => {
    const state: WayloVoiceState = { ...INITIAL_STATE, ...changes };

    expect(toStage(state, 'speaking', hasAgentSpoken)).toBe(expected);
  });

  it('keeps the previous stage while connected without an agent', () => {
    const state: WayloVoiceState = { ...INITIAL_STATE, agent: 'none', connection: 'connected' };

    expect(toStage(state, 'reconnecting', true)).toBe('reconnecting');
    expect(toStage(state, 'listening', true)).toBe('listening');
  });
});

describe('mergeState', () => {
  it('returns undefined when nothing changes', () => {
    expect(mergeState(INITIAL_STATE, { agent: 'none', volume: 1 })).toBeUndefined();
  });

  it('returns a new frozen snapshot when something changes', () => {
    const next = mergeState(INITIAL_STATE, { agent: 'joining' });

    expect(next).toEqual({ ...INITIAL_STATE, agent: 'joining' });
    expect(Object.isFrozen(next)).toBe(true);
    expect(INITIAL_STATE.agent).toBe('none');
  });
});
