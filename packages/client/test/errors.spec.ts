import { ConnectionError, ConnectionErrorReason } from 'livekit-client';
import { describe, expect, it } from 'vitest';

import { WAYLO_VOICE_ERROR_CODES, WayloVoiceError } from '../src/errors.js';

import { everyErrorSurface } from './__setup__/errors.js';
import { TEST_PARTICIPANT_TOKEN, TEST_TURN_SERVER } from './__setup__/fixtures.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYWxsZXIifQ.c2lnbmF0dXJl';
const SECRETS = [TEST_PARTICIPANT_TOKEN, TEST_TURN_SERVER.credential];

describe('WAYLO_VOICE_ERROR_CODES', () => {
  it('pins the public error codes', () => {
    expect(WAYLO_VOICE_ERROR_CODES).toEqual([
      'AGENT_LEFT',
      'AGENT_TIMEOUT',
      'ALREADY_STARTED',
      'CANCELLED',
      'CONNECTION_FAILED',
      'INVALID_SESSION',
      'MICROPHONE_DENIED',
      'MICROPHONE_UNAVAILABLE',
      'SESSION_EXPIRED',
    ]);
  });
});

describe('WayloVoiceError', () => {
  it('carries a code, a fixed message and a sanitized cause', () => {
    const error = new WayloVoiceError('CONNECTION_FAILED', new Error('low level'));

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WayloVoiceError');
    expect(error.code).toBe('CONNECTION_FAILED');
    expect(error.cause).toMatchObject({ message: 'low level', name: 'Error' });
    expect(error.message).not.toContain('low level');
  });

  it('has a message for every code', () => {
    for (const code of WAYLO_VOICE_ERROR_CODES) {
      expect(new WayloVoiceError(code).message).not.toBe('');
    }
  });

  it('has no cause when none is given', () => {
    expect('cause' in new WayloVoiceError('CANCELLED')).toBe(false);
  });

  it('keeps the name, code, reason and status of a LiveKit error, and drops its context', () => {
    const cause = ConnectionError.notAllowed('invalid token', 401, { token: JWT } as never);
    const error = new WayloVoiceError('SESSION_EXPIRED', cause);

    expect(error.cause).toMatchObject({
      code: cause.code,
      message: 'invalid token',
      name: 'ConnectionError',
      reason: ConnectionErrorReason.NotAllowed,
      status: 401,
    });
    expect(error.cause).not.toBe(cause);
    expect(error.cause).not.toHaveProperty('context');
    expect(everyErrorSurface(error)).not.toContain(JWT);
  });

  it('keeps a disconnect reason name', () => {
    const cause = Object.assign(new Error('Room disconnected.'), {
      disconnectReason: 'SIGNAL_CLOSE',
    });

    expect(new WayloVoiceError('CONNECTION_FAILED', cause).cause).toMatchObject({
      disconnectReason: 'SIGNAL_CLOSE',
    });
  });

  it('drops a status or disconnect reason of the wrong type', () => {
    const cause = Object.assign(new Error('x'), { disconnectReason: 7, status: '401' });
    const sanitized = new WayloVoiceError('CONNECTION_FAILED', cause).cause;

    expect(sanitized).not.toHaveProperty('status');
    expect(sanitized).not.toHaveProperty('disconnectReason');
  });

  it.each([
    ['the exact token value', `could not join with ${TEST_PARTICIPANT_TOKEN}`],
    ['the TURN credential', `turn auth failed: ${TEST_TURN_SERVER.credential}`],
    ['a JWT', `rejected ${JWT}`],
    ['an access_token query parameter', 'wss://lk.test/rtc?access_token=opaque&x=1'],
  ])('strips %s from the cause', (_label, message) => {
    const error = new WayloVoiceError('CONNECTION_FAILED', new Error(message), SECRETS);
    const text = everyErrorSurface(error);

    for (const secret of [...SECRETS, JWT, 'access_token=opaque']) {
      expect(text).not.toContain(secret);
    }

    expect(String(error.cause)).toContain('[redacted]');
  });

  it('redacts string codes, reasons and disconnect reasons too', () => {
    const cause = Object.assign(new Error('x'), {
      code: TEST_PARTICIPANT_TOKEN,
      disconnectReason: `d ${TEST_TURN_SERVER.credential}`,
      reason: `r ${JWT}`,
      status: 401,
    });
    const error = new WayloVoiceError('CONNECTION_FAILED', cause, SECRETS);

    expect(error.cause).toMatchObject({
      code: '[redacted]',
      disconnectReason: 'd [redacted]',
      reason: 'r [redacted]',
      status: 401,
    });
    for (const secret of [...SECRETS, JWT]) expect(everyErrorSurface(error)).not.toContain(secret);
  });

  it('turns a non-Error cause into a redacted Error', () => {
    expect(
      new WayloVoiceError('CONNECTION_FAILED', TEST_PARTICIPANT_TOKEN, SECRETS).cause,
    ).toMatchObject({ message: '[redacted]', name: 'Error' });
    expect(new WayloVoiceError('CONNECTION_FAILED', { detail: 'x' }).cause).toMatchObject({
      message: '',
      name: 'Error',
    });
  });
});
