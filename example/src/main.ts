import {
  WayloVoice,
  WayloVoiceError,
  type WayloVoiceErrorCode,
  type WebSessionBootstrap,
} from '@waylovoice/client';

const HINTS: Record<WayloVoiceErrorCode, string> = {
  AGENT_LEFT: 'The assistant ended the call. Click Talk to start a new one.',
  AGENT_TIMEOUT: "The assistant didn't join in time. Try again.",
  ALREADY_STARTED: 'Each WayloVoice starts once. Create a new WayloVoice for each call.',
  CANCELLED: 'The call was stopped while it was starting.',
  CONNECTION_FAILED: 'Check your network and try again.',
  INVALID_SESSION: 'Check that /talk returns the Waylo API response unchanged.',
  MICROPHONE_DENIED: 'Allow microphone access in the browser and try again.',
  MICROPHONE_UNAVAILABLE: 'Connect a microphone, close other apps using it, and try again.',
  SESSION_EXPIRED: 'The session expired. Click Talk again.',
};

function requireElement<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) throw new Error(`#${id} missing`);

  return found as T;
}

const talkButton = requireElement<HTMLButtonElement>('talk');
const hangUpButton = requireElement<HTMLButtonElement>('hang-up');
const statusText = requireElement('status');
const errorText = requireElement('error');

let activeWayloVoice: WayloVoice | undefined;
let attempt = 0;

function describeError(error: unknown): string {
  if (error instanceof WayloVoiceError) {
    return `${error.message} ${HINTS[error.code]} (${error.code})`;
  }

  return String(error);
}

async function describeFailedResponse(response: Response | undefined): Promise<string> {
  if (!response) return 'Could not reach the server. Is it running?';

  const body: unknown = await response.json().catch(() => undefined);
  const error = (body as { error?: unknown } | undefined)?.error;
  const code = typeof error === 'string' ? error : (error as { code?: unknown } | undefined)?.code;

  return `Could not start a session: ${typeof code === 'string' ? code : 'unknown error'} (HTTP ${response.status})`;
}

function setInCall(inCall: boolean): void {
  talkButton.disabled = inCall;
  hangUpButton.disabled = !inCall;
}

function show(status: string, error = ''): void {
  statusText.textContent = `Status: ${status}`;
  errorText.textContent = error;
  errorText.hidden = error === '';
}

talkButton.addEventListener('click', async () => {
  const current = ++attempt;

  setInCall(true);
  show('requesting session');

  const response = await fetch('/talk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId: crypto.randomUUID() }),
  }).catch(() => undefined);

  if (current !== attempt) return;

  if (!response?.ok) {
    const error = await describeFailedResponse(response);

    if (current !== attempt) return;
    show('idle', error);
    setInCall(false);

    return;
  }

  const session: unknown = await response.json().catch(() => undefined);

  if (current !== attempt) return;

  if (session === undefined) {
    show('idle', 'Could not start a session: the server response is not JSON.');
    setInCall(false);

    return;
  }

  const wayloVoice = new WayloVoice();

  activeWayloVoice = wayloVoice;
  show('connecting');

  try {
    await wayloVoice.start(session as WebSessionBootstrap);
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
  attempt++;
  const wayloVoice = activeWayloVoice;

  activeWayloVoice = undefined;
  hangUpButton.disabled = true;
  show('hanging up');
  await wayloVoice?.stop();
  show('hung up');
  talkButton.disabled = false;
});
