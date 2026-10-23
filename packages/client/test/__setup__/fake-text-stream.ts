import { deferred } from './fake-room.js';

type Step = { chunk: string } | { end: Record<string, string> } | { error: Error };

export interface FakeTextStream {
  end(trailer?: Record<string, string>): void;
  fail(error?: Error): void;
  info: { attributes: Record<string, string>; id: string };
  push(chunk: string): void;
}

export function createTextStream(id: string, attributes: Record<string, string>): FakeTextStream {
  const steps: Step[] = [];
  let wake = deferred();
  let signal: AbortSignal | undefined;

  const next = (step: Step) => {
    steps.push(step);
    wake.resolve();
  };

  const stream = {
    end: (trailer: Record<string, string> = {}) => next({ end: trailer }),
    fail: (error = new Error('stream closed abnormally')) => next({ error }),
    info: { attributes, id },
    push: (chunk: string) => next({ chunk }),
    withAbortSignal(abortSignal: AbortSignal) {
      signal = abortSignal;

      return this;
    },
    async *[Symbol.asyncIterator]() {
      const aborted = new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });

      aborted.catch(() => undefined);

      for (;;) {
        if (steps.length === 0) await Promise.race([wake.promise, aborted]);
        signal?.throwIfAborted();
        const step = steps.shift();

        if (!step) continue;
        wake = deferred();
        if ('error' in step) throw step.error;

        if ('end' in step) {
          Object.assign(stream.info.attributes, step.end);

          return;
        }

        yield step.chunk;
      }
    },
  };

  return stream;
}
