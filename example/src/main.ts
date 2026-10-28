import {
  WayloVoice,
  type WayloVoiceDevice,
  type WayloVoiceEnd,
  type WayloVoiceEndReason,
  WayloVoiceError,
  type WayloVoiceErrorCode,
  type WayloVoiceListDevicesOptions,
  type WayloVoiceState,
  type WayloVoiceTimings,
  type WayloVoiceTranscript,
} from '@waylovoice/client';

const SESSION_ENDPOINT = '/api/waylo/session';
const AGENT_LOAD_ERROR = 'Could not load /api/example/agent. Is the server running?';

const HINTS: Partial<Record<WayloVoiceErrorCode, string>> = {
  AGENT_ERROR: 'The agent had a problem on our side. Try again later.',
  AGENT_TIMEOUT: "The agent didn't get ready in time. Try again.",
  MICROPHONE_DENIED: 'Allow microphone access in the browser and try again.',
  MICROPHONE_UNAVAILABLE: 'Connect a microphone, close other apps using it, and try again.',
  SESSION_EXPIRED: 'The session expired. Click Talk again.',
  SPEAKER_UNAVAILABLE: 'Pick another speaker; the current one keeps playing.',
};

const END_SENTENCES: Partial<Record<WayloVoiceEndReason, string>> = {
  caller_goodbye: 'Call ended after goodbye',
  caller_hangup: 'You ended the call',
  caller_inactive: 'Ended for inactivity',
  max_duration: 'Reached the maximum duration',
};

type TimingStep = Exclude<keyof WayloVoiceTimings, 'startedAt'>;

// Label, the mark it starts at (unset: the click) and the mark it ends at.
const STARTUP_STEPS: readonly (readonly [string, TimingStep | undefined, TimingStep])[] = [
  ['Create session', undefined, 'sessionReadyMs'],
  ['Join call', 'sessionReadyMs', 'connectedMs'],
  ['Turn on mic', undefined, 'microphoneReadyMs'],
  ['Agent ready', 'connectedMs', 'agentReadyMs'],
  ['Agent starts talking', 'agentReadyMs', 'agentSpeakingMs'],
];

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
const muteBox = requireElement<HTMLInputElement>('mute');
const volumeSlider = requireElement<HTMLInputElement>('volume');
const microphoneLevel = requireElement('mic-level');
const resumeButton = requireElement<HTMLButtonElement>('resume-audio');
const microphoneSelect = requireElement<HTMLSelectElement>('microphone');
const speakerSelect = requireElement<HTMLSelectElement>('speaker');
const deviceNamesButton = requireElement<HTMLButtonElement>('device-names');
const speakerChoice = requireElement('speaker-choice');
const speakerNote = requireElement('speaker-note');
const deviceHint = requireElement('device-hint');
const startup = requireElement('startup');
const startupTotal = requireElement('startup-total');
const startupList = requireElement('startup-steps');
const startupEnd = requireElement('startup-end');
const viz = requireElement('viz');
const statusLabel = requireElement('status');
const timerText = requireElement('timer');
const statePills = requireElement('state-pills');
const errorText = requireElement('error');
const endSummary = requireElement('end-summary');
const sessionText = requireElement('session');
const transcriptList = requireElement('transcript');
const thinking = requireElement('thinking');
const eventLog = requireElement('events');

let agentId: string | undefined;
let current: WayloVoice | undefined;
let callNumber = 0;
let startedAt: number | undefined;
let clock: number | undefined;
const rows = new Map<string, HTMLElement>();

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

function deviceOptions(
  devices: readonly WayloVoiceDevice[],
  fallback: string,
): HTMLOptionElement[] {
  if (devices.length === 0) return [new Option(fallback, '')];

  return devices.map(
    ({ deviceId, label }, index) => new Option(label || `Device ${index + 1}`, deviceId),
  );
}

function drawMicrophoneLevel(): void {
  const segments = [...microphoneLevel.children];
  const lit = Math.round(Math.sqrt(current?.getMicrophoneLevel() ?? 0) * segments.length);

  for (const [index, segment] of segments.entries()) segment.classList.toggle('on', index < lit);
  requestAnimationFrame(drawMicrophoneLevel);
}

