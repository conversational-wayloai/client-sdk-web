import { DisconnectReason } from 'livekit-client';
import { describe, expect, it } from 'vitest';

import {
  type CallPhase,
  decideAgentLeft,
  decideDisconnect,
  type DisconnectDecision,
  readSessionOutcome,
  SESSION_END_REASONS,
  type SessionOutcome,
} from '../src/session-outcome.js';

const FAILED: SessionOutcome = { state: 'error' };
const FINISHED: SessionOutcome = { state: 'finished' };

describe('decideDisconnect', () => {
  it.each([
    ['starting', false, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['starting', true, null, DisconnectReason.SIGNAL_CLOSE, 'abort_start'],
    ['starting', true, null, undefined, 'abort_start'],
    ['active', true, null, DisconnectReason.SIGNAL_CLOSE, 'fail'],
    ['active', true, null, DisconnectReason.ROOM_DELETED, 'end'],
    ['active', true, null, undefined, 'end'],
    ['active', true, FAILED, DisconnectReason.ROOM_DELETED, 'fail'],
    ['active', true, FINISHED, DisconnectReason.SIGNAL_CLOSE, 'end'],
    ['idle', false, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['stopping', true, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['stopped', true, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['ended', true, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['failed', true, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
  ] as const)(
    'returns %s / connected=%s / outcome=%o / reason=%s → %s',
    (phase, isConnected, outcome, reason, expected) => {
      const decision: DisconnectDecision = decideDisconnect({
        isConnected,
        outcome,
        phase: phase as CallPhase,
        reason,
      });

      expect(decision).toBe(expected);
    },
  );
});

describe('decideAgentLeft', () => {
  it.each([
    ['no verdict', null, 'fail'],
    ['a failed verdict', FAILED, 'fail'],
    ['a completed verdict', FINISHED, 'end'],
  ] as const)('returns %s → %s', (_label, outcome, expected) => {
    expect(decideAgentLeft(outcome)).toBe(expected);
  });
});

describe('readSessionOutcome', () => {
  it('reads the verdict and a known end reason', () => {
    expect(
      readSessionOutcome({ session_status: 'completed', session_end_reason: 'agent_end' }),
    ).toEqual({ endReason: 'agent_end', state: 'finished' });
  });

  it('drops an unknown end reason', () => {
    expect(readSessionOutcome({ session_status: 'failed', session_end_reason: 'made_up' })).toEqual(
      { state: 'error' },
    );
  });

  it('returns null without a verdict or with an unknown status', () => {
    expect(readSessionOutcome(undefined)).toBeNull();
    expect(readSessionOutcome({})).toBeNull();
    expect(readSessionOutcome({ session_status: 'paused' })).toBeNull();
  });
});

describe('SESSION_END_REASONS', () => {
  it('pins the list in application packages/api/src/common/session-lifecycle.ts', () => {
    expect(SESSION_END_REASONS).toEqual([
      'caller_hangup',
      'caller_inactive',
      'caller_goodbye',
      'agent_end',
      'busy',
      'no_answer',
      'rejected',
      'cancelled',
      'provider_error',
      'provider_key_failed',
      'worker_error',
      'max_duration',
      'timeout',
    ]);
  });
});
