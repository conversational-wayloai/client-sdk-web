type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<E extends keyof Events>(event: E, listener: Listener<Events[E]>): () => void {
    let set = this.#listeners.get(event);

    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }

    set.add(listener as Listener<never>);

    return () => this.off(event, listener);
  }

  off<E extends keyof Events>(event: E, listener: Listener<Events[E]>): void {
    this.#listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    const set = this.#listeners.get(event);

    if (!set) return;

    // eslint-disable-next-line unicorn/no-useless-spread -- snapshot: a listener may unsubscribe mid-emit
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[E]>)(payload);
      } catch (error) {
        reportListenerError(error);
      }
    }
  }
}

function reportListenerError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error);
  } else {
    setTimeout(() => {
      throw error;
    });
  }
}
