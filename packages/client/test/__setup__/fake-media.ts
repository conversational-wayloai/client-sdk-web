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
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      if (!enabled) return participant.microphone;
      await enableMicrophone();
      const track = createLocalTrack();

      participant.microphoneTracks.push(track);
      participant.microphone = { track };

      return participant.microphone;
    }),
  };

  return participant;
}

export function createLocalTrack() {
  const mediaStreamTrack = { readyState: 'live' as MediaStreamTrackState };

  return {
    mediaStreamTrack,
    stop: vi.fn(() => {
      mediaStreamTrack.readyState = 'ended';
    }),
  };
}

export function createRemoteParticipant(identity: string, isAgent: boolean) {
  return {
    identity,
    isAgent,
    attributes: {} as Record<string, string>,
    trackPublications: new Map<string, { track: FakeAudioTrack }>(),
  };
}
