import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
      thresholds: { branches: 85, functions: 85, lines: 85, statements: 85 },
    },
    environment: 'jsdom',
    include: ['test/**/*.spec.ts'],
    setupFiles: ['test/__setup__/livekit-mock.ts'],
    typecheck: {
      enabled: true,
      include: ['test/**/*.spec-d.ts'],
      tsconfig: 'tsconfig.json',
    },
  },
});
