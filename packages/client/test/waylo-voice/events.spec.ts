import { DisconnectReason } from 'livekit-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WayloVoiceState } from '../../src/index.js';
import { activeCall, record } from '../__setup__/active-call.js';
import { everyErrorSurface, wayloVoiceErrorFrom } from '../__setup__/errors.js';
import { behavior, flush, lastRoom } from '../__setup__/fake-room.js';
import { createCall, serveSession, START } from '../__setup__/fake-session-endpoint.js';
import { TEST_PARTICIPANT_TOKEN } from '../__setup__/fixtures.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('WayloVoice state', () => {
  it('starts idle with a frozen snapshot', () => {
    const state = createCall().getState();

    expect(state).toEqual({
      agent: 'none',
      connection: 'idle',
      microphone: 'off',
      network: 'good',
      playback: 'stopped',
      stage: 'idle',
      volume: 1,
    });
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('reports connecting, the session, the mic, playback and the agent, then connected', async () => {
    const { call, states } = await activeCall();

    const connections = states.map(state => state.connection);

    expect(connections.at(-1)).toBe('connected');
    expect(connections.slice(0, -1).every(connection => connection === 'connecting')).toBe(true);
    expect(call.getState()).toEqual({
      agent: 'listening',
      connection: 'connected',
      microphone: 'on',
      network: 'good',
      playback: 'playing',
      microphoneDeviceId: 'default',
      sessionId: 'session-1',
      stage: 'preparing',
      timings: expect.objectContaining({ agentReadyMs: expect.any(Number) }),
      volume: 1,
    });
    expect(states.at(-1)).toBe(call.getState());
  });

  it('follows the agent activity', async () => {
    const { call, room } = await activeCall();
    const seen: string[] = [];

    call.on('state', state => seen.push(state.agent));

    room.setAttributes('agent', { 'lk.agent.state': 'thinking' });
    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    room.setAttributes('agent', { 'lk.agent.state': 'idle' });
    room.setAttributes('agent', { 'lk.agent.state': 'listening' });
    expect(seen).toEqual(['thinking', 'speaking', 'listening']);
  });

  it('shows reconnecting, then connected again', async () => {
    const { call, room } = await activeCall();

    room.emit('reconnecting');
    expect(call.getState().connection).toBe('reconnecting');
    room.emit('reconnected');
    expect(call.getState().connection).toBe('connected');
  });

  it('follows the network quality of this browser only, ignoring unknown', async () => {
    const { call, room, states } = await activeCall();

    room.emit('connectionQualityChanged', 'poor', room.localParticipant);
    expect(call.getState().network).toBe('poor');
    room.emit('connectionQualityChanged', 'unknown', room.localParticipant);
    room.emit('connectionQualityChanged', 'excellent', room.remoteParticipants.get('agent'));
    expect(call.getState().network).toBe('poor');
    room.emit('connectionQualityChanged', 'lost', room.localParticipant);
    expect(call.getState().network).toBe('lost');
    room.emit('connectionQualityChanged', 'excellent', room.localParticipant);
    room.emit('connectionQualityChanged', 'good', room.localParticipant);
    expect(states.map(state => state.network).slice(-3)).toEqual(['poor', 'lost', 'good']);
  });

  it('shows the network as good again once the call ends', async () => {
    const { call, room } = await activeCall();

    room.emit('connectionQualityChanged', 'lost', room.localParticipant);
    await call.stop();
    expect(call.getState()).toMatchObject({ connection: 'disconnected', network: 'good' });
  });

  it('shows blocked playback and playing again', async () => {
    const { call, room } = await activeCall();

    room.setPlayback(false);
    expect(call.getState().playback).toBe('blocked');
    room.setPlayback(true);
    expect(call.getState().playback).toBe('playing');
  });

  it('emits nothing when nothing changed', async () => {
    const { room, states } = await activeCall();
    const before = states.length;

    room.setAttributes('agent', { 'lk.agent.state': 'listening' });
    room.setPlayback(true);
    expect(states).toHaveLength(before);
  });
});

function stagesOf(states: readonly WayloVoiceState[]): string[] {
  return states.map(state => state.stage).filter((stage, index, all) => stage !== all[index - 1]);
}

