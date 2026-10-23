import { describe, expectTypeOf, it } from 'vitest';

import type * as PublicApi from '../src/index.js';
import {
  type SessionHeaders,
  WayloVoice,
  type WayloVoiceEnd,
  WayloVoiceError,
  type WayloVoiceErrorCode,
  type WayloVoiceEvents,
  type WayloVoiceMicrophone,
  type WayloVoiceOptions,
  type WayloVoicePlayback,
  type WayloVoiceStartOptions,
  type WayloVoiceState,
  type WayloVoiceTranscript,
} from '../src/index.js';
import type { WebSessionBootstrap } from '../src/session.js';

describe('public API', () => {
  it('exports only the public surface', () => {
    expectTypeOf<keyof typeof PublicApi>().toEqualTypeOf<'WayloVoice' | 'WayloVoiceError'>();
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('inspectCall');
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('RemoteAudio');
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('decideDisconnect');
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('WAYLO_VOICE_ERROR_CODES');
    expectTypeOf<typeof PublicApi>().not.toHaveProperty('fetchSession');
  });

  it('does not export WebSessionBootstrap', () => {
    // @ts-expect-error -- the session shape stays internal
    expectTypeOf<PublicApi.WebSessionBootstrap>().toBeObject();
  });

  it('WayloVoice is constructed with options that name the session endpoint', () => {
    expectTypeOf(WayloVoice).constructorParameters.toEqualTypeOf<[options: WayloVoiceOptions]>();
    expectTypeOf(WayloVoice).toBeConstructibleWith({ sessionEndpoint: '/api/waylo/session' });
    expectTypeOf(WayloVoice).toBeConstructibleWith({
      agentTimeoutMs: 5000,
      headers: async () => ({ Authorization: 'Bearer x' }),
      sessionEndpoint: '/api/waylo/session',
    });
    expectTypeOf(WayloVoice).toBeConstructibleWith({
      headers: () => ({ Authorization: 'Bearer x' }),
      sessionEndpoint: '/api/waylo/session',
    });
    // @ts-expect-error -- sessionEndpoint is required
    expectTypeOf(WayloVoice).toBeConstructibleWith();
    // @ts-expect-error -- sessionEndpoint is required
    expectTypeOf(WayloVoice).toBeConstructibleWith({ agentTimeoutMs: 5000 });
  });

  it('WayloVoice exposes no static test helpers', () => {
    expectTypeOf(WayloVoice).not.toHaveProperty('stateOf');
    expectTypeOf(WayloVoice).not.toHaveProperty('errorOf');
    expectTypeOf(WayloVoice).not.toHaveProperty('onState');
    expectTypeOf(WayloVoice).not.toHaveProperty('inspectCall');
  });

  it('WayloVoice has the call, state and control methods only', () => {
    expectTypeOf<keyof WayloVoice>().toEqualTypeOf<
      'getState' | 'off' | 'on' | 'resumeAudio' | 'setMuted' | 'setVolume' | 'start' | 'stop'
    >();
    expectTypeOf<WayloVoice['start']>().parameters.toEqualTypeOf<[WayloVoiceStartOptions]>();
    expectTypeOf<WayloVoice['start']>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<WayloVoice['stop']>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<WayloVoice['stop']>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<WayloVoice>().not.toHaveProperty('dispose');
  });

  it('start() takes an agent id, not a session', () => {
    expectTypeOf<WayloVoice['start']>().toBeCallableWith({
      agentId: '3f9c2a7e-1b4d-4c8a-9e2f-5d6b7a8c9e01',
    });
    expectTypeOf<WayloVoice['start']>().toBeCallableWith({
      agentId: '3f9c2a7e-1b4d-4c8a-9e2f-5d6b7a8c9e01',
      metadata: { orderId: '42' },
    });
    // @ts-expect-error -- start() takes options, not a session
    expectTypeOf<WayloVoice['start']>().toBeCallableWith({} as WebSessionBootstrap);
    // @ts-expect-error -- agentId is required
    expectTypeOf<WayloVoice['start']>().toBeCallableWith({});
  });

  it('WayloVoiceOptions names the session endpoint, optional headers and agentTimeoutMs', () => {
    expectTypeOf<WayloVoiceOptions>().toEqualTypeOf<{
      agentTimeoutMs?: number;
      headers?: () => Record<string, string> | Promise<Record<string, string>>;
      sessionEndpoint: string;
    }>();
  });

  it('SessionHeaders is a function that returns headers, sync or async', () => {
    expectTypeOf<SessionHeaders>().toEqualTypeOf<
      () => Record<string, string> | Promise<Record<string, string>>
    >();
    expectTypeOf<WayloVoiceOptions['headers']>().toEqualTypeOf<SessionHeaders | undefined>();
  });

  it('WayloVoiceStartOptions is an agent id and optional metadata', () => {
    expectTypeOf<WayloVoiceStartOptions>().toEqualTypeOf<{
      agentId: string;
      metadata?: Record<string, unknown>;
    }>();
  });

  it('WayloVoiceError is an Error with a readonly code', () => {
    expectTypeOf<WayloVoiceError>().toExtend<Error>();
    expectTypeOf<WayloVoiceError['code']>().toEqualTypeOf<WayloVoiceErrorCode>();
    expectTypeOf<WayloVoiceError['name']>().toEqualTypeOf<'WayloVoiceError'>();
    expectTypeOf<Readonly<Pick<WayloVoiceError, 'code'>>>().toEqualTypeOf<
      Pick<WayloVoiceError, 'code'>
    >();
  });

  it('WayloVoiceErrorCode is the closed UPPERCASE set of codes', () => {
    expectTypeOf<WayloVoiceErrorCode>().toEqualTypeOf<
      | 'ACCESS_DENIED'
      | 'AGENT_ERROR'
      | 'AGENT_LEFT'
      | 'AGENT_TIMEOUT'
      | 'ALREADY_STARTED'
      | 'AUTH_REQUIRED'
      | 'CANCELLED'
      | 'CONNECTION_FAILED'
      | 'INVALID_SESSION'
      | 'LIMIT_REACHED'
      | 'MICROPHONE_DENIED'
      | 'MICROPHONE_UNAVAILABLE'
      | 'SESSION_EXPIRED'
      | 'TRANSCRIPT_FAILED'
    >();
  });

  it('getState() returns the state snapshot', () => {
    expectTypeOf<WayloVoice['getState']>().returns.toEqualTypeOf<WayloVoiceState>();
    expectTypeOf<WayloVoiceState['agent']>().toEqualTypeOf<
      'joining' | 'listening' | 'none' | 'speaking' | 'thinking'
    >();
    expectTypeOf<WayloVoiceState['connection']>().toEqualTypeOf<
      'connected' | 'connecting' | 'disconnected' | 'idle' | 'reconnecting'
    >();
    expectTypeOf<WayloVoiceMicrophone>().toEqualTypeOf<'muted' | 'off' | 'on'>();
    expectTypeOf<WayloVoiceState['microphone']>().toEqualTypeOf<WayloVoiceMicrophone>();
    expectTypeOf<WayloVoicePlayback>().toEqualTypeOf<'blocked' | 'playing' | 'stopped'>();
    expectTypeOf<WayloVoiceState['playback']>().toEqualTypeOf<WayloVoicePlayback>();
  });

  it('a failed end always carries an error, a completed one never does', () => {
    const end = {} as WayloVoiceEnd;

    if (end.status === 'failed') expectTypeOf(end.error).toEqualTypeOf<WayloVoiceError>();
    else expectTypeOf(end).not.toHaveProperty('error');
  });

  it('on() and off() are typed per event', () => {
    expectTypeOf<WayloVoiceEvents>().toEqualTypeOf<{
      error: WayloVoiceError;
      state: WayloVoiceState;
      transcript: WayloVoiceTranscript;
    }>();

    const subscribe = (call: WayloVoice) => {
      const off = call.on('transcript', line => {
        expectTypeOf(line).toEqualTypeOf<WayloVoiceTranscript>();
      });

      call.off('state', state => {
        expectTypeOf(state).toEqualTypeOf<WayloVoiceState>();
      });
      // @ts-expect-error -- unknown event
      call.on('speech-start', () => undefined);

      return off;
    };

    expectTypeOf(subscribe).returns.toEqualTypeOf<() => void>();
  });

  it('WayloVoiceTranscript is an id, a speaker, the whole text and a final flag', () => {
    expectTypeOf<WayloVoiceTranscript>().toEqualTypeOf<{
      readonly final: boolean;
      readonly id: string;
      readonly speaker: 'agent' | 'user';
      readonly text: string;
    }>();
  });
});
