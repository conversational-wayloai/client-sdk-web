import { describe, expect, it } from 'vitest';

import { activeCall } from './__setup__/active-call.js';
import { FakeRoom, flush } from './__setup__/fake-room.js';
import { createCall, START } from './__setup__/fake-session-endpoint.js';
import { createTextStream } from './__setup__/fake-text-stream.js';

const USER = 'user-session-1';
const AGENT = 'agent';

function partial(segment: string, final = 'false') {
  return { 'lk.segment_id': segment, 'lk.transcription_final': final };
}

describe('transcripts', () => {
  it('merges partial user streams with one segment id into one line', async () => {
    const { lines, room } = await activeCall();

    for (const [index, text] of ['hel', 'hello th'].entries()) {
      const stream = createTextStream(`ST_${index}`, partial('SG_1'));

      room.streamText(stream, USER);
      stream.push(text);
      stream.end();
    }

    const last = createTextStream('ST_2', partial('SG_1', 'true'));

    room.streamText(last, USER);
    last.push('hello there');
    last.end();
    await flush();

    expect(lines).toEqual([
      { final: false, id: 'session-1:user-session-1:SG_1', speaker: 'user', text: 'hel' },
      { final: false, id: 'session-1:user-session-1:SG_1', speaker: 'user', text: 'hello th' },
      { final: false, id: 'session-1:user-session-1:SG_1', speaker: 'user', text: 'hello there' },
      { final: true, id: 'session-1:user-session-1:SG_1', speaker: 'user', text: 'hello there' },
    ]);
  });

  it('builds an agent line from many pieces and finalizes it from the trailer', async () => {
    const { lines, room } = await activeCall();
    const stream = createTextStream('ST_A', partial('SG_A'));

    room.streamText(stream, AGENT);
    stream.push('Hi, ');
    stream.push('how can I help?');
    stream.end({ 'lk.transcription_final': 'true' });
    await flush();

    expect(lines.map(line => [line.speaker, line.text, line.final])).toEqual([
      ['agent', 'Hi, ', false],
      ['agent', 'Hi, how can I help?', false],
      ['agent', 'Hi, how can I help?', true],
    ]);
  });

  it('keeps a line partial when the stream ends without the final marker', async () => {
    const { lines, room } = await activeCall();
    const stream = createTextStream('ST_A', partial('SG_A'));

    room.streamText(stream, AGENT);
    stream.push('Sorry, I');
    stream.end();
    await flush();
    expect(lines.every(line => !line.final)).toBe(true);
  });

  it('reports TRANSCRIPT_FAILED and never a final when a stream breaks', async () => {
    const { call, errors, lines, room } = await activeCall();
    const stream = createTextStream('ST_A', partial('SG_A', 'true'));

    room.streamText(stream, AGENT);
    stream.push('Half a');
    stream.fail();
    await flush();
    expect(errors.map(error => error.code)).toEqual(['TRANSCRIPT_FAILED']);
    expect(lines.some(line => line.final)).toBe(false);
    expect(call.getState().connection).toBe('connected');
  });

  it('ignores updates for a line that is already final', async () => {
    const { lines, room } = await activeCall();
    const final = createTextStream('ST_1', partial('SG_1', 'true'));

    room.streamText(final, USER);
    final.push('done');
    final.end();
    await flush();
    const late = createTextStream('ST_2', partial('SG_1'));

    room.streamText(late, USER);
    late.push('done but late');
    late.end();
    await flush();
    expect(lines.at(-1)).toMatchObject({ final: true, text: 'done' });
  });

  it('falls back to the stream id when lk.segment_id is missing', async () => {
    const { lines, room } = await activeCall();
    const stream = createTextStream('ST_9', { 'lk.transcription_final': 'true' });

    room.streamText(stream, AGENT);
    stream.push('no segment');
    stream.end();
    await flush();
    expect(lines.at(-1)).toMatchObject({ final: true, id: 'session-1:agent:ST_9' });
  });

  it('aborts open readers and unregisters on stop(), with nothing emitted after', async () => {
    const { call, errors, lines, room } = await activeCall();
    const stream = createTextStream('ST_A', partial('SG_A'));

    room.streamText(stream, AGENT);
    stream.push('Before');
    await flush();
    const count = lines.length;

    await call.stop();
    stream.push(' after');
    stream.end({ 'lk.transcription_final': 'true' });
    await flush();
    expect(lines).toHaveLength(count);
    expect(errors).toHaveLength(0);
    expect(room.unregisterTextStreamHandler).toHaveBeenCalledWith('lk.transcription');
    expect(room.textStreamHandlers.size).toBe(0);
  });

  it('leaves no handlers after 10 calls on new objects', async () => {
    for (let index = 0; index < 10; index++) {
      const call = createCall();

      await call.start(START);
      await call.stop();
    }

    for (const room of FakeRoom.instances) expect(room.textStreamHandlers.size).toBe(0);
  });
});
