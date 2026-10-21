import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Emitter } from '../src/emitter.js';

function throwingEmitter() {
  const emitter = new Emitter<{ state: string }>();
  const good = vi.fn();

  emitter.on('state', () => {
    throw new Error('bad listener');
  });
  emitter.on('state', good);

  return { emitter, good };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Emitter', () => {
  it('delivers and unsubscribes', () => {
    const emitter = new Emitter<{ state: string }>();
    const listener = vi.fn();
    const off = emitter.on('state', listener);

    emitter.emit('state', 'a');
    off();
    emitter.emit('state', 'b');
    expect(listener.mock.calls).toEqual([['a']]);
  });

  it('ignores an event nobody listens to', () => {
    expect(() => new Emitter<{ state: string }>().emit('state', 'a')).not.toThrow();
  });

  it('delivers to every listener present when emit started', () => {
    const emitter = new Emitter<{ state: string }>();
    const second = vi.fn();
    const offSecond = emitter.on('state', second);

    emitter.on('state', () => offSecond());
    emitter.emit('state', 'a');
    expect(second).toHaveBeenCalledWith('a');
  });

  it('keeps delivering when a listener throws, reporting through reportError', () => {
    const reportError = vi.fn();

    vi.stubGlobal('reportError', reportError);
    const { emitter, good } = throwingEmitter();

    emitter.emit('state', 'a');
    expect(good).toHaveBeenCalledWith('a');
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('rethrows on a later tick when reportError is missing', () => {
    vi.useFakeTimers();
    vi.stubGlobal('reportError', undefined);
    const { emitter, good } = throwingEmitter();

    emitter.emit('state', 'a');
    expect(good).toHaveBeenCalledWith('a');
    expect(() => vi.runAllTimers()).toThrow('bad listener');
  });
});
