import { expect } from 'vitest';

import { WayloVoiceError } from '../../src/errors.js';

export async function errorCodeFrom(source: (() => unknown) | Promise<unknown>): Promise<string> {
  const { code } = await wayloVoiceErrorFrom(source);

  return code;
}

export function everyErrorSurface(error: WayloVoiceError): string {
  const expand = (_key: string, value: unknown) =>
    value instanceof Error
      ? {
          ...value,
          cause: value.cause,
          message: value.message,
          name: value.name,
          stack: value.stack,
        }
      : value;

  return [error.message, error.stack, String(error.cause), JSON.stringify(error, expand)].join(
    '\n',
  );
}

/** The WayloVoiceError a promise rejects with, or a function throws; fails the test otherwise. */
export async function wayloVoiceErrorFrom(
  source: (() => unknown) | Promise<unknown>,
): Promise<WayloVoiceError> {
  const settled = typeof source === 'function' ? Promise.resolve().then(source) : source;
  const error = await settled.then(
    () => undefined,
    (error_: unknown) => error_,
  );

  expect(error).toBeInstanceOf(WayloVoiceError);

  return error as WayloVoiceError;
}
