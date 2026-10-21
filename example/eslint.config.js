import base from '@gilbarbara/eslint-config/base';
import node from '@gilbarbara/eslint-config/node';

const server = ['server.mjs'];

export default [
  {
    ignores: ['dist/**'],
  },
  ...base,
  ...node.map(config => ({ ...config, files: server })),
  {
    files: server,
    rules: {
      // A local dev server: stdout is its only log.
      'no-console': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    rules: {
      // The lint packages come from the repository root; this app installs only what it ships.
      'import-x/no-extraneous-dependencies': 'off',
    },
  },
];
