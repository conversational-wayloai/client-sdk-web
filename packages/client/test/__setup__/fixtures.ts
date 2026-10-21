import type { WebSessionBootstrap } from '../../src/session.js';

export const TEST_LIVEKIT_URL = 'wss://livekit.example.test';
export const TEST_PARTICIPANT_TOKEN = 'secret-token';
export const TEST_TURN_SERVER = {
  credential: 'turn-secret',
  urls: ['turns:turn.example.test:443'],
  username: 'turn-user',
};

export function webSessionBootstrap(
  overrides: Partial<Record<keyof WebSessionBootstrap, unknown>> = {},
): WebSessionBootstrap {
  return {
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    livekitUrl: TEST_LIVEKIT_URL,
    participantToken: TEST_PARTICIPANT_TOKEN,
    roomName: 'room-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    ...overrides,
  } as WebSessionBootstrap;
}
