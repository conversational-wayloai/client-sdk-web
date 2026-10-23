import { describe, expect, it } from 'vitest';

import { INITIAL_STATE, mergeState, toAgentState } from '../src/state.js';

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

describe('mergeState', () => {
  it('returns undefined when nothing changes', () => {
    expect(mergeState(INITIAL_STATE, { agent: 'none', connection: 'idle' })).toBeUndefined();
  });

  it('returns a new frozen snapshot when something changes', () => {
    const next = mergeState(INITIAL_STATE, { agent: 'joining' });

    expect(next).toEqual({ ...INITIAL_STATE, agent: 'joining' });
    expect(Object.isFrozen(next)).toBe(true);
    expect(INITIAL_STATE.agent).toBe('none');
  });
});
