import { ConnectionQuality } from 'livekit-client';

import type { WayloVoiceError } from './errors.js';
import type { SessionEndReason } from './session-outcome.js';

/** What the agent is doing, from LiveKit's `lk.agent.state`. */
export type WayloVoiceAgentState = 'joining' | 'listening' | 'none' | 'speaking' | 'thinking';

/** Whether this browser is in the call's room. */
export type WayloVoiceConnection =
  'connected' | 'connecting' | 'disconnected' | 'idle' | 'reconnecting';

/** How the call ended, as this browser saw it. The stored session is the record. */
export type WayloVoiceEnd =
  | {
      /** Why the session ended, when the agent reported it. */
      readonly reason?: WayloVoiceEndReason;
      readonly status: 'completed';
    }
  | {
      readonly error: WayloVoiceError;
      /** Why the session ended, when the agent reported it. */
      readonly reason?: WayloVoiceEndReason;
      readonly status: 'failed';
    };

/** Same values as the session's end reason in the Waylo API. */
export type WayloVoiceEndReason = SessionEndReason;

/** Whether the microphone is live, muted or off. */
export type WayloVoiceMicrophone = 'muted' | 'off' | 'on';

/**
 * `network` is how well this browser's connection to the call is doing: `good`, `poor` or `lost`.
 * When it's `poor` or `lost`, show a non-blocking banner such as "Your connection is weak"; the call
 * goes on, and `connection` says if it's reconnecting.
 */
export type WayloVoiceNetwork = 'good' | 'lost' | 'poor';

/** `playing` means the browser may play the agent's audio, not that it is audible. */
export type WayloVoicePlayback = 'blocked' | 'playing' | 'stopped';

/** Which moment of the call this is, for a status line. */
export type WayloVoiceStage =
  | 'connecting'
  | 'ended'
  | 'idle'
  | 'joining'
  | 'listening'
  | 'preparing'
  | 'reconnecting'
  | 'speaking'
  | 'thinking';

/** A microphone or speaker. `label` is empty until the visitor allows the microphone. */
export interface WayloVoiceDevice {
  /** Pass it to `setMicrophoneDevice()` or `setSpeakerDevice()`. */
  readonly deviceId: string;
  /** The name to show, such as "MacBook Pro Microphone". */
  readonly label: string;
}

export interface WayloVoiceDevices {
  /** False where the browser can't route audio to a chosen speaker (Safari, every iOS browser); `speakers` is then empty. */
  readonly canChooseSpeaker: boolean;
  /** Audio inputs, in the browser's order. */
  readonly microphones: readonly WayloVoiceDevice[];
  /** Audio outputs, in the browser's order. */
  readonly speakers: readonly WayloVoiceDevice[];
}

/** Events passed to `on()`. */
export interface WayloVoiceEvents {
  /** A problem with no promise left to reject. */
  error: WayloVoiceError;
  /** The whole snapshot, on every change. */
  state: WayloVoiceState;
  /** A transcript line, sent again as it grows. */
  transcript: WayloVoiceTranscript;
}

export interface WayloVoiceListDevicesOptions {
  /** Ask for the microphone first so devices have names. Default false. */
  readonly requestPermission?: boolean;
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
  /** The microphone chosen, or the one in use once the call has it; unset or `'default'` means the system default. */
  readonly microphoneDeviceId?: string;
  /** How well this browser's connection is doing; `'good'` outside a call. */
  readonly network: WayloVoiceNetwork;
  /** Whether the browser may play the agent's audio. */
  readonly playback: WayloVoicePlayback;
  /** The Waylo session id, once known. */
  readonly sessionId?: string;
  /** The speaker chosen, or the one in use once the call has it; unset or `'default'` means the system default. */
  readonly speakerDeviceId?: string;
  /** Which moment of the call this is, from `connection` and `agent`, for a status line. */
  readonly stage: WayloVoiceStage;
  /** How long each step of the call took, once `start()` was called. */
  readonly timings?: WayloVoiceTimings;
  /** Agent volume, 0 to 1. */
  readonly volume: number;
}

/** Whole milliseconds after `start()` at which each step was reached, in any order. A step not reached is unset. */
export interface WayloVoiceTimings {
  /** The agent reported its first activity state, maybe before the microphone is ready. */
  readonly agentReadyMs?: number;
  /** The agent starts speaking while the browser may play its audio; the audio arrives a little later. */
  readonly agentSpeakingMs?: number;
  /** This browser joined the call. */
  readonly connectedMs?: number;
  /** The browser opened the microphone, permission prompt included; often before the call connects. */
  readonly microphoneOpenMs?: number;
  /** The microphone is live in the call, so the agent can hear the visitor. */
  readonly microphoneReadyMs?: number;
  /** The session endpoint answered. */
  readonly sessionReadyMs?: number;
  /** When `start()` was called, as `Date.now()`. */
  readonly startedAt: number;
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
  network: 'good',
  playback: 'stopped',
  stage: 'idle',
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

export function toNetwork(quality: ConnectionQuality): WayloVoiceNetwork | undefined {
  switch (quality) {
    case ConnectionQuality.Excellent:
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
      return 'poor';
    case ConnectionQuality.Lost:
      return 'lost';
    default:
      return undefined;
  }
}

const NETWORK_RANK: Readonly<Record<WayloVoiceNetwork, number>> = { good: 0, lost: 2, poor: 1 };

export function toStage(
  state: WayloVoiceState,
  previous: WayloVoiceStage,
  hasAgentSpoken: boolean,
): WayloVoiceStage {
  switch (state.connection) {
    case 'connecting':
      return state.timings?.connectedMs === undefined ? 'connecting' : 'joining';
    case 'disconnected':
      return 'ended';
    case 'idle':
      return 'idle';
    case 'reconnecting':
      return 'reconnecting';
    default:
      if (state.agent === 'none') return previous;
      if (state.agent === 'joining') return 'joining';

      return hasAgentSpoken ? state.agent : 'preparing';
  }
}

export function worseNetwork(a: WayloVoiceNetwork, b: WayloVoiceNetwork): WayloVoiceNetwork {
  return NETWORK_RANK[b] > NETWORK_RANK[a] ? b : a;
}
