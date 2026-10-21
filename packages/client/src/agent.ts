import { type RemoteParticipant, type Room, RoomEvent } from 'livekit-client';

import { abortable } from './abortable.js';
import { WayloVoiceError } from './errors.js';

function findAgent(room: Room): RemoteParticipant | undefined {
  for (const participant of room.remoteParticipants.values()) {
    if (participant.isAgent) return participant;
  }

  return undefined;
}

export async function waitForAgent(
  room: Room,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RemoteParticipant> {
  signal.throwIfAborted();
  const present = findAgent(room);

  if (present) return present;

  let stopWaiting = () => {};

  const joined = new Promise<RemoteParticipant>((resolve, reject) => {
    const onConnected = (participant: RemoteParticipant) => {
      if (participant.isAgent) resolve(participant);
    };

    const timer = setTimeout(() => reject(new WayloVoiceError('agent_timeout')), timeoutMs);

    room.on(RoomEvent.ParticipantConnected, onConnected);

    stopWaiting = () => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onConnected);
    };
  });

  try {
    return await abortable(joined, signal);
  } finally {
    stopWaiting();
  }
}
