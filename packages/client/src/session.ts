import { WayloVoiceError } from './errors.js';

/** Mirrors `TurnServerResponse` in application packages/api-client/src/types.gen.ts. */
export interface TurnServer {
  credential: string;
  urls: string[];
  username: string;
}

/** Mirrors `WebSessionBootstrapResponse` in application packages/api-client/src/types.gen.ts. */
export interface WebSessionBootstrap {
  expiresAt: string;
  livekitUrl: string;
  participantToken: string;
  roomName: string;
  sessionId: string;
  turn?: TurnServer;
  workspaceId: string;
}

// Browser clocks drift; LiveKit still validates the token.
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTurnServer(value: unknown): value is TurnServer {
  if (typeof value !== 'object' || value === null) return false;
  const turn = value as Record<string, unknown>;

  return (
    Array.isArray(turn.urls) &&
    turn.urls.length > 0 &&
    turn.urls.every(isNonEmptyString) &&
    typeof turn.username === 'string' &&
    typeof turn.credential === 'string'
  );
}

export function isSessionExpired(session: WebSessionBootstrap, now: number = Date.now()): boolean {
  return Date.parse(session.expiresAt) + CLOCK_SKEW_TOLERANCE_MS < now;
}

export function requireSession(value: unknown): WebSessionBootstrap {
  if (typeof value !== 'object' || value === null) {
    throw new WayloVoiceError('INVALID_SESSION');
  }

  const session = value as Record<string, unknown>;
  const isValid =
    isNonEmptyString(session.livekitUrl) &&
    isNonEmptyString(session.participantToken) &&
    isNonEmptyString(session.expiresAt) &&
    !Number.isNaN(Date.parse(session.expiresAt)) &&
    (session.turn === undefined || session.turn === null || isTurnServer(session.turn));

  if (!isValid) {
    throw new WayloVoiceError('INVALID_SESSION');
  }

  return value as WebSessionBootstrap;
}
