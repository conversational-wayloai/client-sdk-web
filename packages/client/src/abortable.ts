export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);

    signal.addEventListener('abort', onAbort, { once: true });
    promise
      .finally(() => signal.removeEventListener('abort', onAbort))
      .then(resolve)
      .catch(reject);
  });
}
