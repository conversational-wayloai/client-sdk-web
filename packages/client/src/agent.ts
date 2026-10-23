import { type Participant, type RemoteParticipant, type Room, RoomEvent } from 'livekit-client';

import { abortable } from './abortable.js';
import { WayloVoiceError } from './errors.js';
import { toAgentState } from './state.js';

function isReady(participant: Participant | undefined): participant is RemoteParticipant {
  return !!participant?.isAgent && toAgentState(participant.attributes) !== 'joining';
}

export function findAgent(room: Room): RemoteParticipant | undefined {
  for (const participant of room.remoteParticipants.values()) {
    if (participant.isAgent) return participant;
  }

  return undefined;
}

/** Resolves once an agent is in the room and reports its first activity state. */
export async function waitForAgent(
  room: Room,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RemoteParticipant> {
  signal.throwIfAborted();
  const present = findAgent(room);

  if (isReady(present)) return present;

  let stopWaiting = () => {};

  const ready = new Promise<RemoteParticipant>((resolve, reject) => {
    const onConnected = (participant: RemoteParticipant) => {
      if (isReady(participant)) resolve(participant);
    };

    const onAttributes = (_changed: Record<string, string>, participant: Participant) => {
      if (isReady(participant)) resolve(participant);
    };

    const timer = setTimeout(() => reject(new WayloVoiceError('AGENT_TIMEOUT')), timeoutMs);

    room.on(RoomEvent.ParticipantConnected, onConnected);
    room.on(RoomEvent.ParticipantAttributesChanged, onAttributes);

    stopWaiting = () => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onConnected);
      room.off(RoomEvent.ParticipantAttributesChanged, onAttributes);
    };
  });

  // stop() disconnects the room right after aborting; the listeners must be gone by then.
  signal.addEventListener('abort', stopWaiting, { once: true });

  try {
    return await abortable(ready, signal);
  } finally {
    signal.removeEventListener('abort', stopWaiting);
    stopWaiting();
  }
}
