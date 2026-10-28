import {
  ConnectionError,
  ConnectionErrorReason,
  DeviceUnsupportedError,
  MediaDeviceFailure,
} from 'livekit-client';
import { describe, expect, it } from 'vitest';

import { WayloVoiceError } from '../src/errors.js';
import {
  isMissingDevice,
  toConnectError,
  toMicrophoneError,
  toWayloVoiceError,
} from '../src/livekit-errors.js';

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
    ['PermissionDeniedError', 'MICROPHONE_DENIED'],
    ['NotReadableError', 'MICROPHONE_IN_USE'],
    ['TrackStartError', 'MICROPHONE_IN_USE'],
    ['NotFoundError', 'MICROPHONE_UNAVAILABLE'],
    ['OverconstrainedError', 'MICROPHONE_UNAVAILABLE'],
    ['AbortError', 'MICROPHONE_UNAVAILABLE'],
    ['SecurityError', 'MICROPHONE_UNAVAILABLE'],
    ['TypeError', 'MICROPHONE_UNAVAILABLE'],
  ])('maps a %s DOMException to %s', (name, code) => {
    expect(toMicrophoneError(new DOMException('mic', name), []).code).toBe(code);
  });

  it('keeps the original error as the cause', () => {
    const error = toMicrophoneError(
      new DOMException('Could not start audio source', 'NotReadableError'),
      [],
    );

    expect(MediaDeviceFailure.getFailure(error.cause)).toBe(MediaDeviceFailure.DeviceInUse);
    expect(error.cause).toMatchObject({
      message: 'Could not start audio source',
      name: 'NotReadableError',
    });
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

  it.each(['nope', undefined, {}])(
    'maps %j, which has no name, to MICROPHONE_UNAVAILABLE',
    value => {
      expect(toMicrophoneError(value, []).code).toBe('MICROPHONE_UNAVAILABLE');
    },
  );
});

describe('toWayloVoiceError', () => {
  it('wraps anything else in CONNECTION_FAILED', () => {
    expect(toWayloVoiceError(new Error('x'), []).code).toBe('CONNECTION_FAILED');
  });
});

describe('isMissingDevice()', () => {
  it.each(['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError'])(
    'is true for %s',
    name => {
      expect(isMissingDevice(new DOMException('gone', name))).toBe(true);
    },
  );

  it.each(['NotAllowedError', 'NotReadableError'])('is false for %s', name => {
    expect(isMissingDevice(new DOMException('no', name))).toBe(false);
  });

  it('is false for a value without a name', () => {
    expect(isMissingDevice('gone')).toBe(false);
  });
});
