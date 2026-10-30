import { describe, expect, it, vi } from 'vitest';

import { activeCall, record } from '../__setup__/active-call.js';
import { errorCodeFrom } from '../__setup__/errors.js';
import { type FakeLocalTrack, mediaDevice, stubMediaDevices } from '../__setup__/fake-media.js';
import { behavior, deferred, flush, lastRoom } from '../__setup__/fake-room.js';
import { createCall, START } from '../__setup__/fake-session-endpoint.js';

async function devicesChange(room: ReturnType<typeof lastRoom>, devices: MediaDeviceInfo[]) {
  stubMediaDevices(devices);
  room.emit('mediaDevicesChanged');
  await vi.waitFor(() => expect(room.switchActiveDevice.mock.results.length).toBeGreaterThan(0));
  await flush();
}

function failBusy(_kind: MediaDeviceKind, deviceId: string): Promise<void> {
  return deviceId === 'busy' ? inUse() : Promise.resolve();
}

function inUse(): Promise<never> {
  return Promise.reject(new DOMException('Could not start audio source', 'NotReadableError'));
}

function sinkIds(): string[] {
  return [...document.querySelectorAll('audio')].map(element => element.sinkId);
}

function unplug(track: FakeLocalTrack, devices: MediaDeviceInfo[]): void {
  stubMediaDevices(devices);
  Object.assign(track.mediaStreamTrack, { readyState: 'ended' });
  track.emit('ended');
}

describe('choosing devices before start()', () => {
  it('opens exactly the chosen microphone and applies the chosen speaker', async () => {
    stubMediaDevices([mediaDevice('audiooutput', 'headphones')]);
    const call = createCall();

    await call.setMicrophoneDevice('usb-mic');
    await call.setSpeakerDevice('headphones');
    await call.start(START);
    const room = lastRoom();

    expect(room.localParticipant.createTracks).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'usb-mic' } },
    });
    expect(room.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'headphones');
    expect(call.getState()).toMatchObject({
      microphoneDeviceId: 'usb-mic',
      speakerDeviceId: 'headphones',
    });
  });

  it('uses the browser defaults when nothing is chosen', async () => {
    const call = createCall();

    await call.start(START);

    expect(lastRoom().localParticipant.createTracks).toHaveBeenCalledWith({ audio: true });
    expect(lastRoom().switchActiveDevice).not.toHaveBeenCalled();
    expect(call.getState()).toMatchObject({ microphoneDeviceId: 'default' });
    expect(call.getState().speakerDeviceId).toBeUndefined();
  });

  it('falls back to the default speaker when the chosen one is gone, like the mic', async () => {
    stubMediaDevices([mediaDevice('audiooutput', 'built-in')]);
    const call = createCall();
    const { errors } = record(call);

    await call.setSpeakerDevice('headphones');
    await call.start(START);

    expect(errors).toEqual([]);
    expect(lastRoom().switchActiveDevice).not.toHaveBeenCalled();
    expect(call.getState().speakerDeviceId).toBe('default');
  });

  it('falls back to the default mic when the chosen one is gone by then', async () => {
    behavior.microphone = deviceId =>
      deviceId === 'usb-mic'
        ? Promise.reject(new DOMException('Requested device not found', 'OverconstrainedError'))
        : Promise.resolve();
    const call = createCall();

    await call.setMicrophoneDevice('usb-mic');
    await call.start(START);

    expect(lastRoom().localParticipant.createTracks).toHaveBeenLastCalledWith({ audio: true });
    expect(call.getState()).toMatchObject({ microphone: 'on', microphoneDeviceId: 'default' });
  });

  it('fails the start when the chosen mic is busy', async () => {
    behavior.microphone = () =>
      Promise.reject(new DOMException('Could not start audio source', 'NotReadableError'));
    const call = createCall();

    await call.setMicrophoneDevice('usb-mic');

    await expect(errorCodeFrom(call.start(START))).resolves.toBe('MICROPHONE_IN_USE');
  });

  it('switches to a mic chosen while the call connects', async () => {
    const connecting = deferred();

    behavior.connect = () => connecting.promise;
    const call = createCall();
    const started = call.start(START);

    await flush();
    await call.setMicrophoneDevice('usb-mic');
    connecting.resolve();
    await started;

    expect(lastRoom().switchActiveDevice).toHaveBeenCalledWith('audioinput', 'usb-mic');
    expect(call.getState().microphoneDeviceId).toBe('usb-mic');
  });

  it('switches to a mic chosen while the visitor answers the permission prompt', async () => {
    const prompt = deferred();

    behavior.microphone = () => prompt.promise;
    const call = createCall();
    const started = call.start(START);

    await flush();
    await call.setMicrophoneDevice('usb-mic');
    prompt.resolve();
    await started;

    expect(lastRoom().switchActiveDevice).toHaveBeenCalledWith('audioinput', 'usb-mic');
    expect(call.getState().microphoneDeviceId).toBe('usb-mic');
  });
  it('keeps the call going and reports it when the mic chosen during the prompt fails', async () => {
    const prompt = deferred();

    behavior.microphone = () => prompt.promise;
    behavior.switchDevice = failBusy;
    const call = createCall();
    const { errors } = record(call);
    const started = call.start(START);

    await flush();
    await call.setMicrophoneDevice('busy');
    prompt.resolve();
    await started;

    expect(errors.map(error => error.code)).toEqual(['MICROPHONE_IN_USE']);
    expect(lastRoom().switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'default');
    expect(call.getState()).toMatchObject({ connection: 'connected', microphone: 'on' });
  });
});

