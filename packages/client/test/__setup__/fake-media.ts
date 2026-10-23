import { vi } from 'vitest';

export type FakeAudioTrack = ReturnType<typeof createAudioTrack>;
export type FakeLocalTrack = ReturnType<typeof createLocalTrack>;
export type FakeRemoteParticipant = ReturnType<typeof createRemoteParticipant>;

export function createAudioTrack() {
  const attachedElements: HTMLMediaElement[] = [];

  return {
    kind: 'audio' as const,
    attachedElements,
    attach: vi.fn(() => {
      const element = document.createElement('audio');

      attachedElements.push(element);

      return element;
    }),
    detach: vi.fn((element: HTMLMediaElement) => {
      attachedElements.splice(attachedElements.indexOf(element), 1);

      return element;
    }),
  };
}

export function createLocalParticipant(enableMicrophone: () => Promise<void>) {
  const participant = {
    microphone: undefined as { track: FakeLocalTrack } | undefined,
    microphoneTracks: [] as FakeLocalTrack[],
    getTrackPublication: (source: string) =>
      source === 'microphone' ? participant.microphone : undefined,
    createTracks: vi.fn(async (_options: { audio: boolean }) => {
      await enableMicrophone();
      const track = createLocalTrack();

      participant.microphoneTracks.push(track);

      return [track];
    }),
    publishTrack: vi.fn(async (track: FakeLocalTrack) => {
      participant.microphone = { track };

      return participant.microphone;
    }),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      const track = participant.microphone?.track;

      await (enabled ? track?.unmute() : track?.mute());

      return participant.microphone;
    }),
  };

  return participant;
}

export function createLocalTrack() {
  const mediaStreamTrack = { readyState: 'live' as MediaStreamTrackState };
  const listeners = new Map<string, Set<() => void>>();
  const track = {
    isMuted: false,
    mediaStreamTrack,
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    listenerCount() {
      let count = 0;

      for (const set of listeners.values()) count += set.size;

      return count;
    },
    mute: vi.fn(async () => {
      track.isMuted = true;
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    }),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
    }),
    stop: vi.fn(() => {
      mediaStreamTrack.readyState = 'ended';
    }),
    unmute: vi.fn(async () => {
      track.isMuted = false;
    }),
  };

  return track;
}

export function createRemoteParticipant(identity: string, isAgent: boolean) {
  return {
    identity,
    isAgent,
    attributes: {} as Record<string, string>,
    trackPublications: new Map<string, { track: FakeAudioTrack }>(),
  };
}
