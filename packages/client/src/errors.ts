export const WAYLO_VOICE_ERROR_CODES = [
  /** The agent left the room unexpectedly while the call was active. */
  'agent_left',
  /** The agent did not join the room within `agentTimeoutMs`. */
  'agent_timeout',
  /** `start()` was called on a `WayloVoice` that was already used. */
  'already_started',
  /** `stop()` was called before `start()` finished. */
  'cancelled',
  /** The call could not connect, or it dropped after connecting. */
  'connection_failed',
  /** The session passed to `start()` is not a valid `WebSessionBootstrap`. */
  'invalid_session',
  /** The caller or the browser refused microphone access. */
  'microphone_denied',
  /** No microphone exists, it is busy, or it cannot meet the constraints. */
  'microphone_unavailable',
  /** The session expired or LiveKit rejected its token; fetch a new one. */
  'session_expired',
] as const;

/** Why a call failed. Stable strings, safe to branch on. */
export type WayloVoiceErrorCode = (typeof WAYLO_VOICE_ERROR_CODES)[number];

const MESSAGES: Record<WayloVoiceErrorCode, string> = {
  agent_left: 'The assistant left the call.',
  agent_timeout: 'The agent did not join in time.',
  already_started: 'This call has already been used; create a new WayloVoice for a new call.',
  cancelled: 'The call was stopped before it finished starting.',
  connection_failed: 'Could not connect the call.',
  invalid_session: 'The session passed to start() is missing required fields.',
  microphone_denied: 'Microphone access was denied.',
  microphone_unavailable: 'No usable microphone was found.',
  session_expired: 'The session has expired or was rejected; fetch a new one.',
};

const REDACTED = '[redacted]';
const JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const TOKEN_PARAM_PATTERN = /(access_token=)[^\s&"']+/gi;

interface SanitizedCause extends Error {
  code?: number | string;
  disconnectReason?: string;
  reason?: number | string;
  status?: number;
}

/**
 * The only error the SDK rejects with. `code` is stable; `message` is fixed per code. `cause`
 * keeps the low-level name, message, codes, HTTP status and LiveKit disconnect reason for
 * debugging, with tokens and TURN credentials redacted.
 */
export class WayloVoiceError extends Error {
  override readonly name = 'WayloVoiceError';
  readonly code: WayloVoiceErrorCode;

  constructor(code: WayloVoiceErrorCode, cause?: unknown, secrets: readonly string[] = []) {
    super(
      MESSAGES[code],
      cause === undefined ? undefined : { cause: sanitizeCause(cause, secrets) },
    );
    this.code = code;
  }
}

function causeMessage(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return String(cause);
  const { message } = cause as { message?: unknown };

  return typeof message === 'string' ? message : '';
}

function redact(text: string, secrets: readonly string[]): string {
  let safe = text;

  for (const secret of secrets) {
    if (secret) safe = safe.replaceAll(secret, REDACTED);
  }

  return safe.replaceAll(JWT_PATTERN, REDACTED).replaceAll(TOKEN_PARAM_PATTERN, `$1${REDACTED}`);
}

function redactProperty(value: unknown, secrets: readonly string[]): number | string | undefined {
  if (typeof value === 'number') return value;

  return typeof value === 'string' ? redact(value, secrets) : undefined;
}

function sanitizeCause(cause: unknown, secrets: readonly string[]): SanitizedCause {
  const source = (typeof cause === 'object' && cause !== null ? cause : {}) as Partial<
    Record<string, unknown>
  >;
  const sanitized: SanitizedCause = new Error(redact(causeMessage(cause), secrets));
  const code = redactProperty(source.code, secrets);
  const reason = redactProperty(source.reason, secrets);

  sanitized.name = typeof source.name === 'string' ? source.name : 'Error';
  if (code !== undefined) sanitized.code = code;
  if (reason !== undefined) sanitized.reason = reason;
  if (typeof source.status === 'number') sanitized.status = source.status;

  if (typeof source.disconnectReason === 'string') {
    sanitized.disconnectReason = redact(source.disconnectReason, secrets);
  }

  return sanitized;
}
