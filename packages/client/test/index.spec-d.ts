import { describe, expectTypeOf, it } from 'vitest';

import type * as PublicApi from '../src/index.js';
import {
  WayloVoiceError,
  type WayloVoiceErrorCode,
  type WebSessionBootstrap,
} from '../src/index.js';

describe('public API', () => {
  it('exports only the public surface', () => {
    expectTypeOf<keyof typeof PublicApi>().toEqualTypeOf<'WayloVoiceError'>();
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('WAYLO_VOICE_ERROR_CODES');
  });

  it('WayloVoiceError is an Error with a readonly code', () => {
    expectTypeOf<WayloVoiceError>().toExtend<Error>();
    expectTypeOf<WayloVoiceError['code']>().toEqualTypeOf<WayloVoiceErrorCode>();
    expectTypeOf<WayloVoiceError['name']>().toEqualTypeOf<'WayloVoiceError'>();
    expectTypeOf<Readonly<Pick<WayloVoiceError, 'code'>>>().toEqualTypeOf<
      Pick<WayloVoiceError, 'code'>
    >();
  });

  it('WayloVoiceErrorCode is the closed set of codes', () => {
    expectTypeOf<WayloVoiceErrorCode>().toEqualTypeOf<
      | 'agent_left'
      | 'agent_timeout'
      | 'already_started'
      | 'cancelled'
      | 'connection_failed'
      | 'invalid_session'
      | 'microphone_denied'
      | 'microphone_unavailable'
      | 'session_expired'
    >();
  });

  it('WebSessionBootstrap matches the POST /sessions/web response', () => {
    expectTypeOf<WebSessionBootstrap>().toEqualTypeOf<{
      expiresAt: string;
      livekitUrl: string;
      participantToken: string;
      roomName: string;
      sessionId: string;
      turn?: { credential: string; urls: string[]; username: string };
      workspaceId: string;
    }>();
  });
});
