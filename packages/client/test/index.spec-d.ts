import { describe, expectTypeOf, it } from 'vitest';

import type * as PublicApi from '../src/index.js';
import {
  WayloVoice,
  WayloVoiceError,
  type WayloVoiceErrorCode,
  type WayloVoiceOptions,
  type WebSessionBootstrap,
} from '../src/index.js';

describe('public API', () => {
  it('exports only the public surface', () => {
    expectTypeOf<keyof typeof PublicApi>().toEqualTypeOf<'WayloVoice' | 'WayloVoiceError'>();
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('inspectCall');
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('RemoteAudio');
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('WAYLO_VOICE_ERROR_CODES');
  });

  it('WayloVoice is constructed with optional options', () => {
    expectTypeOf(WayloVoice).constructorParameters.toEqualTypeOf<
      [options?: WayloVoiceOptions | undefined]
    >();
    expectTypeOf(WayloVoice).toBeConstructibleWith();
    expectTypeOf(WayloVoice).toBeConstructibleWith({ agentTimeoutMs: 5000 });
  });

  it('WayloVoice exposes no static test helpers', () => {
    expectTypeOf(WayloVoice).not.toHaveProperty('stateOf');
    expectTypeOf(WayloVoice).not.toHaveProperty('errorOf');
    expectTypeOf(WayloVoice).not.toHaveProperty('onState');
    expectTypeOf(WayloVoice).not.toHaveProperty('inspectCall');
  });

  it('WayloVoice has start and stop only', () => {
    expectTypeOf<keyof WayloVoice>().toEqualTypeOf<'start' | 'stop'>();
    expectTypeOf<WayloVoice['start']>().parameters.toEqualTypeOf<[WebSessionBootstrap]>();
    expectTypeOf<WayloVoice['start']>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<WayloVoice['stop']>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<WayloVoice['stop']>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<WayloVoice>().not.toHaveProperty('dispose');
  });

  it('WayloVoiceOptions has an optional agentTimeoutMs', () => {
    expectTypeOf<WayloVoiceOptions>().toEqualTypeOf<{ agentTimeoutMs?: number }>();
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