function followLatest(change: () => void): void {
  const box = transcriptList;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

  change();
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
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

async function refreshDevices(options?: WayloVoiceListDevicesOptions): Promise<void> {
  const { canChooseSpeaker, microphones, speakers } = await WayloVoice.listDevices(options);

  const named = microphones.some(microphone => microphone.label !== '');

  for (const [select, devices, fallback] of [
    [microphoneSelect, microphones, 'Default microphone'],
    [speakerSelect, speakers, 'Default speaker'],
  ] as const) {
    const chosen = select.value;

    select.replaceChildren(...deviceOptions(devices, fallback));
    select.disabled = devices.length === 0;
    if (devices.some(device => device.deviceId === chosen)) select.value = chosen;
  }

  speakerChoice.hidden = !canChooseSpeaker;
  speakerNote.hidden = canChooseSpeaker;
  deviceNamesButton.hidden = named;
  deviceHint.hidden = named;
}

function render(state: WayloVoiceState): void {
  const view = viewOf(state);

  statusLabel.textContent = LABELS[view];
  statusLabel.dataset.state = view;
  viz.dataset.state = view;
  sessionText.textContent = `Session ${state.sessionId ?? '—'}`;
  renderPills(state);
  renderCallButton(state);
  renderTimer(state);
  resumeButton.hidden = state.playback !== 'blocked';
  renderDevices(state);
  renderTimings(state);
  followLatest(() => {
    thinking.hidden = view !== 'thinking';
  });
  if (state.end) showEnd(state.end);
}

function renderCallButton(state: WayloVoiceState): void {
  const live = isLive(state);
  const connecting = state.connection === 'connecting';

  callButton.dataset.mode = live && !connecting ? 'hang-up' : 'talk';
  callButton.textContent = connecting ? 'Connecting…' : live ? 'Hang up' : 'Talk';
  callButton.disabled = connecting;
}

function renderDevices(state: WayloVoiceState): void {
  for (const [select, deviceId] of [
    [microphoneSelect, state.microphoneDeviceId],
    [speakerSelect, state.speakerDeviceId],
  ] as const) {
    if (deviceId && [...select.options].some(option => option.value === deviceId)) {
      select.value = deviceId;
    }
  }
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

function renderTimings({ timings }: WayloVoiceState): void {
  const totalMs = timings?.agentSpeakingMs;

  startup.hidden = totalMs === undefined;
  if (!timings || totalMs === undefined) return;

  const bars = STARTUP_STEPS.flatMap(([label, from, to]) => {
    const endMs = timings[to];
    const fromMs = from ? timings[from] : 0;

    return endMs === undefined || fromMs === undefined
      ? []
      : [{ endMs, label, startMs: Math.min(fromMs, endMs), to }];
  });
  const axisMs = Math.max(...bars.map(({ endMs }) => endMs));
  const percent = (ms: number) => `${(ms / axisMs) * 100}%`;

  startupTotal.textContent = formatSeconds(totalMs);
  startupList.replaceChildren(
    ...bars.map(({ endMs, label, startMs, to }) => {
      const item = document.createElement('li');
      const track = document.createElement('span');
      const bar = document.createElement('span');

      item.dataset.mark = to;
      track.className = 'startup-track';
      bar.style.left = percent(startMs);
      bar.style.width = percent(endMs - startMs);
      track.append(bar);
      item.append(textSpan(label), track, textSpan(formatSeconds(endMs - startMs)));

      return item;
    }),
  );
  startupEnd.textContent = formatSeconds(axisMs);
}

function resetCallView(): void {
  rows.clear();
  transcriptList.replaceChildren(thinking);
  thinking.hidden = true;
  window.clearInterval(clock);
  startedAt = undefined;
  timerText.textContent = '';
  startup.hidden = true;
  endSummary.hidden = true;
  showError('');
}

function showDeviceError(error: unknown): void {
  showError(describeError(error));
  if (current) renderDevices(current.getState());
}

function showEnd(end: WayloVoiceEnd): void {
  const lines = [describeEnd(end), `Call length ${timerText.textContent || '00:00'}`];

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

    if (state.timings && state.timings !== previous.timings) {
      log(call, `timings ${JSON.stringify(state.timings)}`);
    }

    if (state.microphone !== 'off' && previous.microphone === 'off') {
      refreshDevices().catch(() => undefined);
    }

    previous = state;
  });
  wayloVoice.on('transcript', upsertRow);
  wayloVoice.on('error', error => log(call, `error: ${error.code}`));
  wayloVoice.setVolume(volumeSlider.valueAsNumber);
  wayloVoice.setMuted(muteBox.checked).catch(() => undefined);

  if (microphoneSelect.value) {
    wayloVoice.setMicrophoneDevice(microphoneSelect.value).catch(showDeviceError);
  }

  if (speakerSelect.value && !speakerChoice.hidden) {
    wayloVoice.setSpeakerDevice(speakerSelect.value).catch(showDeviceError);
  }

  // The failure also arrives as the final `state` with `end`.
  wayloVoice.start({ agentId: id }).catch(() => undefined);

  return wayloVoice;
}

function textSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span');

  span.textContent = text;

  return span;
}

function tick(): void {
  if (startedAt !== undefined) timerText.textContent = formatTime(Date.now() - startedAt);
}

function upsertRow(line: WayloVoiceTranscript): void {
  followLatest(() => {
    let row = rows.get(line.id);

    if (!row) {
      row = document.createElement('p');
      row.className = line.speaker;
      row.dataset.testid = 'transcript-row';
      rows.set(line.id, row);
      transcriptList.insertBefore(row, thinking);
      if (line.speaker === 'agent') thinking.hidden = true;
    }

    row.textContent = line.text;
    row.classList.toggle('draft', !line.final);
  });
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
  // Awaiting can lose the click gesture; the "Tap to hear the agent" banner covers a blocked start.
  const id = agentId ?? (await agentIdLoading);

  if (id === undefined) {
    showError(AGENT_LOAD_ERROR);
    callButton.disabled = false;

    return;
  }

  resetCallView();
  current = startCall(id);
});

muteBox.addEventListener('change', () => {
  current?.setMuted(muteBox.checked).catch(error => {
    muteBox.checked = !muteBox.checked;
    showError(describeError(error));
  });
});

volumeSlider.addEventListener('input', () => {
  current?.setVolume(volumeSlider.valueAsNumber);
});

microphoneSelect.addEventListener('change', () => {
  showError('');
  current?.setMicrophoneDevice(microphoneSelect.value).catch(showDeviceError);
});

speakerSelect.addEventListener('change', () => {
  showError('');
  current?.setSpeakerDevice(speakerSelect.value).catch(showDeviceError);
});

deviceNamesButton.addEventListener('click', () => {
  showError('');
  refreshDevices({ requestPermission: true }).catch(showDeviceError);
});

navigator.mediaDevices?.addEventListener('devicechange', () => {
  refreshDevices().catch(() => undefined);
});

resumeButton.addEventListener('click', () => {
  current?.resumeAudio().catch(() => undefined);
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

refreshDevices().catch(() => undefined);
requestAnimationFrame(drawMicrophoneLevel);

callButton.disabled = false;
