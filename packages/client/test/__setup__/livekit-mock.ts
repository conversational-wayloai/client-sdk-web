import { beforeEach, vi } from 'vitest';

import { resetBehavior } from './fake-room.js';

vi.mock('livekit-client', async importOriginal => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  const { FakeRoom } = await import('./fake-room.js');

  return { ...actual, Room: FakeRoom };
});

beforeEach(() => {
  resetBehavior();
  document.body.innerHTML = '';
});