describe('WayloVoice stage', () => {
  it('goes from connecting through joining and preparing to the agent turns', async () => {
    behavior.agent = 'later';
    behavior.agentState = 'initializing';
    const call = createCall();
    const { states } = record(call);
    const started = call.start(START);

    await flush();
    const room = lastRoom();

    room.addAgent();
    room.setAttributes('agent', { 'lk.agent.state': 'listening' });
    await started;
    room.setAttributes('agent', { 'lk.agent.state': 'thinking' });
    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    room.setAttributes('agent', { 'lk.agent.state': 'listening' });
    room.setAttributes('agent', { 'lk.agent.state': 'thinking' });

    expect(stagesOf(states)).toEqual([
      'connecting',
      'joining',
      'preparing',
      'speaking',
      'listening',
      'thinking',
    ]);
  });

  it('shows reconnecting, then the agent turn again', async () => {
    const { room, states } = await activeCall();

    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    room.emit('reconnecting');
    room.emit('reconnected');

    expect(stagesOf(states).slice(-3)).toEqual(['speaking', 'reconnecting', 'speaking']);
  });

  it('stays preparing across a reconnect before the agent first speaks', async () => {
    const { call, room } = await activeCall();

    room.emit('reconnecting');
    room.emit('reconnected');

    expect(call.getState().stage).toBe('preparing');
  });

  it('stays reconnecting until the agent is back after a full reconnect', async () => {
    const { call, room } = await activeCall();

    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    room.removeParticipant('agent');
    room.state = 'reconnecting';
    room.emit('reconnecting');
    await flush();
    room.state = 'connected';
    room.emit('reconnected');
    expect(call.getState().stage).toBe('reconnecting');

    room.addAgent();
    expect(call.getState().stage).toBe('listening');
  });

  it('goes straight to ended when the agent leaves', async () => {
    const { agent, room, states } = await activeCall();

    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    agent.attributes = { session_status: 'completed', session_end_reason: 'agent_end' };
    room.removeParticipant('agent');
    await flush();

    expect(stagesOf(states).slice(-2)).toEqual(['speaking', 'ended']);
  });

  it('ends a failed start as ended', async () => {
    serveSession({});
    const call = createCall();

    await call.start(START).catch(() => undefined);

    expect(call.getState()).toMatchObject({ end: { status: 'failed' }, stage: 'ended' });
  });

  it('emits nothing after ended', async () => {
    const { call, room, states } = await activeCall();

    await call.stop();
    const count = states.length;

    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    room.emit('reconnecting');

    expect(states).toHaveLength(count);
    expect(states.at(-1)?.stage).toBe('ended');
  });
});

describe('WayloVoice ready', () => {
  it('waits after the agent joins until it reports an activity state', async () => {
    behavior.agentState = 'initializing';
    const call = createCall();
    let resolved = false;
    const started = call.start(START).then(() => {
      resolved = true;
    });

    await flush();
    expect(resolved).toBe(false);
    expect(call.getState()).toMatchObject({ agent: 'joining', connection: 'connecting' });

    lastRoom().setAttributes('agent', { 'lk.agent.state': 'speaking' });
    await started;
    expect(call.getState()).toMatchObject({ agent: 'speaking', connection: 'connected' });
  });

  it('fails with AGENT_TIMEOUT when the agent never gets past initializing', async () => {
    vi.useFakeTimers();
    behavior.agentState = 'initializing';
    const call = createCall({ agentTimeoutMs: 1000 });
    const failed = wayloVoiceErrorFrom(call.start(START));

    await vi.advanceTimersByTimeAsync(1000);
    const error = await failed;

    expect(error.code).toBe('AGENT_TIMEOUT');
    expect(call.getState().end).toMatchObject({ status: 'failed' });
  });
});

