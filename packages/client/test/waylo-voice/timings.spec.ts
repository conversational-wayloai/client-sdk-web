import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeCall, record } from '../__setup__/active-call.js';
import { behavior, deferred, flush, lastRoom } from '../__setup__/fake-room.js';
import { createCall, START } from '../__setup__/fake-session-endpoint.js';

let now = 0;

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    now += 100;

    return now;
  });
  vi.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WayloVoice timings', () => {
  it('has none before start()', () => {
    expect(createCall().getState().timings).toBeUndefined();
  });

  it('records each start step in whole ms after start()', async () => {
    behavior.agent = 'later';
    const call = createCall();
    const started = call.start(START);

    await vi.waitFor(() => expect(call.getState().timings?.microphoneReadyMs).toBeDefined());
    lastRoom().addAgent();
    await started;
    const { timings } = call.getState();

    expect(timings).toEqual({
      agentReadyMs: 500,
      connectedMs: 300,
      microphoneOpenMs: 100,
      microphoneReadyMs: 400,
      sessionReadyMs: 200,
      startedAt: 1_767_000_000_000,
    });
    expect(Object.isFrozen(timings)).toBe(true);
  });

  it('records the agent ready as it arrives, even before the microphone', async () => {
    const microphone = deferred();

    behavior.microphone = () => microphone.promise;
    const call = createCall();
    const started = call.start(START);

    await flush();
    const { agentReadyMs } = call.getState().timings ?? {};

    expect(agentReadyMs).toBeGreaterThan(0);
    microphone.resolve();
    await started;
    expect(call.getState().timings?.agentReadyMs).toBe(agentReadyMs);
    expect(agentReadyMs).toBeLessThan(call.getState().timings?.microphoneReadyMs ?? 0);
  });

  it('marks the mic open on its own time, and ready only once it is live in the call', async () => {
    const prompt = deferred();

    behavior.microphone = () => prompt.promise;
    const call = createCall();
    const started = call.start(START);

    await flush();
    expect(call.getState().timings?.connectedMs).toBeDefined();
    expect(call.getState().timings?.microphoneOpenMs).toBeUndefined();
    prompt.resolve();
    await started;
    const {
      connectedMs = 0,
      microphoneOpenMs = 0,
      microphoneReadyMs = 0,
    } = call.getState().timings ?? {};

    expect(microphoneOpenMs).toBeGreaterThan(connectedMs);
    expect(microphoneReadyMs).toBeGreaterThan(microphoneOpenMs);
  });

  it('marks the agent ready once', async () => {
    const { call, room } = await activeCall();
    const { agentReadyMs } = call.getState().timings ?? {};

    room.setAttributes('agent', { 'lk.agent.state': 'thinking' });
    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    room.setAttributes('agent', { 'lk.agent.state': 'listening' });

    expect(call.getState().timings?.agentReadyMs).toBe(agentReadyMs);
  });

  it('sets the start time together with connecting', () => {
    const call = createCall();
    const { states } = record(call);

    call.start(START).catch(() => undefined);

    expect(states[0]).toMatchObject({
      connection: 'connecting',
      timings: { startedAt: 1_767_000_000_000 },
    });
  });

  it('marks once when the agent first speaks', async () => {
    behavior.agentState = 'joining';
    behavior.agent = 'later';
    const call = createCall();
    const started = call.start(START);

    await flush();
    const room = lastRoom();

    room.addAgent();
    room.setAttributes('agent', { 'lk.agent.state': 'listening' });
    await started;
    expect(call.getState().timings?.agentSpeakingMs).toBeUndefined();

    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    const first = call.getState().timings?.agentSpeakingMs;

    room.setAttributes('agent', { 'lk.agent.state': 'listening' });
    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    expect(first).toBeGreaterThan(call.getState().timings?.agentReadyMs ?? Infinity);
    expect(call.getState().timings?.agentSpeakingMs).toBe(first);
  });

  it('waits for blocked audio to be allowed', async () => {
    const { call, room } = await activeCall();

    room.setPlayback(false);
    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    expect(call.getState().timings?.agentSpeakingMs).toBeUndefined();

    room.setPlayback(true);
    expect(call.getState().timings?.agentSpeakingMs).toBeGreaterThan(0);
  });

  it('keeps the steps reached when the start fails', async () => {
    const prompt = deferred();

    behavior.agent = 'later';
    behavior.microphone = () => prompt.promise;
    const call = createCall();
    const started = call.start(START).catch(() => undefined);

    await flush();
    prompt.reject(new DOMException('denied', 'NotAllowedError'));
    await started;

    expect(call.getState().timings).toEqual({
      connectedMs: 200,
      sessionReadyMs: 100,
      startedAt: 1_767_000_000_000,
    });
  });

  it('records nothing after stop()', async () => {
    const connecting = deferred();

    behavior.connect = () => connecting.promise;
    const call = createCall();
    const started = call.start(START).catch(() => undefined);

    await flush();
    await call.stop();
    connecting.resolve();
    await started;

    expect(call.getState().timings).toEqual({
      microphoneOpenMs: 100,
      sessionReadyMs: 200,
      startedAt: 1_767_000_000_000,
    });
  });
});
