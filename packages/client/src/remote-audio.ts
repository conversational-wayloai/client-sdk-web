import { type RemoteTrack, Track } from 'livekit-client';

export class RemoteAudio {
  #container: HTMLElement | undefined;
  readonly #elements = new Map<RemoteTrack, HTMLMediaElement>();
  #volume = 1;
  #sinkId: string | undefined;

  attach(track: RemoteTrack): void {
    if (track.kind !== Track.Kind.Audio || this.#elements.has(track)) return;
    const element = track.attach();

    // Set on the element: LiveKit skips re-applying 0 on attach, and startAudio() unmutes every element.
    applyVolume(element, this.#volume);
    element.addEventListener('volumechange', () => applyVolume(element, this.#volume));
    if (this.#sinkId !== undefined) applySinkId(element, this.#sinkId);
    this.#ensureContainer().append(element);
    this.#elements.set(track, element);
  }

  detach(track: RemoteTrack): void {
    const element = this.#elements.get(track);

    if (!element) return;
    track.detach(element);
    element.remove();
    this.#elements.delete(track);
  }

  hasTracks(): boolean {
    return this.#elements.size > 0;
  }

  setVolume(volume: number): void {
    this.#volume = volume;
    for (const element of this.#elements.values()) applyVolume(element, volume);
  }

  // Undefined leaves the speaker to LiveKit.
  setSinkId(sinkId: string | undefined): void {
    this.#sinkId = sinkId;
    if (sinkId === undefined) return;
    for (const element of this.#elements.values()) applySinkId(element, sinkId);
  }

  clear(): void {
    // eslint-disable-next-line unicorn/no-useless-spread -- snapshot: detach() deletes from the map
    for (const track of [...this.#elements.keys()]) this.detach(track);
    this.#container?.remove();
    this.#container = undefined;
  }

  #ensureContainer(): HTMLElement {
    if (!this.#container) {
      this.#container = document.createElement('div');
      this.#container.hidden = true;
      this.#container.dataset.wayloVoiceAudio = '';
      document.body.append(this.#container);
    }

    return this.#container;
  }
}

function applySinkId(element: HTMLMediaElement, sinkId: string): void {
  if ('setSinkId' in element && element.sinkId !== sinkId) {
    element.setSinkId(sinkId).catch(() => undefined);
  }
}

function applyVolume(element: HTMLMediaElement, volume: number): void {
  // iOS Safari ignores volume; muted still silences it.
  const muted = volume === 0;

  if (element.volume !== volume) element.volume = volume;
  if (element.muted !== muted) element.muted = muted;
}