describe('WayloVoice end of call', () => {
  it('stop() after connected ends completed with caller_hangup', async () => {
    const { call, errors, states } = await activeCall();

    await call.stop();
    expect(call.getState()).toEqual({
      agent: 'none',
      connection: 'disconnected',
      end: { reason: 'caller_hangup', status: 'completed' },
      microphone: 'off',
      network: 'good',
      playback: 'stopped',
      microphoneDeviceId: 'default',
      sessionId: 'session-1',
      stage: 'ended',
      timings: expect.objectContaining({ agentReadyMs: expect.any(Number) }),
      volume: 1,
    });
    expect(states.filter(state => state.end)).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('stop() while connecting ends failed with CANCELLED', async () => {
    behavior.agent = 'later';
    const call = createCall();
    const started = call.start(START);

    await flush();
    await call.stop();
    await expect(started).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(call.getState().end).toMatchObject({ error: { code: 'CANCELLED' }, status: 'failed' });
  });

  it('keeps the worker verdict until the room really closes', async () => {
    const { agent, call, room } = await activeCall();

    room.setAttributes('agent', {
      session_end_reason: 'caller_goodbye',
      session_status: 'completed',
    });
    expect(call.getState()).toMatchObject({ connection: 'connected' });
    expect(call.getState().end).toBeUndefined();

    agent.attributes = {};
    room.serverDisconnect(DisconnectReason.ROOM_DELETED);
    await flush();
    expect(call.getState().end).toEqual({ reason: 'caller_goodbye', status: 'completed' });
  });

  it.each([
    ['caller_inactive', 'caller_inactive'],
    ['max_duration', 'max_duration'],
  ])('passes the completed reason %s through', async (reason, expected) => {
    const { call, room } = await activeCall();

    room.setAttributes('agent', { session_end_reason: reason, session_status: 'completed' });
    room.serverDisconnect(DisconnectReason.ROOM_DELETED);
    await flush();
    expect(call.getState().end).toEqual({ reason: expected, status: 'completed' });
  });

  it('ends completed with no reason when the room closes cleanly without a verdict', async () => {
    const { call, errors, room } = await activeCall();

    room.serverDisconnect(DisconnectReason.ROOM_DELETED);
    await flush();
    expect(call.getState().end).toEqual({ status: 'completed' });
    expect(errors).toHaveLength(0);
  });

  it.each(['worker_error', 'provider_key_failed'])(
    'fails with AGENT_ERROR and reason %s on a failed verdict, with an error event first',
    async reason => {
      const { call, errors, room, states } = await activeCall();

      room.setAttributes('agent', { session_end_reason: reason, session_status: 'failed' });
      room.serverDisconnect(DisconnectReason.ROOM_DELETED);
      await flush();
      expect(errors.map(error => error.code)).toEqual(['AGENT_ERROR']);
      expect(call.getState().end).toMatchObject({
        error: { code: 'AGENT_ERROR' },
        reason,
        status: 'failed',
      });
      expect(states.at(-1)?.end?.status).toBe('failed');
    },
  );

  it('fails with CONNECTION_FAILED on an error disconnect without a verdict', async () => {
    const { call, errors, room } = await activeCall();

    room.serverDisconnect(DisconnectReason.SIGNAL_CLOSE);
    await flush();
    expect(errors.map(error => error.code)).toEqual(['CONNECTION_FAILED']);
    expect(call.getState().end).toMatchObject({
      error: { code: 'CONNECTION_FAILED' },
      status: 'failed',
    });
  });

  it('fails with AGENT_LEFT when the agent leaves without a verdict', async () => {
    const { call, errors, room } = await activeCall();

    room.removeParticipant('agent');
    await flush();
    expect(errors.map(error => error.code)).toEqual(['AGENT_LEFT']);
    expect(call.getState().end).toMatchObject({ error: { code: 'AGENT_LEFT' }, status: 'failed' });
  });

  it('rejects start() without an error event when the start fails', async () => {
    serveSession({});
    const call = createCall();
    const { errors, states } = record(call);

    await expect(wayloVoiceErrorFrom(call.start(START))).resolves.toMatchObject({
      code: 'INVALID_SESSION',
    });
    expect(errors).toHaveLength(0);
    expect(states.at(-1)?.end).toMatchObject({ error: { code: 'INVALID_SESSION' } });
  });

  it('emits nothing after the final state, whoever ended the call', async () => {
    const { call, errors, room, states } = await activeCall();
    const late = vi.fn();

    room.serverDisconnect(DisconnectReason.ROOM_DELETED);
    await flush();
    const count = states.length;

    call.on('state', late);
    room.setAttributes('agent', { 'lk.agent.state': 'speaking' });
    room.emit('reconnecting');
    room.setPlayback(false);
    call.setVolume(0.5);
    await call.setMuted(true);
    await call.stop();
    await flush();
    expect(states).toHaveLength(count);
    expect(errors).toHaveLength(0);
    expect(late).not.toHaveBeenCalled();
    expect(room.textStreamHandlers.size).toBe(0);
  });

  it('never puts the participant token in a state or an error', async () => {
    const { errors, room, states } = await activeCall();

    room.serverDisconnect(DisconnectReason.SIGNAL_CLOSE);
    await flush();
    expect(JSON.stringify(states)).not.toContain(TEST_PARTICIPANT_TOKEN);

    for (const error of errors)
      expect(everyErrorSurface(error)).not.toContain(TEST_PARTICIPANT_TOKEN);
  });
});

describe('WayloVoice listeners', () => {
  it('unsubscribes with the returned function and with off()', async () => {
    const call = createCall();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = call.on('state', first);

    call.on('state', second);
    unsubscribe();
    call.off('state', second);
    await call.start(START);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('keeps calling other listeners when one throws', async () => {
    vi.stubGlobal('reportError', vi.fn());
    const call = createCall();
    const good = vi.fn();

    call.on('state', () => {
      throw new Error('bad listener');
    });
    call.on('state', good);
    await call.start(START);
    expect(good).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
