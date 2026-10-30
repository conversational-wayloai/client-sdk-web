import { DataStreamErrorReason, type Room, type TextStreamReader } from 'livekit-client';

import { WayloVoiceError } from './errors.js';
import type { WayloVoiceTranscript } from './state.js';

export const TRANSCRIPTION_TOPIC = 'lk.transcription';
const SEGMENT_ID_ATTRIBUTE = 'lk.segment_id';
const FINAL_ATTRIBUTE = 'lk.transcription_final';

export interface TranscriptHandlers {
  getSessionId(): string | undefined;
  onError(error: WayloVoiceError): void;
  onTranscript(line: WayloVoiceTranscript): void;
}

// LiveKit ends open streams with AbnormalEnd when the sender leaves, including during a full
// reconnect. Checked by name and reason so a second livekit-client copy still matches.
function isCutOff(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'DataStreamError' &&
    (error as { reason?: unknown }).reason === DataStreamErrorReason.AbnormalEnd
  );
}

/** Reads LiveKit's native transcription streams. Register before connect so no line is missed. */
export function listenToTranscripts(
  room: Room,
  signal: AbortSignal,
  handlers: TranscriptHandlers,
): void {
  const finals = new Set<string>();

  room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, { identity }) => {
    readLine(reader, identity).catch(() => undefined);
  });

  async function readLine(reader: TextStreamReader, identity: string): Promise<void> {
    // LiveKit always sets lk.segment_id; the stream id keeps text visible if it ever does not.
    const segment = reader.info.attributes?.[SEGMENT_ID_ATTRIBUTE] ?? reader.info.id;
    const id = `${handlers.getSessionId() ?? ''}:${identity}:${segment}`;
    const speaker = identity === room.localParticipant.identity ? 'user' : 'agent';
    let text = '';
    let cutOff = false;

    try {
      for await (const chunk of reader.withAbortSignal(signal)) {
        if (finals.has(id)) return;
        text += chunk;
        handlers.onTranscript({ final: false, id, speaker, text });
      }
    } catch (error) {
      if (signal.aborted) return;

      if (!isCutOff(error)) {
        handlers.onError(new WayloVoiceError('TRANSCRIPT_FAILED', error));

        return;
      }

      cutOff = true;
    }

    // A cut-off line keeps what arrived. Otherwise the final marker may arrive only in the stream
    // trailer, merged in when the stream ends.
    const final = cutOff ? text !== '' : reader.info.attributes?.[FINAL_ATTRIBUTE] === 'true';

    if (signal.aborted || finals.has(id) || !final) return;
    finals.add(id);
    handlers.onTranscript({ final: true, id, speaker, text });
  }
}