describe('switching devices mid-call', () => {
  it('switches the microphone', async () => {
    const { call, room } = await activeCall();

    await call.setMicrophoneDevice('usb-mic');

    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'usb-mic');
    expect(call.getState()).toMatchObject({ microphone: 'on', microphoneDeviceId: 'usb-mic' });
  });

  it('switches the speaker', async () => {
    stubMediaDevices([mediaDevice('audiooutput', 'headphones')]);
    const { call, room } = await activeCall();

    await call.setSpeakerDevice('headphones');

    expect(room.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'headphones');
    expect(call.getState().speakerDeviceId).toBe('headphones');
  });

  it('rejects a mic that is gone and goes back to the previous one', async () => {
    const { call, room } = await activeCall();

    behavior.switchDevice = (_kind, deviceId) =>
      deviceId === 'gone'
        ? Promise.reject(new DOMException('Requested device not found', 'OverconstrainedError'))
        : Promise.resolve();

    await expect(errorCodeFrom(call.setMicrophoneDevice('gone'))).resolves.toBe(
      'MICROPHONE_UNAVAILABLE',
    );
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'default');
    expect(call.getState().microphone).toBe('on');
  });

  it('goes back to the previous mic when the new one cannot be opened', async () => {
    const { call, room } = await activeCall();

    await call.setMicrophoneDevice('usb-mic');
    behavior.switchDevice = failBusy;

    await expect(errorCodeFrom(call.setMicrophoneDevice('busy'))).resolves.toBe(
      'MICROPHONE_IN_USE',
    );
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'usb-mic');
    expect(call.getState()).toMatchObject({ microphone: 'on', microphoneDeviceId: 'usb-mic' });
  });

  it("goes back to the browser's default mic when none was chosen", async () => {
    const { call, room } = await activeCall();

    behavior.switchDevice = failBusy;

    await expect(call.setMicrophoneDevice('busy')).rejects.toThrow();
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'default');
    expect(call.getState().microphone).toBe('on');
  });

  it('shows the mic off when no mic can be opened again', async () => {
    const { call } = await activeCall();

    behavior.switchDevice = inUse;

    await expect(call.setMicrophoneDevice('busy')).rejects.toThrow();
    expect(call.getState().microphone).toBe('off');
  });

  it('reports a denied mic as MICROPHONE_DENIED', async () => {
    const { call } = await activeCall();

    behavior.switchDevice = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));

    await expect(errorCodeFrom(call.setMicrophoneDevice('usb-mic'))).resolves.toBe(
      'MICROPHONE_DENIED',
    );
  });

  it('runs changes one at a time, so a failed one never undoes a later one', async () => {
    const { call, room } = await activeCall();
    const busy = deferred();

    behavior.switchDevice = (_kind, deviceId) =>
      deviceId === 'busy' ? busy.promise.then(inUse) : Promise.resolve();

    const first = call.setMicrophoneDevice('busy').catch(() => undefined);
    const second = call.setMicrophoneDevice('usb-mic');

    busy.resolve();
    await Promise.all([first, second]);

    expect(room.switchActiveDevice.mock.calls.map(([, deviceId]) => deviceId)).toEqual([
      'busy',
      'default',
      'usb-mic',
    ]);
    expect(call.getState().microphoneDeviceId).toBe('usb-mic');
  });

  it('reopens an unplugged mic on the system default by itself', async () => {
    stubMediaDevices([mediaDevice('audioinput', 'usb-mic')]);
    const { call, errors, room } = await activeCall();
    const track = room.localParticipant.microphone?.track;

    if (!track) throw new Error('no mic');
    await call.setMicrophoneDevice('usb-mic');
    stubMediaDevices([mediaDevice('audioinput', 'default'), mediaDevice('audioinput', 'built-in')]);
    track.mediaStreamTrack.readyState = 'ended';
    track.emit('ended');
    expect(call.getState().microphone).toBe('off');

    await vi.waitFor(() => expect(call.getState().microphone).toBe('on'));
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'default');
    expect(call.getState().microphoneDeviceId).toBe('default');
    expect(errors).toEqual([]);
  });

  it('keeps an unplugged muted mic muted and opens the system default on unmute', async () => {
    stubMediaDevices([mediaDevice('audioinput', 'usb-mic')]);
    const { call, errors, room } = await activeCall();
    const track = room.localParticipant.microphone?.track;

    if (!track) throw new Error('no mic');
    await call.setMicrophoneDevice('usb-mic');
    await call.setMuted(true);
    unplug(track, [mediaDevice('audioinput', 'default'), mediaDevice('audioinput', 'built-in')]);
    expect(call.getState().microphone).toBe('muted');

    await vi.waitFor(() => expect(call.getState().microphoneDeviceId).toBe('default'));
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'default');
    expect(call.getState().microphone).toBe('muted');
    expect(errors).toEqual([]);

    await call.setMuted(false);

    expect(track.deviceId).toBe('default');
    expect(call.getState().microphone).toBe('on');
  });

  it.each([
    ['muted', true],
    ['unmuted', false],
  ])(
    'shows the mic off and reports MICROPHONE_UNAVAILABLE once when the %s mic was the last one',
    async (_, muted) => {
      const { call, errors, room } = await activeCall();
      const track = room.localParticipant.microphone?.track;

      if (!track) throw new Error('no mic');
      await call.setMuted(muted);
      // Like LiveKit: an unmuted mic it can't restart is muted instead.
      await track.mute();
      unplug(track, [mediaDevice('audiooutput', 'default')]);
      room.emit('mediaDevicesChanged');

      await vi.waitFor(() => expect(errors).toHaveLength(1));
      await flush();
      expect(errors.map(error => error.code)).toEqual(['MICROPHONE_UNAVAILABLE']);
      expect(call.getState().microphone).toBe('off');
      expect(room.switchActiveDevice).not.toHaveBeenCalled();
    },
  );

  it('rejects a speaker that is not there with SPEAKER_UNAVAILABLE', async () => {
    const { call, room } = await activeCall();

    await expect(errorCodeFrom(call.setSpeakerDevice('gone'))).resolves.toBe('SPEAKER_UNAVAILABLE');
    expect(room.switchActiveDevice).not.toHaveBeenCalledWith('audiooutput', 'gone');
  });

  it('rejects a speaker the browser cannot switch to with SPEAKER_UNAVAILABLE', async () => {
    stubMediaDevices([mediaDevice('audiooutput', 'headphones')]);
    const { call } = await activeCall();

    behavior.switchDevice = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));

    await expect(errorCodeFrom(call.setSpeakerDevice('headphones'))).resolves.toBe(
      'SPEAKER_UNAVAILABLE',
    );
  });

  it('goes back to the previous mic when an unmute cannot open a mic chosen while muted', async () => {
    const { call, room } = await activeCall();

    await call.setMuted(true);
    await call.setMicrophoneDevice('usb-mic');
    room.localParticipant.setMicrophoneEnabled.mockImplementationOnce(async () => {
      const track = room.localParticipant.microphone?.track;

      if (track) track.mediaStreamTrack.readyState = 'ended';
      throw new DOMException('Could not start audio source', 'NotReadableError');
    });

    await expect(errorCodeFrom(call.setMuted(false))).resolves.toBe('MICROPHONE_IN_USE');
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'default');

    await call.setMuted(false);

    expect(call.getState().microphone).toBe('on');
  });

  it('does not reopen a mic after stop()', async () => {
    const { call, room } = await activeCall();
    const busy = deferred();

    behavior.switchDevice = () => busy.promise.then(inUse);
    const switching = call.setMicrophoneDevice('busy').catch(() => undefined);

    await flush();
    const stopped = call.stop();

    busy.resolve();
    await Promise.all([switching, stopped]);

    expect(room.switchActiveDevice).toHaveBeenCalledTimes(1);
  });

  it("follows LiveKit's own switch, e.g. after the mic restarts on another device", async () => {
    const { call, room } = await activeCall();

    room.activeDevices.set('audioinput', 'built-in');
    room.emit('activeDeviceChanged', 'audioinput', 'built-in');

    expect(call.getState().microphoneDeviceId).toBe('built-in');
  });

  it("ignores the device LiveKit names when the OS default changes but it stays on 'default'", async () => {
    const { call, room } = await activeCall();

    await call.setMicrophoneDevice('default');
    room.emit('activeDeviceChanged', 'audioinput', 'communications');

    expect(call.getState().microphoneDeviceId).toBe('default');
  });
});

