import {
  WayloVoice,
  type WayloVoiceEnd,
  type WayloVoiceEndReason,
  WayloVoiceError,
  type WayloVoiceErrorCode,
  type WayloVoiceState,
} from '@waylovoice/client';

const SESSION_ENDPOINT = '/api/waylo/session';
const AGENT_LOAD_ERROR = 'Could not load /api/example/agent. Is the server running?';

const HINTS: Partial<Record<WayloVoiceErrorCode, string>> = {
  AGENT_ERROR: 'The agent had a problem on our side. Try again later.',
  AGENT_TIMEOUT: "The agent didn't get ready in time. Try again.",
  MICROPHONE_DENIED: 'Allow microphone access in the browser and try again.',
  MICROPHONE_UNAVAILABLE: 'Connect a microphone, close other apps using it, and try again.',
  SESSION_EXPIRED: 'The session expired. Click Talk again.',
};

const END_SENTENCES: Partial<Record<WayloVoiceEndReason, string>> = {
  caller_goodbye: 'Call ended after goodbye',
  caller_hangup: 'You ended the call',
  caller_inactive: 'Ended for inactivity',
  max_duration: 'Reached the maximum duration',
};

type View = 'connecting' | 'ended' | 'failed' | 'idle' | 'listening' | 'speaking' | 'thinking';

const LABELS: Record<View, string> = {
  connecting: 'Connecting',
  ended: 'Call ended',
  failed: 'Call failed',
  idle: '',
  listening: 'Listening',
  speaking: 'Speaking',
  thinking: 'Thinking',
};

function requireElement<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) throw new Error(`#${id} missing`);

  return found as T;
}

const callButton = requireElement<HTMLButtonElement>('call');
const viz = requireElement('viz');
const statusLabel = requireElement('status');
const timerText = requireElement('timer');
const statePills = requireElement('state-pills');
const errorText = requireElement('error');
const endSummary = requireElement('end-summary');
const eventLog = requireElement('events');

let agentId: string | undefined;
let current: WayloVoice | undefined;
let callNumber = 0;
let startedAt: number | undefined;
let clock: number | undefined;

function describeChanges(before: WayloVoiceState, after: WayloVoiceState): string {
  const beforeValues = Object.fromEntries(pillValues(before));
  const changes = pillValues(after)
    .filter(([name, value]) => beforeValues[name] !== value)
    .map(([name, value]) => `${name} → ${value}`);

  if (after.end) changes.push(`call ended: ${after.end.status} ${after.end.reason ?? ''}`.trim());

  return changes.join(', ');
}

function describeEnd(end: WayloVoiceEnd): string {
  if (end.status === 'failed') return describeError(end.error);

  return (end.reason && END_SENTENCES[end.reason]) ?? 'Call ended';
}

function describeError(error: unknown): string {
  if (!(error instanceof WayloVoiceError)) return String(error);

  return [error.message, HINTS[error.code], `(${error.code})`].filter(Boolean).join(' ');
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor(ms / 1000) % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function isLive(state: WayloVoiceState): boolean {
  return state.connection !== 'idle' && !state.end;
}

function log(call: number, text: string): void {
  const line = document.createElement('li');

  line.textContent = `${new Date().toLocaleTimeString()}  #${call}  ${text}`;
  eventLog.prepend(line);
}

function pillValues(state: WayloVoiceState): [string, string][] {
  return [
    ['connection', state.connection],
    ['agent', state.agent],
    ['mic', state.microphone],
    ['playback', state.playback],
  ];
}

function render(state: WayloVoiceState): void {
  const view = viewOf(state);

  statusLabel.textContent = LABELS[view];
  statusLabel.dataset.state = view;
  viz.dataset.state = view;
  renderPills(state);
  renderCallButton(state);
  renderTimer(state);
  if (state.end) showEnd(state, state.end);
}

function renderCallButton(state: WayloVoiceState): void {
  const live = isLive(state);
  const connecting = state.connection === 'connecting';

  callButton.dataset.mode = live && !connecting ? 'hang-up' : 'talk';
  callButton.textContent = connecting ? 'Connecting…' : live ? 'Hang up' : 'Talk';
  callButton.disabled = connecting;
}

function renderPills(state: WayloVoiceState): void {
  const pills = pillValues(state).map(([name, value]) => {
    const pill = document.createElement('span');

    pill.dataset.value = value;
    pill.textContent = `${name}: ${value}`;

    return pill;
  });

  statePills.replaceChildren(...pills);
}

function renderTimer(state: WayloVoiceState): void {
  if (state.connection === 'connected' && startedAt === undefined) {
    startedAt = Date.now();
    clock = window.setInterval(tick, 1000);
  }

  tick();
  if (state.end) window.clearInterval(clock);
}

function resetCallView(): void {
  window.clearInterval(clock);
  startedAt = undefined;
  timerText.textContent = '';
  endSummary.hidden = true;
  showError('');
}

function showEnd(state: WayloVoiceState, end: WayloVoiceEnd): void {
  const lines = [
    describeEnd(end),
    `Call length ${timerText.textContent || '00:00'}`,
    `Session ${state.sessionId ?? 'none'}`,
  ];

  endSummary.role = end.status === 'failed' ? 'alert' : null;
  endSummary.replaceChildren(
    ...lines.map(text => {
      const line = document.createElement('p');

      line.textContent = text;

      return line;
    }),
  );
  endSummary.hidden = false;
}

function showError(message: string): void {
  errorText.textContent = message;
  errorText.hidden = message === '';
}

function startCall(id: string): WayloVoice {
  const call = ++callNumber;
  const wayloVoice = new WayloVoice({ sessionEndpoint: SESSION_ENDPOINT });

  let previous = wayloVoice.getState();

  wayloVoice.on('state', state => {
    render(state);
    const changes = describeChanges(previous, state);

    if (changes) log(call, changes);
    previous = state;
  });
  wayloVoice.on('error', error => log(call, `error: ${error.code}`));
  // The failure also arrives as the final `state` with `end`.
  wayloVoice.start({ agentId: id }).catch(() => undefined);

  return wayloVoice;
}

function tick(): void {
  if (startedAt !== undefined) timerText.textContent = formatTime(Date.now() - startedAt);
}

function viewOf(state: WayloVoiceState): View {
  if (state.end) return state.end.status === 'failed' ? 'failed' : 'ended';
  if (state.connection === 'idle') return 'idle';
  if (state.connection !== 'connected') return 'connecting';
  if (state.agent === 'none' || state.agent === 'joining') return 'connecting';

  return state.agent;
}

callButton.addEventListener('click', async () => {
  if (current && isLive(current.getState())) {
    current.stop().catch(() => undefined);

    return;
  }

  callButton.disabled = true;
  // Awaiting can lose the click gesture; the playback pill then shows blocked.
  const id = agentId ?? (await agentIdLoading);

  if (id === undefined) {
    showError(AGENT_LOAD_ERROR);
    callButton.disabled = false;

    return;
  }

  resetCallView();
  current = startCall(id);
});

async function loadAgentId(): Promise<string | undefined> {
  const body = (await fetch('/api/example/agent')
    .then(response => (response.ok ? response.json() : undefined))
    .catch(() => undefined)) as { agentId?: string } | undefined;

  agentId = body?.agentId;
  if (agentId === undefined) showError(AGENT_LOAD_ERROR);

  return agentId;
}

const agentIdLoading = loadAgentId();

callButton.disabled = false;
