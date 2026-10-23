import { expect } from 'vitest';

import { WayloVoiceError } from '../../src/errors.js';

export async function errorCodeFrom(source: (() => unknown) | Promise<unknown>): Promise<string> {
  const { code } = await wayloVoiceErrorFrom(source);

  return code;
}

export function everyErrorSurface(error: WayloVoiceError): string {
  return [error.message, error.stack, String(error.cause), jsonWithErrors(error)].join('\n');
}

/** JSON.stringify that also writes out every Error's message, stack and cause. */
export function jsonWithErrors(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested instanceof Error
      ? {
          ...nested,
          cause: nested.cause,
          message: nested.message,
          name: nested.name,
          stack: nested.stack,
        }
      : nested,
  );
}

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