describe('device setters', () => {
  it('reject SPEAKER_UNAVAILABLE where the browser cannot choose a speaker', async () => {
    behavior.canChooseSpeaker = false;
    const call = createCall();

    await expect(errorCodeFrom(call.setSpeakerDevice('headphones'))).resolves.toBe(
      'SPEAKER_UNAVAILABLE',
    );
    expect(call.getState().speakerDeviceId).toBeUndefined();
  });

  it('reject an empty device id with a RangeError', async () => {
    const call = createCall();

    await expect(call.setMicrophoneDevice('')).rejects.toThrow(RangeError);
    await expect(call.setSpeakerDevice('')).rejects.toThrow(RangeError);
  });

  it('do nothing after the call ended', async () => {
    const { call, room } = await activeCall();

    await call.stop();
    room.switchActiveDevice.mockClear();
    await call.setMicrophoneDevice('usb-mic');
    await call.setSpeakerDevice('headphones');

    expect(room.switchActiveDevice).not.toHaveBeenCalled();
    expect(call.getState().microphoneDeviceId).toBe('default');
  });
});

describe('following devices', () => {
  const builtIn = [
    mediaDevice('audioinput', 'default', 'Default - Built-in mic', 'built-in'),
    mediaDevice('audioinput', 'built-in-mic', 'Built-in mic', 'built-in'),
    mediaDevice('audiooutput', 'default', 'Default - Built-in speakers', 'built-in'),
    mediaDevice('audiooutput', 'built-in-speakers', 'Built-in speakers', 'built-in'),
  ];
  const headset = [
    mediaDevice('audioinput', 'headset-mic', 'Headset', 'headset'),
    mediaDevice('audiooutput', 'headset-speakers', 'Headset', 'headset'),
  ];

  it('falls back to the system default when a chosen mic and speaker are gone', async () => {
    stubMediaDevices([...builtIn, ...headset]);
    const { call, errors, room } = await activeCall();

    await call.setMicrophoneDevice('headset-mic');
    await call.setSpeakerDevice('headset-speakers');
    room.switchActiveDevice.mockClear();
    await devicesChange(room, builtIn);

    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default');
    expect(room.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'default');
    expect(call.getState()).toMatchObject({
      microphone: 'on',
      microphoneDeviceId: 'default',
      speakerDeviceId: 'default',
    });
    expect(errors).toEqual([]);
  });

  it('keeps a chosen mic and speaker that are still there', async () => {
    stubMediaDevices([...builtIn, ...headset]);
    const { call, room } = await activeCall();

    await call.setMicrophoneDevice('headset-mic');
    await call.setSpeakerDevice('headset-speakers');
    room.activeDevices.set('audioinput', 'built-in-mic');
    room.activeDevices.set('audiooutput', 'default');
    room.switchActiveDevice.mockClear();
    await devicesChange(room, [...headset, ...builtIn]);

    expect(room.switchActiveDevice.mock.calls).toEqual([
      ['audiooutput', 'headset-speakers'],
      ['audioinput', 'headset-mic'],
    ]);
    expect(call.getState()).toMatchObject({
      microphoneDeviceId: 'headset-mic',
      speakerDeviceId: 'headset-speakers',
    });
  });

  it('moves a mic and speaker on the default to the new system default', async () => {
    stubMediaDevices([...builtIn, ...headset]);
    const setSinkId = vi.fn(function (this: HTMLMediaElement, sinkId: string) {
      Object.defineProperty(this, 'sinkId', { configurable: true, value: sinkId });

      return Promise.resolve();
    });

    Object.assign(HTMLMediaElement.prototype, { setSinkId });

    try {
      const { call, room } = await activeCall();

      room.switchActiveDevice.mockClear();
      await devicesChange(room, [
        mediaDevice('audioinput', 'default', 'Default - Headset', 'headset'),
        mediaDevice('audiooutput', 'default', 'Default - Headset', 'headset'),
        ...headset,
        ...builtIn.filter(device => device.deviceId !== 'default'),
      ]);

      expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default');
      expect(sinkIds()).toEqual(['headset-speakers']);
      expect(call.getState()).toMatchObject({ microphone: 'on', microphoneDeviceId: 'default' });
    } finally {
      Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
    }
  });

  it('leaves a chosen speaker alone when the system default moves', async () => {
    stubMediaDevices([...builtIn, ...headset]);
    const { call, room } = await activeCall();

    await call.setSpeakerDevice('built-in-speakers');
    await call.setMicrophoneDevice('built-in-mic');
    room.switchActiveDevice.mockClear();
    stubMediaDevices([
      mediaDevice('audioinput', 'default', 'Default - Headset', 'headset'),
      mediaDevice('audiooutput', 'default', 'Default - Headset', 'headset'),
      ...headset,
      ...builtIn.filter(device => device.deviceId !== 'default'),
    ]);
    room.emit('mediaDevicesChanged');
    await flush();
    await flush();

    expect(room.switchActiveDevice).not.toHaveBeenCalled();
    expect(call.getState()).toMatchObject({
      microphoneDeviceId: 'built-in-mic',
      speakerDeviceId: 'built-in-speakers',
    });
  });
});

