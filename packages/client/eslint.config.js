import base from '@gilbarbara/eslint-config/base';
import vitest from '@gilbarbara/eslint-config/vitest';

export default [
  {
    ignores: ['coverage/**', 'dist/**'],
  },
  ...base,
  ...vitest,
  {
    files: ['test/**/*.spec-d.ts'],
    rules: {
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expectTypeOf'] }],
    },
  },
];
