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
    const error = new WayloVoiceError('cancelled');

    expect(toConnectError(error, [])).toBe(error);
  });

  it('maps a NotAllowed ConnectionError from another livekit-client copy to session_expired', () => {
    expect(toConnectError(foreignConnectionError(ConnectionErrorReason.NotAllowed), []).code).toBe(
      'session_expired',
    );
  });

  it.each([
    ['another ConnectionError reason', foreignConnectionError(ConnectionErrorReason.InternalError)],
    [
      'an Error named ConnectionError without a reason',
      Object.assign(new Error('x'), { name: 'ConnectionError' }),
    ],
    ['a plain Error', new Error('x')],
  ])('maps %s to connection_failed', (_label, error) => {
    expect(toConnectError(error, []).code).toBe('connection_failed');
  });

  it('keeps the HTTP status of a ConnectionError', () => {
    expect(toConnectError(ConnectionError.serverUnreachable('down', 503), []).cause).toMatchObject({
      status: 503,
    });
  });
});

describe('toMicrophoneError', () => {
  it.each([
    ['NotAllowedError', 'microphone_denied'],
    ['NotFoundError', 'microphone_unavailable'],
    ['NotReadableError', 'microphone_unavailable'],
    ['OverconstrainedError', 'microphone_unavailable'],
    ['AbortError', 'connection_failed'],
    ['SecurityError', 'connection_failed'],
  ])('maps a %s DOMException to %s', (name, code) => {
    expect(toMicrophoneError(new DOMException('mic', name), []).code).toBe(code);
  });

  it('maps an OverconstrainedError that is not a DOMException to microphone_unavailable', () => {
    const error = Object.assign(new Error('constraint'), { name: 'OverconstrainedError' });

    expect(toMicrophoneError(error, []).code).toBe('microphone_unavailable');
  });

  it('maps DeviceUnsupportedError to microphone_unavailable', () => {
    expect(toMicrophoneError(new DeviceUnsupportedError('no getUserMedia'), []).code).toBe(
      'microphone_unavailable',
    );
  });

  it('maps a non-error value to connection_failed', () => {
    expect(toMicrophoneError('nope', []).code).toBe('connection_failed');
  });
});

describe('toWayloVoiceError', () => {
  it('wraps anything else in connection_failed', () => {
    expect(toWayloVoiceError(new Error('x'), []).code).toBe('connection_failed');
  });
});
