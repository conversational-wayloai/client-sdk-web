import { describe, expect, it } from 'vitest';

import { WayloVoice } from '../../src/index.js';
import { inspectCall } from '../../src/waylo-voice.js';
import { FakeRoom } from '../__setup__/fake-room.js';

describe('new WayloVoice', () => {
  it('creates an idle call without touching LiveKit', () => {
    expect(inspectCall(new WayloVoice({ agentTimeoutMs: 1 })).state).toBe('idle');
    expect(FakeRoom.instances).toHaveLength(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5000'])(
    'throws a RangeError for agentTimeoutMs %s',
    agentTimeoutMs => {
      expect(() => new WayloVoice({ agentTimeoutMs: agentTimeoutMs as number })).toThrow(
        RangeError,
      );
    },
  );
});
