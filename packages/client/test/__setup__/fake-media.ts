import { type Mock, vi } from 'vitest';

export type FakeAudioTrack = ReturnType<typeof createAudioTrack>;
export type FakeLocalTrack = ReturnType<typeof createLocalTrack>;
export type FakeRemoteParticipant = ReturnType<typeof createRemoteParticipant>;

export interface FakeAnalyser {
  calculateVolume: () => number;
  cleanup: Mock<() => Promise<void>>;
  level: number;
  source: object;
}

export const analysers: FakeAnalyser[] = [];

export function createAnalyser(track: { mediaStreamTrack: object }): FakeAnalyser {
  const analyser: FakeAnalyser = {
    level: 0.5,
    source: track.mediaStreamTrack,
    calculateVolume: vi.fn(() => analyser.level),
    cleanup: vi.fn(() => Promise.resolve()),
  };

  analysers.push(analyser);

  return analyser;
}

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

export function createLocalParticipant(
  enableMicrophone: (deviceId: string) => Promise<boolean | void>,
  onPublished: (deviceId: string) => void = () => undefined,
) {
  const participant = {
    identity: 'user-session-1',
    microphone: undefined as { track: FakeLocalTrack } | undefined,
    microphoneTracks: [] as FakeLocalTrack[],
    getTrackPublication: (source: string) =>
      source === 'microphone' ? participant.microphone : undefined,
    createTracks: vi.fn(async (options: { audio: boolean | { deviceId: { exact: string } } }) => {
      const deviceId = typeof options.audio === 'object' ? options.audio.deviceId.exact : 'default';

      if ((await enableMicrophone(deviceId)) === false) return [];
      const track = createLocalTrack();

      track.deviceId = deviceId;

      participant.microphoneTracks.push(track);

      return [track];
    }),
    publishTrack: vi.fn(async (track: FakeLocalTrack) => {
      participant.microphone = { track };
      onPublished(track.deviceId);

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
  const mediaStreamTrack = { enabled: true, readyState: 'live' as MediaStreamTrackState };
  const listeners = new Map<string, Set<() => void>>();
  const track = {
    deviceId: 'default',
    pendingDeviceId: undefined as string | undefined,
    isMuted: false,
    mediaStreamTrack,
    getDeviceId: vi.fn(async () => track.deviceId),
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
      track.mediaStreamTrack.enabled = false;
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
      // Like LiveKit's unmute: reacquires the mic for a device chosen while muted or a stopped track.
      if (track.pendingDeviceId !== undefined || mediaStreamTrack.readyState === 'ended') {
        track.deviceId = track.pendingDeviceId ?? track.deviceId;
        track.pendingDeviceId = undefined;
        Object.assign(mediaStreamTrack, { enabled: true, readyState: 'live' });
        track.emit('restarted');
      }

      // Like LiveKit's setTrackMuted: enables the mic, then emits.
      track.isMuted = false;
      track.mediaStreamTrack.enabled = true;
      track.emit('unmuted');
    }),
  };

  return track;
}

export function createMediaStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];

  return { tracks, getTracks: () => tracks };
}

export function createRemoteParticipant(identity: string, isAgent: boolean) {
  return {
    identity,
    isAgent,
    attributes: {} as Record<string, string>,
    trackPublications: new Map<string, { track: FakeAudioTrack }>(),
  };
}

export function mediaDevice(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return { deviceId, groupId: 'group', kind, label, toJSON: () => ({}) };
}

export function stubMediaDevices(
  devices: MediaDeviceInfo[] | undefined,
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<unknown> = () =>
    Promise.resolve(createMediaStream()),
): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: devices && { enumerateDevices: () => Promise.resolve(devices), getUserMedia },
  });
}
