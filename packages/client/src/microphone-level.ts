import { createAudioAnalyser, type LocalAudioTrack } from 'livekit-client';

type Analyser = ReturnType<typeof createAudioAnalyser>;

export class MicrophoneLevel {
  #analyser: Analyser | undefined;
  #source: MediaStreamTrack | undefined;

  read(track: LocalAudioTrack): number {
    if (track.mediaStreamTrack !== this.#source) {
      this.clear();
      this.#source = track.mediaStreamTrack;
      this.#analyser = createAnalyser(track);
    }

    return this.#analyser?.calculateVolume() ?? 0;
  }

  clear(): void {
    this.#analyser?.cleanup().catch(() => undefined);
    this.#analyser = undefined;
    this.#source = undefined;
  }
}

function createAnalyser(track: LocalAudioTrack): Analyser | undefined {
  try {
    return createAudioAnalyser(track);
  } catch {
    return undefined;
  }
}
