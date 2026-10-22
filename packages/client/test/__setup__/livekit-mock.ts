import { beforeEach, vi } from 'vitest';

import { resetBehavior } from './fake-room.js';
import { fetchMock, resetSessionEndpoint } from './fake-session-endpoint.js';

vi.mock('livekit-client', async importOriginal => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  const { FakeRoom } = await import('./fake-room.js');

  return { ...actual, Room: FakeRoom };
});

beforeEach(() => {
  resetBehavior();
  resetSessionEndpoint();
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '';
});
