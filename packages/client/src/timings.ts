import type { WayloVoiceState, WayloVoiceTimings } from './state.js';

export type TimingStep = Exclude<keyof WayloVoiceTimings, 'startedAt'>;

export class CallTimer {
  #startedAt = 0;

  start(): WayloVoiceTimings {
    this.#startedAt = performance.now();

    return Object.freeze({ startedAt: Date.now() });
  }

  mark(timings: WayloVoiceTimings, step: TimingStep): WayloVoiceTimings {
    if (timings[step] !== undefined) return timings;

    return Object.freeze({ ...timings, [step]: Math.round(performance.now() - this.#startedAt) });
  }
}

export function agentStepsReached({ agent, playback }: WayloVoiceState): TimingStep[] {
  if (agent === 'none' || agent === 'joining') return [];

  return agent === 'speaking' && playback === 'playing'
    ? ['agentReadyMs', 'agentSpeakingMs']
    : ['agentReadyMs'];
}
