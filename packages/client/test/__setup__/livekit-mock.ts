import { beforeEach, vi } from 'vitest';

import { analysers, stubMediaDevices } from './fake-media.js';
import { resetBehavior } from './fake-room.js';
import { fetchMock, resetSessionEndpoint } from './fake-session-endpoint.js';

vi.mock('livekit-client', async importOriginal => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  const { behavior, FakeRoom } = await import('./fake-room.js');
  const { createAnalyser } = await import('./fake-media.js');

  return {
    ...actual,
    createAudioAnalyser: vi.fn(createAnalyser),
    Room: FakeRoom,
    supportsAudioOutputSelection: () => behavior.canChooseSpeaker,
  };
});

beforeEach(() => {
  resetBehavior();
  analysers.length = 0;
  stubMediaDevices(undefined);
  resetSessionEndpoint();
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '';
});
