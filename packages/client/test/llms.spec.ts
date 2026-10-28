import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { WAYLO_VOICE_ERROR_CODES } from '../src/errors.js';
import type { WayloVoiceState, WayloVoiceTimings } from '../src/index.js';
import { WayloVoice } from '../src/index.js';
import { SESSION_END_REASONS } from '../src/session-outcome.js';

const PACKAGE_PATH = ts.sys.getCurrentDirectory();
const LLMS_PATH = `${PACKAGE_PATH}/llms.txt`;
const INDEX_PATH = `${PACKAGE_PATH}/src/index.ts`;
const SNIPPETS_PATH = `${PACKAGE_PATH}/llms-snippets.ts`;

const STATE_FIELDS: Record<keyof WayloVoiceState, true> = {
  agent: true,
  connection: true,
  end: true,
  microphone: true,
  microphoneDeviceId: true,
  network: true,
  playback: true,
  sessionId: true,
  speakerDeviceId: true,
  stage: true,
  timings: true,
  volume: true,
};

const TIMING_FIELDS: Record<keyof WayloVoiceTimings, true> = {
  agentReadyMs: true,
  connectedMs: true,
  agentSpeakingMs: true,
  microphoneReadyMs: true,
  sessionReadyMs: true,
  startedAt: true,
};

function compileSnippets(text: string): string[] {
  const code = [...text.matchAll(/```ts\n([\s\S]*?)```/g)].map(([, block]) => block).join('\n');
  const options: ts.CompilerOptions = {
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: { '@waylovoice/client': [INDEX_PATH] },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile } = host;

  host.getSourceFile = (fileName, version, ...rest) =>
    fileName === SNIPPETS_PATH
      ? ts.createSourceFile(fileName, code, version)
      : getSourceFile(fileName, version, ...rest);
  host.fileExists = fileName => fileName === SNIPPETS_PATH || ts.sys.fileExists(fileName);

  const program = ts.createProgram([SNIPPETS_PATH], options, host);

  return ts
    .getPreEmitDiagnostics(program)
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

function readLlms(): string {
  const text = ts.sys.readFile(LLMS_PATH);

  if (text === undefined) throw new Error(`cannot read ${LLMS_PATH}`);

  return text;
}

function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);

  if (start === -1) throw new Error(`no "## ${heading}" section`);
  const end = text.indexOf('\n## ', start + 1);

  return text.slice(start, end === -1 ? undefined : end);
}

function tableNames(markdown: string): string[] {
  return [...markdown.matchAll(/^\| `([\w.]+)/gm)].map(([, name]) => name ?? '');
}

describe('llms.txt', () => {
  const text = readLlms();

  it('follows the llms.txt shape: a title, then a summary quote', () => {
    expect(text).toMatch(/^# @waylovoice\/client\n{2}> \S/);
  });

  it('has code that compiles against the public API', () => {
    expect(compileSnippets(text)).toEqual([]);
  }, 30_000);

  it('lists every error code, and only those', () => {
    expect(new Set(tableNames(section(text, 'Errors')))).toEqual(new Set(WAYLO_VOICE_ERROR_CODES));
  });

  it('lists every state field, and only those', () => {
    expect(new Set(tableNames(section(text, 'State')))).toEqual(new Set(Object.keys(STATE_FIELDS)));
  });

  it('names every end reason', () => {
    const state = section(text, 'State');

    for (const reason of SESSION_END_REASONS) expect(state).toContain(`\`${reason}\``);
  });

  it('names every timing', () => {
    const timings = section(text, 'Timings');

    for (const field of Object.keys(TIMING_FIELDS)) expect(timings).toContain(`\`${field}\``);
  });

  it('lists every method, and only those', () => {
    const listed = tableNames(section(text, 'API')).map(name => name.replace('WayloVoice.', ''));
    const methods = [
      ...Object.getOwnPropertyNames(WayloVoice.prototype),
      ...Object.getOwnPropertyNames(WayloVoice).filter(
        name => typeof Reflect.get(WayloVoice, name) === 'function',
      ),
    ].filter(name => name !== 'constructor');

    const options = new Set(['agentTimeoutMs', 'headers', 'sessionEndpoint']);

    expect(new Set(listed.filter(name => !options.has(name)))).toEqual(new Set(methods));
  });
});
