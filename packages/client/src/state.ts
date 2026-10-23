import type { WayloVoiceError } from './errors.js';
import type { SessionEndReason } from './session-outcome.js';

/** What the agent is doing, from LiveKit's `lk.agent.state`. */
export type WayloVoiceAgentState = 'joining' | 'listening' | 'none' | 'speaking' | 'thinking';

/** Whether this browser is in the call's room. */
export type WayloVoiceConnection =
  'connected' | 'connecting' | 'disconnected' | 'idle' | 'reconnecting';

/** How the call ended, as this browser saw it. The stored session is the record. */
export type WayloVoiceEnd =
  | { readonly reason?: WayloVoiceEndReason; readonly status: 'completed' }
  | {
      readonly error: WayloVoiceError;
      readonly reason?: WayloVoiceEndReason;
      readonly status: 'failed';
    };

/** Same values as the session's end reason in the Waylo API. */
export type WayloVoiceEndReason = SessionEndReason;

/** Whether the microphone is live, muted or off. */
export type WayloVoiceMicrophone = 'muted' | 'off' | 'on';

/** `playing` means the browser may play the agent's audio, not that it is audible. */
export type WayloVoicePlayback = 'blocked' | 'playing' | 'stopped';

/** Events passed to `on()`. */
export interface WayloVoiceEvents {
  /** A problem with no promise left to reject. */
  error: WayloVoiceError;
  /** The whole snapshot, on every change. */
  state: WayloVoiceState;
  /** A transcript line, sent again as it grows. */
  transcript: WayloVoiceTranscript;
}

/** A snapshot of the call. */
export interface WayloVoiceState {
  /** What the agent is doing. */
  readonly agent: WayloVoiceAgentState;
  /** Whether this browser is in the call's room. */
  readonly connection: WayloVoiceConnection;
  /** Set once, together with `connection: 'disconnected'`. Nothing is emitted after it. */
  readonly end?: WayloVoiceEnd;
  /** Whether the microphone is live, muted or off. */
  readonly microphone: WayloVoiceMicrophone;
  /** Whether the browser may play the agent's audio. */
  readonly playback: WayloVoicePlayback;
  /** The Waylo session id, once known. */
  readonly sessionId?: string;
  /** Agent volume, 0 to 1. */
  readonly volume: number;
}

/** One spoken line, sent again as it grows. */
export interface WayloVoiceTranscript {
  /** True once the line stops changing. */
  readonly final: boolean;
  /** Stable for one spoken line; replace the row with the same id. */
  readonly id: string;
  /** Who said the line. */
  readonly speaker: 'agent' | 'user';
  /** The whole line so far. */
  readonly text: string;
}

export const INITIAL_STATE: WayloVoiceState = Object.freeze({
  agent: 'none',
  connection: 'idle',
  microphone: 'off',
  playback: 'stopped',
  volume: 1,
});

export function mergeState(
  current: WayloVoiceState,
  changes: Partial<WayloVoiceState>,
): WayloVoiceState | undefined {
  const keys = Object.keys(changes) as (keyof WayloVoiceState)[];
  const isSame = keys.every(key => changes[key] === current[key]);

  return isSame ? undefined : Object.freeze({ ...current, ...changes });
}

export function toAgentState(
  attributes: Readonly<Record<string, string>> | undefined,
): WayloVoiceAgentState {
  switch (attributes?.['lk.agent.state']) {
    case 'idle':
    case 'listening':
      return 'listening';
    case 'speaking':
      return 'speaking';
    case 'thinking':
      return 'thinking';
    default:
      return 'joining';
  }
}
