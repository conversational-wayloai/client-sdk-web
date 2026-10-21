import { type RemoteTrack, Track } from 'livekit-client';

export class RemoteAudio {
  #container: HTMLElement | undefined;
  readonly #elements = new Map<RemoteTrack, HTMLMediaElement>();

  attach(track: RemoteTrack): void {
    if (track.kind !== Track.Kind.Audio || this.#elements.has(track)) return;
    const element = track.attach();

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
