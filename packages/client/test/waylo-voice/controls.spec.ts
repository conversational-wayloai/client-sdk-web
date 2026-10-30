import { createAudioAnalyser, DisconnectReason } from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';

import { errorCodeFrom } from '../__setup__/errors.js';
import { analysers, type FakeLocalTrack } from '../__setup__/fake-media.js';
import { behavior, deferred, flush, lastRoom } from '../__setup__/fake-room.js';
import { createCall, START } from '../__setup__/fake-session-endpoint.js';

function audio(): HTMLAudioElement[] {
  return [...document.querySelectorAll('audio')];
}

function expectMutedBeforePublish(track: FakeLocalTrack | undefined) {
  const [publishOrder] = lastRoom().localParticipant.publishTrack.mock.invocationCallOrder;

  expect(track?.isMuted).toBe(true);
  expect(track?.unmute).not.toHaveBeenCalled();
  expect(track?.mute.mock.invocationCallOrder[0]).toBeLessThan(publishOrder ?? 0);
}

describe('setVolume()', () => {
  it('applies volume 0 to a track attached later', async () => {
    behavior.agent = 'later';
    const call = createCall();

    call.setVolume(0);
    const started = call.start(START);

    await flush();
    lastRoom().addAgent();
    await started;
    expect(audio()).toHaveLength(1);
    expect(audio().every(element => element.volume === 0 && element.muted)).toBe(true);
    expect(call.getState().volume).toBe(0);
  });

  it('keeps volume 0 on a new track after a reconnect', async () => {
    const call = createCall();

    await call.start(START);
    call.setVolume(0);
    const room = lastRoom();

    room.state = 'reconnecting';
    room.emit('reconnecting');
    room.removeParticipant('agent');
    await flush();
    room.addAgent('agent');
    room.state = 'connected';
    room.emit('reconnected');
    await flush();
    expect(call.getState().connection).toBe('connected');
    expect(audio()).toHaveLength(2);
    expect(audio().every(element => element.volume === 0 && element.muted)).toBe(true);
  });

  it('puts volume 0 back when LiveKit unmutes the element', async () => {
    const call = createCall();

    await call.start(START);
    call.setVolume(0);
    const [element] = audio();

    if (!element) throw new Error('no audio element');
    element.muted = false;
    element.dispatchEvent(new Event('volumechange'));
    expect(element.muted).toBe(true);
  });

  it('applies a new volume to playing elements and unmutes from 0', async () => {
    const call = createCall();

    await call.start(START);
    call.setVolume(0);
    call.setVolume(0.3);
    expect(audio().every(element => element.volume === 0.3 && !element.muted)).toBe(true);
  });

  it('fires no state event for the same value twice', async () => {
    const call = createCall();
    const listener = vi.fn();

    await call.start(START);
    call.setVolume(0.5);
    call.on('state', listener);
    call.setVolume(0.5);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([2, -1, Number.NaN, '0.5'])('throws RangeError for %s', value => {
    expect(() => createCall().setVolume(value as number)).toThrow(RangeError);
  });

  it('is a no-op after the call ended', async () => {
    const call = createCall();

    await call.start(START);
    lastRoom().serverDisconnect(DisconnectReason.ROOM_DELETED);
    await flush();
    call.setVolume(0.2);
    expect(call.getState().volume).toBe(1);
  });
});

describe('setMuted()', () => {
  it('mutes and unmutes the published mic', async () => {
    const call = createCall();

    await call.start(START);
    const { localParticipant } = lastRoom();

    await call.setMuted(true);
    expect(localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(call.getState().microphone).toBe('muted');
    await call.setMuted(false);
    expect(localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(call.getState().microphone).toBe('on');
  });

  it('publishes the mic already muted when muted before start()', async () => {
    const call = createCall();

    await call.setMuted(true);
    await call.start(START);
    const { localParticipant } = lastRoom();
    const track = localParticipant.microphone?.track;

    expect(localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expectMutedBeforePublish(track);
    expect(call.getState().microphone).toBe('muted');
  });

  it('mutes before publishing when mute is pressed while the mic is being acquired', async () => {
    const mic = deferred();

    behavior.microphone = () => mic.promise;
    const call = createCall();
    const started = call.start(START);

    await flush();
    expect(lastRoom().localParticipant.createTracks).toHaveBeenCalled();
    await call.setMuted(true);
    mic.resolve();
    await started;
    const track = lastRoom().localParticipant.microphone?.track;

    expectMutedBeforePublish(track);
    expect(call.getState().microphone).toBe('muted');
  });

  it('applies a mute pressed while the mic is being published', async () => {
    const published = deferred();
    const call = createCall();
    const started = call.start(START);
    const { localParticipant } = lastRoom();

    localParticipant.publishTrack.mockImplementationOnce(async track => {
      await published.promise;
      localParticipant.microphone = { track };

      return localParticipant.microphone;
    });
    await flush();
    expect(localParticipant.publishTrack).toHaveBeenCalled();
    await call.setMuted(true);
    published.resolve();
    await started;

    expect(localParticipant.microphone?.track.isMuted).toBe(true);
    expect(call.getState().microphone).toBe('muted');
  });

  it('fires no state event for the same value twice', async () => {
    const call = createCall();
    const listener = vi.fn();

    await call.start(START);
    await call.setMuted(true);
    call.on('state', listener);
    await call.setMuted(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects a failed unmute with a mic error and stays muted', async () => {
    const call = createCall();

    await call.start(START);
    await call.setMuted(true);
    const { localParticipant } = lastRoom();

    localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );
    await expect(errorCodeFrom(call.setMuted(false))).resolves.toBe('MICROPHONE_DENIED');
    expect(call.getState().microphone).toBe('muted');
  });

  it('keeps a mute pressed while an unmute is still running', async () => {
    const call = createCall();

    await call.start(START);
    await call.setMuted(true);
    const { localParticipant } = lastRoom();
    const unmuting = deferred();

    localParticipant.setMicrophoneEnabled.mockImplementationOnce(async () => {
      await unmuting.promise;
      await localParticipant.microphone?.track.unmute();

      return localParticipant.microphone;
    });
    const toggles = [call.setMuted(false), call.setMuted(true)];

    await flush();
    unmuting.resolve();
    await Promise.all(toggles);

    expect(localParticipant.microphone?.track.isMuted).toBe(true);
    expect(call.getState().microphone).toBe('muted');
  });

  it('applies only the last of rapid toggles, one LiveKit call at a time', async () => {
    const call = createCall();

    await call.start(START);
    const { localParticipant } = lastRoom();
    const muting = deferred();

    localParticipant.setMicrophoneEnabled.mockImplementationOnce(async () => {
      await muting.promise;
      await localParticipant.microphone?.track.mute();

      return localParticipant.microphone;
    });
    const first = call.setMuted(true);

    await flush();
    const toggles = [
      first,
      ...[false, true, false, true, false].map(muted => call.setMuted(muted)),
    ];

    await flush();
    expect(localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    muting.resolve();
    await Promise.all(toggles);

    expect(localParticipant.setMicrophoneEnabled.mock.calls).toEqual([[false], [true]]);
    expect(localParticipant.microphone?.track.isMuted).toBe(false);
    expect(call.getState().microphone).toBe('on');
  });

  it('mutes at once during a mic switch, and the new mic comes up muted', async () => {
    const switched = deferred();
    const call = createCall();

    await call.start(START);
    const { localParticipant } = lastRoom();
    const track = localParticipant.microphone?.track;

    behavior.switchDevice = () => switched.promise;
    const switching = call.setMicrophoneDevice('usb');

    await flush();
    await call.setMuted(true);
    expect(localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    switched.resolve();
    await switching;

    expect(track?.mediaStreamTrack).toMatchObject({ enabled: false, readyState: 'live' });
    expect(call.getState().microphone).toBe('muted');
  });

  it('opens no mic for a switch while muted, and the unmute opens the new one', async () => {
    const call = createCall();

    await call.start(START);
    await call.setMuted(true);
    const { localParticipant } = lastRoom();
    const track = localParticipant.microphone?.track;
    const switchDevice = vi.spyOn(behavior, 'switchDevice');

    await call.setMicrophoneDevice('usb');

    expect(switchDevice).not.toHaveBeenCalled();
    expect(track?.mediaStreamTrack).toMatchObject({ enabled: false, readyState: 'live' });
    expect(call.getState()).toMatchObject({ microphone: 'muted', microphoneDeviceId: 'usb' });

    await call.setMuted(false);

    expect(track?.deviceId).toBe('usb');
    expect(call.getState()).toMatchObject({ microphone: 'on', microphoneDeviceId: 'usb' });
  });

  it('opens no mic for a switch pressed together with a mute', async () => {
    const call = createCall();

    await call.start(START);
    const { localParticipant } = lastRoom();
    const track = localParticipant.microphone?.track;
    const switchDevice = vi.spyOn(behavior, 'switchDevice');

    await Promise.all([call.setMicrophoneDevice('usb'), call.setMuted(true)]);

    expect(switchDevice).not.toHaveBeenCalled();
    expect(track?.mute.mock.invocationCallOrder[0]).toBeLessThan(
      lastRoom().switchActiveDevice.mock.invocationCallOrder[0] ?? 0,
    );
    expect(track?.mediaStreamTrack.enabled).toBe(false);
    expect(call.getState()).toMatchObject({ microphone: 'muted', microphoneDeviceId: 'usb' });

    await call.setMuted(false);

    expect(track?.deviceId).toBe('usb');
    expect(call.getState().microphone).toBe('on');
  });

  it('keeps a mic reopened by an unmute disabled once LiveKit unmutes it, when a mute comes meanwhile', async () => {
    const call = createCall();

    await call.start(START);
    await call.setMuted(true);
    const { localParticipant } = lastRoom();
    const track = localParticipant.microphone?.track;

    if (!track) throw new Error('no mic');
    await call.setMicrophoneDevice('usb');
    const opened = deferred();
    const enabledOnUnmute: boolean[] = [];

    localParticipant.setMicrophoneEnabled.mockImplementationOnce(async () => {
      await opened.promise;
      await track.unmute();

      return localParticipant.microphone;
    });
    track.on('unmuted', () => enabledOnUnmute.push(track.mediaStreamTrack.enabled));
    const unmuting = call.setMuted(false);

    await flush();
    const muting = call.setMuted(true);

    opened.resolve();
    await Promise.all([unmuting, muting]);

    expect(enabledOnUnmute).toEqual([false]);
    expect(track.mediaStreamTrack.enabled).toBe(false);
    expect(call.getState()).toMatchObject({ microphone: 'muted', microphoneDeviceId: 'usb' });
  });

  it('leaves no timer behind after a muted switch and the call end', async () => {
    const call = createCall();

    await call.start(START);
    vi.useFakeTimers();

    try {
      await Promise.all([call.setMicrophoneDevice('usb'), call.setMuted(true)]);
      await call.stop();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmutes only after a mic switch in flight', async () => {
    const switched = deferred();
    const call = createCall();

    await call.start(START);
    const { localParticipant } = lastRoom();

    behavior.switchDevice = () => switched.promise;
    const switching = call.setMicrophoneDevice('usb');

    await flush();
    await call.setMuted(true);
    const unmuting = call.setMuted(false);

    await flush();
    expect(localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    switched.resolve();
    await Promise.all([switching, unmuting]);

    expect(localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(call.getState().microphone).toBe('on');
  });

  it('keeps a mute pressed while an unmute waits for a mic switch', async () => {
    const switched = deferred();
    const call = createCall();

    await call.start(START);
    await call.setMuted(true);
    const { localParticipant } = lastRoom();

    behavior.switchDevice = () => switched.promise;
    const toggles = [call.setMicrophoneDevice('usb'), call.setMuted(false), call.setMuted(true)];

    await flush();
    switched.resolve();
    await Promise.all(toggles);

    expect(localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    expect(localParticipant.microphone?.track.mediaStreamTrack.enabled).toBe(false);
    expect(call.getState().microphone).toBe('muted');
  });

  it('shows the mic again once LiveKit republishes it after a full reconnect', async () => {
    const call = createCall();

    await call.start(START);
    const room = lastRoom();
    const { localParticipant } = room;
    const publication = localParticipant.microphone;

    if (!publication) throw new Error('no mic');
    localParticipant.microphone = undefined;
    room.emit('localTrackUnpublished', { source: 'microphone' }, localParticipant);
    publication.track.emit('restarted');
    expect(call.getState().microphone).toBe('off');

    localParticipant.microphone = publication;
    room.emit('localTrackPublished', { source: 'microphone' }, localParticipant);
    expect(call.getState().microphone).toBe('on');
  });

  it('applies a mute pressed during a full reconnect once the mic is republished', async () => {
    const call = createCall();

    await call.start(START);
    const room = lastRoom();
    const { localParticipant } = room;
    const publication = localParticipant.microphone;

    if (!publication) throw new Error('no mic');
    localParticipant.microphone = undefined;
    await call.setMuted(true);
    expect(localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();

    localParticipant.microphone = publication;
    room.emit('localTrackPublished', { source: 'microphone' }, localParticipant);
    await flush();

    expect(localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(call.getState().microphone).toBe('muted');
  });

  it('reports an unmute that fails after a republish as an error event, staying muted', async () => {
    const call = createCall();
    const errors: string[] = [];

    call.on('error', error => errors.push(error.code));
    await call.start(START);
    await call.setMuted(true);
    const room = lastRoom();
    const { localParticipant } = room;
    const publication = localParticipant.microphone;

    if (!publication) throw new Error('no mic');
    localParticipant.microphone = undefined;
    await call.setMuted(false);
    localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );
    localParticipant.microphone = publication;
    room.emit('localTrackPublished', { source: 'microphone' }, localParticipant);
    await flush();

    expect(errors).toEqual(['MICROPHONE_DENIED']);
    expect(call.getState().microphone).toBe('muted');
  });

  it('is a no-op after stop()', async () => {
    const call = createCall();

    await call.start(START);
    await call.stop();
    const { localParticipant } = lastRoom();

    localParticipant.setMicrophoneEnabled.mockClear();
    await call.setMuted(true);
    expect(localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('reports a lost mic that no mic can replace as off with MICROPHONE_UNAVAILABLE, keeping the call', async () => {
    const call = createCall();
    const errors: string[] = [];

    call.on('error', error => errors.push(error.code));
    await call.start(START);
    const track = lastRoom().localParticipant.microphone?.track;

    if (!track) throw new Error('no mic');
    behavior.switchDevice = () => Promise.reject(new DOMException('gone', 'NotFoundError'));
    track.mediaStreamTrack.readyState = 'ended';
    track.emit('ended');
    await vi.waitFor(() => expect(errors).toEqual(['MICROPHONE_UNAVAILABLE']));
    expect(call.getState()).toMatchObject({ connection: 'connected', microphone: 'off' });

    track.mediaStreamTrack.readyState = 'live';
    track.emit('restarted');
    expect(call.getState().microphone).toBe('on');
    await call.stop();
    expect(track.listenerCount()).toBe(0);
  });

  it('stops a mic that a muted publish acquires after stop()', async () => {
    const mic = deferred();

    behavior.microphone = () => mic.promise;
    const call = createCall();

    await call.setMuted(true);
    const started = call.start(START);

    await flush();
    await call.stop();
    mic.resolve();
    await started.catch(() => undefined);
    await flush();
    const { microphoneTracks, publishTrack } = lastRoom().localParticipant;

    expect(microphoneTracks[0]?.stop).toHaveBeenCalled();
    expect(publishTrack).not.toHaveBeenCalled();
  });
});

describe('resumeAudio()', () => {
  it('asks LiveKit to start audio and reports playing again', async () => {
    const call = createCall();

    await call.start(START);
    const room = lastRoom();

    room.setPlayback(false);
    expect(call.getState().playback).toBe('blocked');
    room.startAudio.mockImplementationOnce(async () => {
      room.setPlayback(true);
    });
    await call.resumeAudio();
    expect(room.startAudio).toHaveBeenCalledTimes(2);
    expect(call.getState().playback).toBe('playing');
  });

  it('resolves when the browser still blocks audio', async () => {
    const call = createCall();

    await call.start(START);
    const room = lastRoom();

    room.setPlayback(false);
    room.startAudio.mockRejectedValueOnce(new Error('NotAllowedError'));
    await expect(call.resumeAudio()).resolves.toBeUndefined();
    expect(call.getState().playback).toBe('blocked');
  });

  it('is a no-op before start() and after the end', async () => {
    const call = createCall();

    await expect(call.resumeAudio()).resolves.toBeUndefined();
    await call.start(START);
    await call.stop();
    await call.resumeAudio();
    expect(lastRoom().startAudio).toHaveBeenCalledTimes(1);
  });
});

describe('getMicrophoneLevel()', () => {
  it('is 0 before start() and while connecting, without opening an analyser', async () => {
    behavior.agent = 'later';
    const call = createCall();

    expect(call.getMicrophoneLevel()).toBe(0);
    const started = call.start(START);

    expect(call.getMicrophoneLevel()).toBe(0);
    await flush();
    lastRoom().addAgent();
    await started;
    expect(analysers).toHaveLength(0);
  });

  it('reads the open microphone, reusing one analyser', async () => {
    const call = createCall();

    await call.start(START);
    expect(call.getMicrophoneLevel()).toBe(0.5);
    const [analyser] = analysers;

    if (!analyser) throw new Error('no analyser');
    analyser.level = 0.2;
    expect(call.getMicrophoneLevel()).toBe(0.2);
    expect(analysers).toHaveLength(1);
    expect(analysers[0]?.source).toBe(
      lastRoom().localParticipant.microphone?.track.mediaStreamTrack,
    );
  });

  it('is 0 while muted and reads again after unmute', async () => {
    const call = createCall();

    await call.start(START);
    await call.setMuted(true);
    expect(call.getMicrophoneLevel()).toBe(0);
    await call.setMuted(false);
    expect(call.getMicrophoneLevel()).toBe(0.5);
  });

  it('measures the new source after the mic restarts and closes the old analyser', async () => {
    const call = createCall();

    await call.start(START);
    call.getMicrophoneLevel();
    const track = lastRoom().localParticipant.microphone?.track;

    if (!track) throw new Error('no microphone');
    track.mediaStreamTrack = { enabled: true, readyState: 'live' };
    call.getMicrophoneLevel();
    expect(analysers).toHaveLength(2);
    expect(analysers[0]?.cleanup).toHaveBeenCalledOnce();
    expect(analysers[1]?.source).toBe(track.mediaStreamTrack);
  });

  it('is 0 when the browser cannot analyse audio, without retrying every read', async () => {
    const call = createCall();

    vi.mocked(createAudioAnalyser).mockImplementationOnce(() => {
      throw new Error('Audio Context not supported on this browser');
    });
    await call.start(START);
    expect(call.getMicrophoneLevel()).toBe(0);
    expect(call.getMicrophoneLevel()).toBe(0);
    expect(analysers).toHaveLength(0);
  });

  it('is 0 after the end and closes the analyser', async () => {
    const call = createCall();

    await call.start(START);
    call.getMicrophoneLevel();
    await call.stop();
    expect(call.getMicrophoneLevel()).toBe(0);
    expect(analysers).toHaveLength(1);
    expect(analysers[0]?.cleanup).toHaveBeenCalledOnce();
  });
});
