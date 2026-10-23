import { abortable } from './abortable.js';
import { WayloVoiceError, type WayloVoiceErrorCode } from './errors.js';
import { requireSession, type WebSessionBootstrap } from './session.js';

export type SessionHeaders = () => Record<string, string> | Promise<Record<string, string>>;

export interface SessionRequest {
  agentId: string;
  metadata?: Record<string, unknown>;
}

const SESSION_REQUEST_TIMEOUT_MS = 15_000;

const STATUS_ERROR_CODES: ReadonlyMap<number, WayloVoiceErrorCode> = new Map([
  [401, 'AUTH_REQUIRED'],
  [403, 'ACCESS_DENIED'],
  [429, 'LIMIT_REACHED'],
]);

async function postSession(
  endpoint: string,
  { agentId, metadata }: SessionRequest,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<WebSessionBootstrap> {
  const secrets = Object.values(headers);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      body: JSON.stringify({ agentId, metadata }),
      credentials: 'same-origin',
      headers: { ...headers, 'Content-Type': 'application/json' },
      method: 'POST',
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    throw new WayloVoiceError('CONNECTION_FAILED', error, secrets);
  }

  if (response.type === 'opaqueredirect') {
    throw new WayloVoiceError(
      'AUTH_REQUIRED',
      new Error('Session endpoint redirected; answer 401 instead of redirecting to a login page.'),
    );
  }

  if (!response.ok) throw toStatusError(response.status);

  // The parse error can quote the body, which may hold the token; it is left out of the cause.
  const body: unknown = await response.json().catch(() => {
    throw new WayloVoiceError('INVALID_SESSION');
  });

  return requireSession(body);
}

// headers() errors can quote a token; keep only a fixed message.
async function resolveHeaders(
  getHeaders: SessionHeaders | undefined,
): Promise<Record<string, string>> {
  try {
    return (await getHeaders?.()) ?? {};
  } catch {
    throw new WayloVoiceError('CONNECTION_FAILED', new Error('The headers() function failed.'));
  }
}

function timeoutError(): WayloVoiceError {
  return new WayloVoiceError(
    'CONNECTION_FAILED',
    new Error(`Session endpoint did not answer within ${SESSION_REQUEST_TIMEOUT_MS / 1000} s.`),
  );
}

function toStatusError(status: number): WayloVoiceError {
  const cause = Object.assign(new Error(`Session endpoint answered HTTP ${status}.`), { status });

  return new WayloVoiceError(STATUS_ERROR_CODES.get(status) ?? 'CONNECTION_FAILED', cause);
}

// One request, no retry and no Idempotency-Key: retrying POST /sessions/web is the backend's job.
export async function fetchSession(
  endpoint: string,
  request: SessionRequest,
  getHeaders: SessionHeaders | undefined,
  signal: AbortSignal,
): Promise<WebSessionBootstrap> {
  const headers = await resolveHeaders(getHeaders);

  signal.throwIfAborted();
  const deadline = new AbortController();
  const onAbort = () => deadline.abort(signal.reason);
  const timer = setTimeout(() => deadline.abort(timeoutError()), SESSION_REQUEST_TIMEOUT_MS);

  signal.addEventListener('abort', onAbort, { once: true });

  try {
    return await abortable(
      postSession(endpoint, request, headers, deadline.signal),
      deadline.signal,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
