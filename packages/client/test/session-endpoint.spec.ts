import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSession } from '../src/session-endpoint.js';

import { everyErrorSurface, wayloVoiceErrorFrom } from './__setup__/errors.js';
import { deferred } from './__setup__/fake-room.js';
import {
  fetchMock,
  opaqueRedirectResponse,
  serveSession,
  sessionEndpoint,
  sessionResponse,
  TEST_AGENT_ID,
  TEST_SESSION_ENDPOINT,
} from './__setup__/fake-session-endpoint.js';
import { webSessionBootstrap } from './__setup__/fixtures.js';

const HEADER_SECRET = 'Bearer app-token-123';

function request(
  options: { headers?: () => Record<string, string> | Promise<Record<string, string>> } = {},
) {
  return fetchSession(
    TEST_SESSION_ENDPOINT,
    { agentId: TEST_AGENT_ID },
    options.headers,
    new AbortController().signal,
  );
}

function sentInit(): RequestInit {
  const init = fetchMock.mock.calls[0]?.[1];

  if (!init) throw new Error('fetch not called');

  return init;
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('fetchSession', () => {
  it('posts the agent id as JSON to the session endpoint with same-origin credentials and no redirects', async () => {
    const { signal } = new AbortController();

    await fetchSession(TEST_SESSION_ENDPOINT, { agentId: TEST_AGENT_ID }, undefined, signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(TEST_SESSION_ENDPOINT);
    expect(sentInit()).toEqual({
      body: JSON.stringify({ agentId: TEST_AGENT_ID }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
  });

  it("aborts the request with the caller's reason when the caller aborts", async () => {
    const controller = new AbortController();
    const reason = new Error('caller gave up');

    sessionEndpoint.respond = () => deferred<Response>().promise;
    const fetched = fetchSession(
      TEST_SESSION_ENDPOINT,
      { agentId: TEST_AGENT_ID },
      undefined,
      controller.signal,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(reason);

    await expect(fetched).rejects.toBe(reason);
    expect(sentInit().signal?.aborted).toBe(true);
  });

  it('fails with CONNECTION_FAILED when the endpoint does not answer within 15 s', async () => {
    vi.useFakeTimers();
    sessionEndpoint.respond = () => deferred<Response>().promise;
    const error = wayloVoiceErrorFrom(request());

    await vi.advanceTimersByTimeAsync(14_999);
    expect(sentInit().signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(error).resolves.toMatchObject({
      cause: { message: 'Session endpoint did not answer within 15 s.' },
      code: 'CONNECTION_FAILED',
    });
    expect(sentInit().signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails with CONNECTION_FAILED when the body does not arrive within 15 s', async () => {
    vi.useFakeTimers();
    sessionEndpoint.respond = () =>
      Promise.resolve({ json: () => deferred().promise, ok: true, status: 200 } as Response);
    const error = wayloVoiceErrorFrom(request());

    await vi.advanceTimersByTimeAsync(15_000);

    await expect(error).resolves.toMatchObject({ code: 'CONNECTION_FAILED' });
  });

  it('returns a session that arrives just under 15 s and clears the timer', async () => {
    vi.useFakeTimers();
    const session = webSessionBootstrap();
    const answer = deferred<Response>();

    sessionEndpoint.respond = () => answer.promise;
    const fetched = request();

    await vi.advanceTimersByTimeAsync(14_999);
    answer.resolve(sessionResponse(session));

    await expect(fetched).resolves.toEqual(session);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends metadata as is', async () => {
    const metadata = { nested: { a: 1 }, orderId: '42' };

    await fetchSession(
      TEST_SESSION_ENDPOINT,
      { agentId: TEST_AGENT_ID, metadata },
      undefined,
      new AbortController().signal,
    );

    expect(JSON.parse(String(sentInit().body))).toEqual({ agentId: TEST_AGENT_ID, metadata });
  });

  it('returns the session from a 200 response', async () => {
    const session = webSessionBootstrap();

    serveSession(session);
    await expect(request()).resolves.toEqual(session);
  });

  it('adds the headers() result to the request, once, and sends no Idempotency-Key', async () => {
    const headers = vi.fn(async () => ({ Authorization: HEADER_SECRET }));

    await request({ headers });

    expect(headers).toHaveBeenCalledTimes(1);
    expect(sentInit().headers).toEqual({
      Authorization: HEADER_SECRET,
      'Content-Type': 'application/json',
    });
    expect(JSON.stringify(sentInit().headers).toLowerCase()).not.toContain('idempotency-key');
  });

  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'ACCESS_DENIED'],
    [429, 'LIMIT_REACHED'],
    [400, 'CONNECTION_FAILED'],
    [404, 'CONNECTION_FAILED'],
    [500, 'CONNECTION_FAILED'],
    [502, 'CONNECTION_FAILED'],
  ])('maps HTTP %i to %s and keeps the status in the cause', async (status, code) => {
    serveSession({ error: 'nope' }, status);
    const error = await wayloVoiceErrorFrom(request());

    expect(error.code).toBe(code);
    expect(error.cause).toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a network failure to CONNECTION_FAILED', async () => {
    sessionEndpoint.respond = () => Promise.reject(new TypeError('Failed to fetch'));
    const error = await wayloVoiceErrorFrom(request());

    expect(error.code).toBe('CONNECTION_FAILED');
    expect(error.cause).toMatchObject({ message: 'Failed to fetch', name: 'TypeError' });
  });

  it('maps a 200 response with a non-JSON body to INVALID_SESSION, without quoting the body', async () => {
    const body = '<html>participantToken=secret</html>';

    sessionEndpoint.respond = () => Promise.resolve(new Response(body, { status: 200 }));
    const error = await wayloVoiceErrorFrom(request());

    expect(error.code).toBe('INVALID_SESSION');
    expect(everyErrorSurface(error)).not.toContain('secret');
  });

  it('maps any redirect to AUTH_REQUIRED with a fixed cause', async () => {
    sessionEndpoint.respond = () => Promise.resolve(opaqueRedirectResponse());
    const error = await wayloVoiceErrorFrom(request());

    expect(error.code).toBe('AUTH_REQUIRED');
    expect((error.cause as Error).message).toBe(
      'Session endpoint redirected; answer 401 instead of redirecting to a login page.',
    );
  });

  it('maps a 200 HTML page that was not redirected to INVALID_SESSION', async () => {
    sessionEndpoint.respond = () =>
      Promise.resolve(
        new Response('<html></html>', { headers: { 'Content-Type': 'text/html' }, status: 200 }),
      );
    const error = await wayloVoiceErrorFrom(request());

    expect(error.code).toBe('INVALID_SESSION');
    expect(error.cause).toBeUndefined();
  });

  it('maps a 200 response that is not a session to INVALID_SESSION', async () => {
    sessionEndpoint.respond = () => Promise.resolve(sessionResponse({ ok: true }));

    await expect(wayloVoiceErrorFrom(request())).resolves.toMatchObject({
      code: 'INVALID_SESSION',
    });
  });

  const HOST_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret.sig';

  it.each([
    [
      'throws',
      () => {
        throw new Error(`refresh failed for ${HOST_TOKEN}`);
      },
    ],
    ['rejects', () => Promise.reject(new Error(`refresh failed for ${HOST_TOKEN}`))],
  ])(
    'maps headers() that %s to CONNECTION_FAILED with a fixed cause and no request',
    async (_label, headers) => {
      const error = await wayloVoiceErrorFrom(request({ headers }));

      expect(error.code).toBe('CONNECTION_FAILED');
      expect((error.cause as Error).message).toBe('The headers() function failed.');
      expect(everyErrorSurface(error)).not.toContain(HOST_TOKEN);
      expect(JSON.stringify(Object.entries(error.cause as object))).not.toContain(HOST_TOKEN);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('never puts header values in the error or its cause', async () => {
    sessionEndpoint.respond = () =>
      Promise.reject(new TypeError(`request with ${HEADER_SECRET} failed`));
    const error = await wayloVoiceErrorFrom(
      request({ headers: () => ({ Authorization: HEADER_SECRET }) }),
    );

    expect(everyErrorSurface(error)).not.toContain(HEADER_SECRET);
    expect(String(error.cause)).toContain('[redacted]');
  });
});
