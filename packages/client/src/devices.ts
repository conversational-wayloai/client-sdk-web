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

export const DEFAULT_DEVICE_ID = 'default';

export async function enumerateMediaDevices(): Promise<MediaDeviceInfo[]> {
  return (await globalThis.navigator?.mediaDevices?.enumerateDevices().catch(() => [])) ?? [];
}

// Chrome lists the system default as 'default', sharing its group with the real device.
export function findDefaultDevice(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceKind,
): MediaDeviceInfo | undefined {
  const entry = devices.find(
    device => device.kind === kind && device.deviceId === DEFAULT_DEVICE_ID,
  );

  return devices.find(
    device =>
      device.kind === kind &&
      device.deviceId !== DEFAULT_DEVICE_ID &&
      device.groupId === entry?.groupId,
  );
}

export async function hasSpeaker(deviceId: string): Promise<boolean> {
  const { speakers } = await listDevices();

  return speakers.some(speaker => speaker.deviceId === deviceId);
}

// Firefox and Safari have no 'default' entry; asking for no device opens the system default.
export function isDefaultUnlisted(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceKind,
): boolean {
  const ofKind = devices.filter(device => device.kind === kind);

  return ofKind.length > 0 && !ofKind.some(device => device.deviceId === DEFAULT_DEVICE_ID);
}

// An empty list (no permission yet, or no API) can't tell that a device is gone.
export function isDeviceGone(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceKind,
  deviceId: string | undefined,
): boolean {
  const ofKind = devices.filter(device => device.kind === kind);

  return (
    deviceId !== undefined &&
    deviceId !== DEFAULT_DEVICE_ID &&
    ofKind.length > 0 &&
    !ofKind.some(device => device.deviceId === deviceId)
  );
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
