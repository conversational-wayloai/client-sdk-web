import type {
  WayloVoice,
  WayloVoiceError,
  WayloVoiceState,
  WayloVoiceTranscript,
} from '../../src/index.js';

import { lastRoom } from './fake-room.js';
import { createCall, START } from './fake-session-endpoint.js';

export async function activeCall() {
  const call = createCall();
  const events = record(call);

  await call.start(START);
  const room = lastRoom();
  const agent = room.remoteParticipants.get('agent');

  if (!agent) throw new Error('no agent');

  return { agent, call, room, ...events };
}

export function record(call: WayloVoice) {
  const errors: WayloVoiceError[] = [];
  const lines: WayloVoiceTranscript[] = [];
  const states: WayloVoiceState[] = [];

  call.on('error', error => errors.push(error));
  call.on('state', state => states.push(state));
  call.on('transcript', line => lines.push(line));

  return { errors, lines, states };
}
