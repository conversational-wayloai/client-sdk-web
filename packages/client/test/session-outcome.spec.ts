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
    ['starting', false, false, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['starting', true, false, null, DisconnectReason.SIGNAL_CLOSE, 'abort_start'],
    ['starting', true, true, null, undefined, 'abort_start'],
    ['active', true, false, null, DisconnectReason.SERVER_SHUTDOWN, 'fail'],
    ['active', true, false, null, DisconnectReason.SIGNAL_CLOSE, 'lose'],
    ['active', true, false, null, DisconnectReason.ROOM_DELETED, 'end'],
    ['active', true, false, null, undefined, 'end'],
    ['active', true, true, null, undefined, 'lose'],
    ['active', true, true, null, DisconnectReason.ROOM_DELETED, 'lose'],
    ['active', true, true, FAILED, undefined, 'fail'],
    ['active', true, true, FINISHED, undefined, 'end'],
    ['active', true, false, FAILED, DisconnectReason.ROOM_DELETED, 'fail'],
    ['active', true, false, FINISHED, DisconnectReason.SIGNAL_CLOSE, 'end'],
    ['idle', false, false, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['stopping', true, true, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['stopped', true, false, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['ended', true, false, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
    ['failed', true, true, null, DisconnectReason.SIGNAL_CLOSE, 'ignore'],
  ] as const)(
    'returns %s / connected=%s / reconnecting=%s / outcome=%o / reason=%s → %s',
    (phase, isConnected, isReconnecting, outcome, reason, expected) => {
      const decision: DisconnectDecision = decideDisconnect({
        isConnected,
        isReconnecting,
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
      'caller_not_joined',
      'connection_lost',
      'agent_end',
      'disclosure_failed',
      'caller_objected',
      'busy',
      'no_answer',
      'rejected',
      'cancelled',
      'provider_error',
      'provider_key_failed',
      'brain_error',
      'worker_error',
      'max_duration',
      'timeout',
      'client_end',
    ]);
  });
});
