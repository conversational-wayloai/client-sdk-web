import { WayloVoice, WayloVoiceError, type WayloVoiceErrorCode } from '@waylovoice/client';

const SESSION_ENDPOINT = '/api/waylo/session';

const HINTS: Record<WayloVoiceErrorCode, string> = {
  ACCESS_DENIED: "This agent isn't allowed by the session endpoint.",
  AGENT_LEFT: 'The assistant ended the call. Click Talk to start a new one.',
  AGENT_TIMEOUT: "The assistant didn't join in time. Try again.",
  ALREADY_STARTED: 'Each WayloVoice starts once. Create a new WayloVoice for each call.',
  AUTH_REQUIRED: 'Your session endpoint answered 401 or redirected.',
  CANCELLED: 'The call was stopped while it was starting.',
  CONNECTION_FAILED: 'Check your network and the server terminal, then try again.',
  INVALID_SESSION: `Check that ${SESSION_ENDPOINT} returns the Waylo API response unchanged.`,
  LIMIT_REACHED: 'Too many calls right now. Wait a moment and try again.',
  MICROPHONE_DENIED: 'Allow microphone access in the browser and try again.',
  MICROPHONE_UNAVAILABLE: 'Connect a microphone, close other apps using it, and try again.',
  SESSION_EXPIRED: 'The session expired. Click Talk again.',
};

interface Agent {
  agentId: string;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) throw new Error(`#${id} missing`);

  return found as T;
}

const talkButton = requireElement<HTMLButtonElement>('talk');
const hangUpButton = requireElement<HTMLButtonElement>('hang-up');
const statusText = requireElement('status');
const errorText = requireElement('error');

let agentId: string | undefined;
let activeWayloVoice: WayloVoice | undefined;

function describeError(error: unknown): string {
  if (error instanceof WayloVoiceError) {
    return `${error.message} ${HINTS[error.code]} (${error.code})`;
  }

  return String(error);
}

async function loadAgent(): Promise<void> {
  const response = await fetch('/api/example/agent').catch(() => undefined);

  if (!response?.ok) {
    show('idle', 'Could not load /api/example/agent. Is the server running?');

    return;
  }

  const agent = (await response.json()) as Agent;

  agentId = agent.agentId;
  setInCall(false);
}

function setInCall(inCall: boolean): void {
  talkButton.disabled = inCall || agentId === undefined;
  hangUpButton.disabled = !inCall;
}

function show(status: string, error = ''): void {
  statusText.textContent = `Status: ${status}`;
  errorText.textContent = error;
  errorText.hidden = error === '';
}

talkButton.addEventListener('click', async () => {
  if (agentId === undefined) return;

  const wayloVoice = new WayloVoice({ sessionEndpoint: SESSION_ENDPOINT });

  activeWayloVoice = wayloVoice;
  setInCall(true);
  show('connecting');

  try {
    await wayloVoice.start({ agentId });
    show('connected, agent joined');
  } catch (error) {
    if (activeWayloVoice !== wayloVoice) return;
    activeWayloVoice = undefined;
    await wayloVoice.stop();
    show('failed', describeError(error));
    setInCall(false);
  }
});

hangUpButton.addEventListener('click', async () => {
  const wayloVoice = activeWayloVoice;

  activeWayloVoice = undefined;
  hangUpButton.disabled = true;
  show('hanging up');
  await wayloVoice?.stop();
  show('hung up');
  setInCall(false);
});

await loadAgent();
