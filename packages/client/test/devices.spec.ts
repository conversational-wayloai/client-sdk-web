import { describe, expect, it, vi } from 'vitest';

import { hasSpeaker, listDevices, requireDeviceId } from '../src/devices.js';

import { wayloVoiceErrorFrom } from './__setup__/errors.js';
import { createMediaStream, mediaDevice, stubMediaDevices } from './__setup__/fake-media.js';
import { behavior } from './__setup__/fake-room.js';

describe('listDevices()', () => {
  it('lists microphones and speakers with their ids and labels', async () => {
    stubMediaDevices([
      mediaDevice('audioinput', 'default', 'Default - Built-in Microphone'),
      mediaDevice('audioinput', 'usb-mic', 'USB Microphone'),
      mediaDevice('videoinput', 'camera', 'Camera'),
      mediaDevice('audiooutput', 'headphones', 'Headphones'),
    ]);

    await expect(listDevices()).resolves.toEqual({
      canChooseSpeaker: true,
      microphones: [
        { deviceId: 'default', label: 'Default - Built-in Microphone' },
        { deviceId: 'usb-mic', label: 'USB Microphone' },
      ],
      speakers: [{ deviceId: 'headphones', label: 'Headphones' }],
    });
  });

  it('leaves out the unnamed placeholders a browser lists before mic permission', async () => {
    stubMediaDevices([mediaDevice('audioinput', ''), mediaDevice('audiooutput', '')]);

    await expect(listDevices()).resolves.toMatchObject({ microphones: [], speakers: [] });
  });

  it('lists no speakers where the browser cannot choose one', async () => {
    behavior.canChooseSpeaker = false;
    stubMediaDevices([
      mediaDevice('audioinput', 'mic', 'Mic'),
      mediaDevice('audiooutput', 'speaker', 'Speaker'),
    ]);

    await expect(listDevices()).resolves.toEqual({
      canChooseSpeaker: false,
      microphones: [{ deviceId: 'mic', label: 'Mic' }],
      speakers: [],
    });
  });

  it('lists nothing without media devices, e.g. on plain http', async () => {
    await expect(listDevices()).resolves.toMatchObject({ microphones: [], speakers: [] });
  });
});

describe('listDevices({ requestPermission })', () => {
  it('does not ask for the microphone by default', async () => {
    const getUserMedia = vi.fn(() => Promise.resolve(createMediaStream()));

    stubMediaDevices([mediaDevice('audioinput', '')], getUserMedia);

    await listDevices();
    await listDevices({ requestPermission: false });

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('asks for the microphone once, stops what it opened and lists named devices', async () => {
    const devices = [mediaDevice('audioinput', ''), mediaDevice('audiooutput', '')];
    const stream = createMediaStream();
    const getUserMedia = vi.fn(() => {
      devices.splice(
        0,
        devices.length,
        mediaDevice('audioinput', 'usb-mic', 'USB Microphone'),
        mediaDevice('audiooutput', 'headphones', 'Headphones'),
      );

      return Promise.resolve(stream);
    });

    stubMediaDevices(devices, getUserMedia);

    await expect(listDevices({ requestPermission: true })).resolves.toEqual({
      canChooseSpeaker: true,
      microphones: [{ deviceId: 'usb-mic', label: 'USB Microphone' }],
      speakers: [{ deviceId: 'headphones', label: 'Headphones' }],
    });
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it('lists before it stops the microphone, as Firefox names devices only while one is open', async () => {
    const stream = createMediaStream();

    stubMediaDevices([], () => Promise.resolve(stream));
    const enumerateDevices = vi.spyOn(navigator.mediaDevices, 'enumerateDevices');
    const listedFirst: boolean[] = [];

    for (const track of stream.tracks) {
      track.stop.mockImplementation(() => listedFirst.push(enumerateDevices.mock.calls.length > 0));
    }

    await listDevices({ requestPermission: true });

    expect(listedFirst).toEqual([true, true]);
  });

  it.each([
    ['NotAllowedError', 'MICROPHONE_DENIED'],
    ['NotFoundError', 'MICROPHONE_UNAVAILABLE'],
  ])('rejects a %s with %s', async (name, code) => {
    stubMediaDevices([], () => Promise.reject(new DOMException('mic', name)));
    const error = await wayloVoiceErrorFrom(listDevices({ requestPermission: true }));

    expect(error.code).toBe(code);
    expect(error.cause).toMatchObject({ name });
  });

  it('rejects with MICROPHONE_UNAVAILABLE without media devices, e.g. on plain http', async () => {
    const error = await wayloVoiceErrorFrom(listDevices({ requestPermission: true }));

    expect(error.code).toBe('MICROPHONE_UNAVAILABLE');
  });
});

describe('hasSpeaker()', () => {
  it('finds a listed speaker only', async () => {
    stubMediaDevices([mediaDevice('audiooutput', 'headphones', 'Headphones')]);

    await expect(hasSpeaker('headphones')).resolves.toBe(true);
    await expect(hasSpeaker('gone')).resolves.toBe(false);
  });
});

describe('requireDeviceId()', () => {
  it.each([undefined, 42, '', '  '])('rejects %j', value => {
    expect(() => requireDeviceId(value)).toThrow(RangeError);
  });
});
