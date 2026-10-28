import { supportsAudioOutputSelection } from 'livekit-client';

import { WayloVoiceError } from './errors.js';
import { toMicrophoneError } from './livekit-errors.js';
import type { WayloVoiceDevice, WayloVoiceDevices, WayloVoiceListDevicesOptions } from './state.js';

async function openMicrophoneStream(): Promise<MediaStream> {
  const mediaDevices = globalThis.navigator?.mediaDevices;

  if (!mediaDevices) throw new WayloVoiceError('MICROPHONE_UNAVAILABLE');

  try {
    return await mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw toMicrophoneError(error, []);
  }
}

// Before mic permission, browsers list one unnamed entry per kind, often with an empty id.
function toDevices(devices: readonly MediaDeviceInfo[], kind: MediaDeviceKind): WayloVoiceDevice[] {
  return devices
    .filter(device => device.kind === kind && device.deviceId !== '')
    .map(({ deviceId, label }) => Object.freeze({ deviceId, label }));
}

export async function hasSpeaker(deviceId: string): Promise<boolean> {
  const { speakers } = await listDevices();

  return speakers.some(speaker => speaker.deviceId === deviceId);
}

export async function listDevices(
  options?: WayloVoiceListDevicesOptions,
): Promise<WayloVoiceDevices> {
  const stream = options?.requestPermission === true ? await openMicrophoneStream() : undefined;
  let devices: MediaDeviceInfo[];

  // Firefox names devices only while a microphone is open.
  try {
    devices = (await globalThis.navigator?.mediaDevices?.enumerateDevices()) ?? [];
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }

  const canChooseSpeaker = supportsAudioOutputSelection();

  return Object.freeze({
    canChooseSpeaker,
    microphones: toDevices(devices, 'audioinput'),
    speakers: canChooseSpeaker ? toDevices(devices, 'audiooutput') : [],
  });
}

export function requireDeviceId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RangeError('deviceId must be a non-empty string.');
  }

  return value;
}
