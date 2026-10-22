import { DisconnectReason } from 'livekit-client';

export type CallState =
  'active' | 'ended' | 'failed' | 'idle' | 'starting' | 'stopped' | 'stopping';

export type DisconnectDecision = 'abort_start' | 'end' | 'fail' | 'ignore';

export interface DisconnectInput {
  isConnected: boolean;
  outcome: SessionOutcome | null;
  reason: DisconnectReason | undefined;
  state: CallState;
}

// Mirrors SESSION_END_REASONS in application packages/api/src/common/session-lifecycle.ts.
export const SESSION_END_REASONS = [
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
] as const;

export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export interface SessionOutcome {
  endReason?: SessionEndReason;
  state: 'error' | 'finished';
}

// Without a worker verdict, only these reasons mean the call broke.
export const ERROR_DISCONNECT_REASONS: ReadonlySet<DisconnectReason> = new Set([
  DisconnectReason.AGENT_ERROR,
  DisconnectReason.CONNECTION_TIMEOUT,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.JOIN_FAILURE,
  DisconnectReason.MEDIA_FAILURE,
  DisconnectReason.SERVER_SHUTDOWN,
  DisconnectReason.SIGNAL_CLOSE,
  DisconnectReason.STATE_MISMATCH,
]);

export function decideAgentLeft(outcome: SessionOutcome | null): 'end' | 'fail' {
  return outcome?.state === 'finished' ? 'end' : 'fail';
}

export function decideDisconnect({
  isConnected,
  outcome,
  reason,
  state,
}: DisconnectInput): DisconnectDecision {
  // Before connect resolves, the pending connect() rejects with the real cause (a 401 must stay
  // SESSION_EXPIRED), so the event adds nothing.
  if (state === 'starting') return isConnected ? 'abort_start' : 'ignore';
  if (state !== 'active') return 'ignore';
  if (outcome) return outcome.state === 'error' ? 'fail' : 'end';

  return reason !== undefined && ERROR_DISCONNECT_REASONS.has(reason) ? 'fail' : 'end';
}

// Unknown values from a newer worker are dropped, not thrown.
export function readSessionOutcome(
  attributes: Readonly<Record<string, string>> | undefined,
): SessionOutcome | null {
  const status = attributes?.session_status;

  if (status !== 'completed' && status !== 'failed') return null;

  const endReason = SESSION_END_REASONS.find(reason => reason === attributes?.session_end_reason);
  const state = status === 'failed' ? 'error' : 'finished';

  return endReason ? { endReason, state } : { state };
}
