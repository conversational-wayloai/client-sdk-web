import { describe, expect, it } from 'vitest';

import {
  CLOCK_SKEW_TOLERANCE_MS,
  isSessionExpired,
  requireSession,
  type TurnServer,
  type WebSessionBootstrap,
} from '../src/session.js';

import { errorCodeFrom } from './__setup__/errors.js';
import { TEST_TURN_SERVER, webSessionBootstrap } from './__setup__/fixtures.js';

// A field added to or removed from either interface fails the typecheck here.
const BOOTSTRAP_FIELDS: Record<keyof WebSessionBootstrap, true> = {
  expiresAt: true,
  livekitUrl: true,
  participantToken: true,
  roomName: true,
  sessionId: true,
  turn: true,
  workspaceId: true,
};
const TURN_FIELDS: Record<keyof TurnServer, true> = {
  credential: true,
  urls: true,
  username: true,
};

describe('WebSessionBootstrap', () => {
  it('pins the fields of WebSessionBootstrapResponse in application packages/api-client', () => {
    expect(Object.keys(BOOTSTRAP_FIELDS)).toEqual([
      'expiresAt',
      'livekitUrl',
      'participantToken',
      'roomName',
      'sessionId',
      'turn',
      'workspaceId',
    ]);
    expect(Object.keys(TURN_FIELDS)).toEqual(['credential', 'urls', 'username']);
  });
});

describe('requireSession', () => {
  it('accepts a full bootstrap response', () => {
    const value = webSessionBootstrap();

    expect(requireSession(value)).toBe(value);
  });

  it('accepts a session with a TURN server', () => {
    expect(requireSession(webSessionBootstrap({ turn: TEST_TURN_SERVER })).turn).toEqual(
      TEST_TURN_SERVER,
    );
  });

  it.each([
    ['null', null],
    ['a string', 'session'],
    ['no livekitUrl', webSessionBootstrap({ livekitUrl: undefined })],
    ['empty livekitUrl', webSessionBootstrap({ livekitUrl: '' })],
    ['no participantToken', webSessionBootstrap({ participantToken: undefined })],
    ['no expiresAt', webSessionBootstrap({ expiresAt: undefined })],
    ['unparseable expiresAt', webSessionBootstrap({ expiresAt: 'tomorrow-ish' })],
    [
      'a TURN server without urls',
      webSessionBootstrap({ turn: { credential: 'c', username: 'u' } }),
    ],
    [
      'a TURN server with empty urls',
      webSessionBootstrap({ turn: { credential: 'c', urls: [], username: 'u' } }),
    ],
  ])('rejects %s with INVALID_SESSION', async (_label, value) => {
    await expect(errorCodeFrom(() => requireSession(value))).resolves.toBe('INVALID_SESSION');
  });
});

describe('isSessionExpired', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');

  it('returns false for a future expiresAt', () => {
    expect(isSessionExpired(webSessionBootstrap({ expiresAt: '2026-10-20T12:05:00Z' }), now)).toBe(
      false,
    );
  });

  it('tolerates up to 60 s of clock drift', () => {
    const expiresAt = new Date(now - CLOCK_SKEW_TOLERANCE_MS).toISOString();

    expect(isSessionExpired(webSessionBootstrap({ expiresAt }), now)).toBe(false);
  });

  it('returns true more than 60 s past expiresAt', () => {
    const expiresAt = new Date(now - CLOCK_SKEW_TOLERANCE_MS - 1).toISOString();

    expect(isSessionExpired(webSessionBootstrap({ expiresAt }), now)).toBe(true);
  });
});
