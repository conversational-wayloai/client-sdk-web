import { describe, expect, it } from 'vitest';

import { WayloVoice, type WayloVoiceOptions } from '../../src/index.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { FakeRoom } from '../__setup__/fake-room.js';
import { fetchMock, TEST_SESSION_ENDPOINT } from '../__setup__/fake-session-endpoint.js';

describe('new WayloVoice', () => {
  it('creates an idle call without touching LiveKit or the session endpoint', () => {
    const call = new WayloVoice({
      agentTimeoutMs: 1,
      headers: () => ({}),
      sessionEndpoint: TEST_SESSION_ENDPOINT,
    });

    expect(inspectCall(call).state).toBe('idle');
    expect(FakeRoom.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5000'])(
    'throws a RangeError for agentTimeoutMs %s',
    agentTimeoutMs => {
      expect(
        () =>
          new WayloVoice({
            agentTimeoutMs: agentTimeoutMs as number,
            sessionEndpoint: TEST_SESSION_ENDPOINT,
          }),
      ).toThrow(RangeError);
    },
  );

  it.each([undefined, '', '   ', 42])(
    'throws a RangeError for sessionEndpoint %j',
    sessionEndpoint => {
      expect(() => new WayloVoice({ sessionEndpoint } as unknown as WayloVoiceOptions)).toThrow(
        RangeError,
      );
    },
  );

  it.each(['https://evil.example/api/waylo/session', '//evil.example/session', 'http://[bad'])(
    'throws a RangeError for the cross-origin or invalid sessionEndpoint %s',
    sessionEndpoint => {
      expect(() => new WayloVoice({ sessionEndpoint })).toThrow(RangeError);
    },
  );

  it.each([
    TEST_SESSION_ENDPOINT,
    'api/waylo/session',
    `${globalThis.location.origin}/api/waylo/session`,
  ])('accepts the same-origin sessionEndpoint %s', sessionEndpoint => {
    expect(() => new WayloVoice({ sessionEndpoint })).not.toThrow();
  });

  it('throws a RangeError without options', () => {
    expect(() => new WayloVoice(undefined as unknown as WayloVoiceOptions)).toThrow(RangeError);
  });

  it.each([{ Authorization: 'x' }, 'Bearer x', null])(
    'throws a RangeError for headers %j',
    headers => {
      expect(
        () =>
          new WayloVoice({
            headers,
            sessionEndpoint: TEST_SESSION_ENDPOINT,
          } as unknown as WayloVoiceOptions),
      ).toThrow(RangeError);
    },
  );
});