describe("following devices where the browser lists no 'default' entry", () => {
  const builtIn = [
    mediaDevice('audioinput', 'built-in-mic', 'Built-in mic', 'built-in'),
    mediaDevice('audiooutput', 'built-in-speakers', 'Built-in speakers', 'built-in'),
  ];
  const headset = [
    mediaDevice('audioinput', 'headset-mic', 'Headset', 'headset'),
    mediaDevice('audiooutput', 'headset-speakers', 'Headset', 'headset'),
  ];

  async function firefoxCall(active: { mic: string; speaker: string }) {
    behavior.switchDevice = (_kind, deviceId, exact) =>
      exact && deviceId === 'default'
        ? Promise.reject(new DOMException('', 'OverconstrainedError'))
        : Promise.resolve();
    stubMediaDevices([...builtIn, ...headset]);
    const started = await activeCall();

    started.room.activeDevices.set('audioinput', active.mic);
    started.room.activeDevices.set('audiooutput', active.speaker);

    return started;
  }

  it('keeps the open mic and speaker while they are still there', async () => {
    const { call, errors, room } = await firefoxCall({
      mic: 'built-in-mic',
      speaker: 'built-in-speakers',
    });

    stubMediaDevices([...headset, ...builtIn]);
    room.emit('mediaDevicesChanged');
    await flush();
    await flush();

    expect(room.switchActiveDevice).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(call.getState().microphone).toBe('on');
  });

  it("reopens a gone mic on the browser's default without asking for 'default' exactly", async () => {
    const { call, errors, room } = await firefoxCall({
      mic: 'headset-mic',
      speaker: 'headset-speakers',
    });

    await devicesChange(room, builtIn);

    expect(room.switchActiveDevice.mock.calls).toEqual([['audioinput', 'default', false]]);
    expect(errors).toEqual([]);
    expect(call.getState()).toMatchObject({ microphone: 'on', microphoneDeviceId: 'default' });
  });

  it("opens the browser's default mic when 'default' is chosen", async () => {
    const { call, room } = await firefoxCall({ mic: 'headset-mic', speaker: 'headset-speakers' });

    await call.setMicrophoneDevice('default');

    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'default', false);
    expect(call.getState()).toMatchObject({ microphone: 'on', microphoneDeviceId: 'default' });
  });
});
