import {
  ConnectionError,
  ConnectionErrorReason,
  DeviceUnsupportedError,
  DisconnectReason,
  MediaDeviceFailure,
} from 'livekit-client';

import { WayloVoiceError } from './errors.js';

const UNAVAILABLE_MICROPHONE_ERRORS = new Set([
  'ConstraintNotSatisfiedError',
  'OverconstrainedError',
]);

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { name } = error as { name?: unknown };

  return typeof name === 'string' ? name : undefined;
}

// A second livekit-client copy in the customer's bundle defeats instanceof; the name and the
// numeric reason survive it.
function isConnectionError(error: unknown): error is ConnectionError {
  return (
    error instanceof ConnectionError ||
    (error instanceof Error &&
      error.name === 'ConnectionError' &&
      typeof (error as { reason?: unknown }).reason === 'number')
  );
}

function toDebugCause(error: ConnectionError): unknown {
  if (error.reason !== ConnectionErrorReason.LeaveRequest || typeof error.context !== 'number') {
    return error;
  }

  return {
    code: error.code,
    disconnectReason: DisconnectReason[error.context],
    message: error.message,
    name: error.name,
    reason: error.reason,
    status: error.status,
  };
}

export function disconnectCause(message: string, reason: DisconnectReason | undefined): Error {
  const cause = new Error(message);

  return reason === undefined
    ? cause
    : Object.assign(cause, { disconnectReason: DisconnectReason[reason] });
}

export function toConnectError(error: unknown, secrets: readonly string[]): WayloVoiceError {
  if (error instanceof WayloVoiceError) return error;
  if (!isConnectionError(error)) return new WayloVoiceError('connection_failed', error, secrets);

  const code =
    error.reason === ConnectionErrorReason.NotAllowed ? 'session_expired' : 'connection_failed';

  return new WayloVoiceError(code, toDebugCause(error), secrets);
}

export function toMicrophoneError(error: unknown, secrets: readonly string[]): WayloVoiceError {
  const name = errorName(error);

  if (name === undefined) return new WayloVoiceError('connection_failed', error, secrets);

  switch (MediaDeviceFailure.getFailure(error)) {
    case MediaDeviceFailure.PermissionDenied:
      return new WayloVoiceError('microphone_denied', error, secrets);
    case MediaDeviceFailure.NotFound:
    case MediaDeviceFailure.DeviceInUse:
      return new WayloVoiceError('microphone_unavailable', error, secrets);
  }

  if (error instanceof DeviceUnsupportedError || UNAVAILABLE_MICROPHONE_ERRORS.has(name)) {
    return new WayloVoiceError('microphone_unavailable', error, secrets);
  }

  return new WayloVoiceError('connection_failed', error, secrets);
}

export function toWayloVoiceError(error: unknown, secrets: readonly string[]): WayloVoiceError {
  return error instanceof WayloVoiceError
    ? error
    : new WayloVoiceError('connection_failed', error, secrets);
}
