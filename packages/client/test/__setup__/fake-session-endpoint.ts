import { vi } from 'vitest';

import { WayloVoice, type WayloVoiceOptions } from '../../src/index.js';

import { webSessionBootstrap } from './fixtures.js';

export const TEST_AGENT_ID = '3f9c2a7e-1b4d-4c8a-9e2f-5d6b7a8c9e01';
export const TEST_SESSION_ENDPOINT = '/api/waylo/session';
export const START = { agentId: TEST_AGENT_ID };

export const sessionEndpoint = {
  respond: (): Promise<Response> => Promise.resolve(sessionResponse()),
};

export const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  sessionEndpoint.respond(),
);

export function createCall(options: Partial<WayloVoiceOptions> = {}): WayloVoice {
  return new WayloVoice({ sessionEndpoint: TEST_SESSION_ENDPOINT, ...options });
}

export function opaqueRedirectResponse(): Response {
  return Object.defineProperties(new Response(null), {
    ok: { value: false },
    status: { value: 0 },
    type: { value: 'opaqueredirect' },
  });
}

export function resetSessionEndpoint(): void {
  serveSession(webSessionBootstrap());
  fetchMock.mockClear();
}

export function serveSession(body: unknown, status = 200): void {
  sessionEndpoint.respond = () => Promise.resolve(sessionResponse(body, status));
}

// json() resolves at once so flush() still reaches each start step.
export function sessionResponse(body: unknown = webSessionBootstrap(), status = 200): Response {
  return {
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}
