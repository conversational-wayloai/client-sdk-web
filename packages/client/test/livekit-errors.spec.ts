import { ConnectionError, ConnectionErrorReason, DeviceUnsupportedError } from 'livekit-client';
import { describe, expect, it } from 'vitest';

import { WayloVoiceError } from '../src/errors.js';
import { toConnectError, toMicrophoneError, toWayloVoiceError } from '../src/livekit-errors.js';

function foreignConnectionError(reason: number): Error {
  return Object.assign(new Error('from another livekit-client copy'), {
    name: 'ConnectionError',
    reason,
  });
}

describe('toConnectError', () => {
  it('returns a WayloVoiceError unchanged', () => {
    const error = new WayloVoiceError('CANCELLED');

    expect(toConnectError(error, [])).toBe(error);
  });

  it('maps a NotAllowed ConnectionError from another livekit-client copy to SESSION_EXPIRED', () => {
    expect(toConnectError(foreignConnectionError(ConnectionErrorReason.NotAllowed), []).code).toBe(
      'SESSION_EXPIRED',
    );
  });

  it.each([
    ['another ConnectionError reason', foreignConnectionError(ConnectionErrorReason.InternalError)],
    [
      'an Error named ConnectionError without a reason',
      Object.assign(new Error('x'), { name: 'ConnectionError' }),
    ],
    ['a plain Error', new Error('x')],
  ])('maps %s to CONNECTION_FAILED', (_label, error) => {
    expect(toConnectError(error, []).code).toBe('CONNECTION_FAILED');
  });

  it('keeps the HTTP status of a ConnectionError', () => {
    expect(toConnectError(ConnectionError.serverUnreachable('down', 503), []).cause).toMatchObject({
      status: 503,
    });
  });
});

describe('toMicrophoneError', () => {
  it.each([
    ['NotAllowedError', 'MICROPHONE_DENIED'],
    ['NotFoundError', 'MICROPHONE_UNAVAILABLE'],
    ['NotReadableError', 'MICROPHONE_UNAVAILABLE'],
    ['OverconstrainedError', 'MICROPHONE_UNAVAILABLE'],
    ['AbortError', 'CONNECTION_FAILED'],
    ['SecurityError', 'CONNECTION_FAILED'],
  ])('maps a %s DOMException to %s', (name, code) => {
    expect(toMicrophoneError(new DOMException('mic', name), []).code).toBe(code);
  });

  it('maps an OverconstrainedError that is not a DOMException to MICROPHONE_UNAVAILABLE', () => {
    const error = Object.assign(new Error('constraint'), { name: 'OverconstrainedError' });

    expect(toMicrophoneError(error, []).code).toBe('MICROPHONE_UNAVAILABLE');
  });

  it('maps DeviceUnsupportedError to MICROPHONE_UNAVAILABLE', () => {
    expect(toMicrophoneError(new DeviceUnsupportedError('no getUserMedia'), []).code).toBe(
      'MICROPHONE_UNAVAILABLE',
    );
  });

  it('maps a non-error value to CONNECTION_FAILED', () => {
    expect(toMicrophoneError('nope', []).code).toBe('CONNECTION_FAILED');
  });
});

describe('toWayloVoiceError', () => {
  it('wraps anything else in CONNECTION_FAILED', () => {
    expect(toWayloVoiceError(new Error('x'), []).code).toBe('CONNECTION_FAILED');
  });
});
