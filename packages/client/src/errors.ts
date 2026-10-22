export const WAYLO_VOICE_ERROR_CODES = [
  'ACCESS_DENIED',
  'AGENT_LEFT',
  'AGENT_TIMEOUT',
  'ALREADY_STARTED',
  'AUTH_REQUIRED',
  'CANCELLED',
  'CONNECTION_FAILED',
  'INVALID_SESSION',
  'LIMIT_REACHED',
  'MICROPHONE_DENIED',
  'MICROPHONE_UNAVAILABLE',
  'SESSION_EXPIRED',
] as const;

/** Why a call failed. Stable strings, safe to branch on. */
export type WayloVoiceErrorCode = (typeof WAYLO_VOICE_ERROR_CODES)[number];

const MESSAGES: Record<WayloVoiceErrorCode, string> = {
  ACCESS_DENIED: 'The session endpoint denied access to this agent.',
  AGENT_LEFT: 'The assistant left the call.',
  AGENT_TIMEOUT: 'The agent did not join in time.',
  ALREADY_STARTED: 'This call has already been used; create a new WayloVoice for a new call.',
  AUTH_REQUIRED: 'The session endpoint requires a signed-in user.',
  CANCELLED: 'The call was stopped before it finished starting.',
  CONNECTION_FAILED: 'Could not connect the call.',
  INVALID_SESSION: 'The session endpoint returned an invalid session.',
  LIMIT_REACHED: 'Too many calls were started; try again later.',
  MICROPHONE_DENIED: 'Microphone access was denied.',
  MICROPHONE_UNAVAILABLE: 'No usable microphone was found.',
  SESSION_EXPIRED: 'The session has expired or was rejected; start a new call.',
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

/** The only error the SDK rejects with. `code` is stable; `cause` holds redacted low-level details. */
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
