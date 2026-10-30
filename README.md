# Waylo Voice web SDK

`@waylovoice/client` connects a web page to a Waylo voice agent. The page names the agent; the SDK asks your own backend for a call session, joins the call, turns on the microphone and plays the agent's voice. Connection details never reach your page code. It is framework-free TypeScript and works with any front end.

## Requirements

- Browsers: recent Chrome, Edge, Firefox and Safari (desktop and mobile) with microphone access over HTTPS or `localhost`.

## Install

```sh
pnpm add @waylovoice/client
```

The package is not published yet. For now, build it from this repository and install the packed tarball:

```sh
pnpm install
pnpm build
pnpm pack:client        # writes packages/client/waylovoice-client-<version>.tgz
pnpm add /path/to/waylovoice-client-<version>.tgz   # in your app
```

## Usage

```ts
import { WayloVoice } from '@waylovoice/client';

const wayloVoice = new WayloVoice({ sessionEndpoint: '/api/waylo/session' });

await wayloVoice.start({
  agentId: '3f9c2a7e-1b4d-4c8a-9e2f-5d6b7a8c9e01',
  metadata: { orderId: '42' },
});
// ...
await wayloVoice.stop();
```

Call `start()` from a click handler so the browser allows audio playback. It resolves once the agent is ready (listening, thinking or speaking). A `WayloVoice` starts once; create a new one (with its own listeners) for the next call.

`stop()` is safe at any time. During `start()` it makes `start()` reject with `CANCELLED`; after that it ends the call with reason `caller_hangup`.

### State, transcripts and controls

```ts
wayloVoice.on('state', state => render(state)); // the whole snapshot on every change
wayloVoice.on('transcript', line => upsertRow(line.id, line.speaker, line.text, line.final));
wayloVoice.on('error', error => console.warn(error.code));

await wayloVoice.setMuted(true);
wayloVoice.setVolume(0.5); // 0 to 1
await wayloVoice.resumeAudio(); // from a click, when state.playback is 'blocked'
wayloVoice.getMicrophoneLevel(); // 0 to 1, for a mic meter; poll it with requestAnimationFrame
```

| State field | Values |
| --- | --- |
| `stage` | `idle`, `connecting`, `joining`, `preparing`, `speaking`, `listening`, `thinking`, `reconnecting`, `ended`; which moment of the call it is (see Status line) |
| `connection` | `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` |
| `agent` | `none`, `joining`, `listening`, `thinking`, `speaking` |
| `microphone` | `off`, `on`, `muted` |
| `network` | `good`, `poor`, `lost`; `good` outside a call |
| `playback` | `stopped`, `playing`, `blocked` |
| `volume` | last `setVolume()` value, default 1 |
| `sessionId` | the Waylo session id, once known |
| `microphoneDeviceId`, `speakerDeviceId` | the chosen device, or the one in use once the call has it; unset or `'default'` means the system default |
| `timings` | how long each step of the call took (see below), from `start()` on |
| `end` | set once when the call is over: `{ status: 'completed', reason? }` or `{ status: 'failed', reason?, error }`; `reason` uses the API's session end reasons |

`network` is how well this browser's connection to the call is doing: `good`, `poor` or `lost`. When it's `poor` or `lost`, show a non-blocking banner such as "Your connection is weak"; the call goes on, and `connection` says if it's reconnecting.

`getState()` returns the same snapshot. `on()` returns an unsubscribe function; `off()` works too. After the final `state` (the one with `end`) nothing more is emitted, whoever ended the call. `end` is what this browser saw; the stored session (`GET /sessions/:id`) is the record.

A transcript line keeps its `id` while it grows, and `text` is the whole line so far, so replace the row with that `id`. Captions are for display; the stored session is the record. While muted, the browser's mic indicator stays on, and `getMicrophoneLevel()` is 0; it is not in the state because it changes every frame. iOS Safari ignores volume levels, but 0 still mutes.

For a token-based app, add `headers`. The SDK calls it once per `start()` and sends the result only to `sessionEndpoint`. It never logs these headers or puts them in errors.

```ts
const wayloVoice = new WayloVoice({
  sessionEndpoint: '/api/waylo/session',
  headers: async () => ({ Authorization: `Bearer ${await getAppToken()}` }),
});
```

| Option | Meaning |
| --- | --- |
| `sessionEndpoint` | Required. Your backend route that returns a session (see below). Same-origin only (enforced). |
| `headers` | Optional. `() => Record<string, string>` or a promise of one. Extra request headers. |
| `agentTimeoutMs` | Optional. How long `start()` waits for the agent to be ready. Default 20000. |

### Status line

`state.stage` folds `connection` and `agent` into the one value a status line needs. The SDK shows no text; your page picks the words. Recommended wording:

| `stage`        | Status text                                                          |
| -------------- | -------------------------------------------------------------------- |
| `idle`         | nothing, or your Talk button                                         |
| `connecting`   | Calling {agent}…                                                     |
| `joining`      | {agent} is joining…                                                  |
| `preparing`    | {agent} is getting ready… (the agent is ready but hasn't spoken yet) |
| `speaking`     | {agent} is speaking                                                  |
| `listening`    | Go ahead, I'm listening                                              |
| `thinking`     | Thinking…                                                            |
| `reconnecting` | Reconnecting…                                                        |
| `ended`        | Call ended, or the failure in `end`                                  |

Next to it, while `network` is `poor`: "Your connection is weak, you may hear gaps".

### Microphone and speaker

```ts
const { microphones, speakers, canChooseSpeaker } = await WayloVoice.listDevices();

const [microphone] = microphones; // empty until the visitor has allowed the mic
const [speaker] = speakers;

if (microphone) await wayloVoice.setMicrophoneDevice(microphone.deviceId); // before or during the call
if (canChooseSpeaker && speaker) await wayloVoice.setSpeakerDevice(speaker.deviceId);
```

`listDevices()` never asks for permission, so names (and, in most browsers, the list itself) appear only once the visitor has allowed the microphone; list again then, and on `navigator.mediaDevices`' `devicechange`. `listDevices({ requestPermission: true })` asks for the microphone first (call it from a click), closes it again and lists with names; it rejects with `MICROPHONE_DENIED` if the visitor blocks it. `canChooseSpeaker` is false where the browser can't route audio to a chosen speaker (Safari and every iOS browser); `setSpeakerDevice()` then rejects with `SPEAKER_UNAVAILABLE`. Firefox before 140 can choose a speaker but lists none, so treat an empty `speakers` list as no choice. A device chosen before `start()` that is gone by then falls back to the system default, and the state shows the device in use. Mid-call, a microphone that can't be opened rejects with `MICROPHONE_UNAVAILABLE` (`MICROPHONE_IN_USE` when another app holds it, `MICROPHONE_DENIED` when the browser blocks it) and the call keeps a working microphone where it can; a missing speaker rejects with `SPEAKER_UNAVAILABLE`. A chosen microphone or speaker stays until it is unplugged; the call then moves to the system default (`'default'`). On `'default'`, Chrome and other Chromium browsers follow system default changes; Firefox and Safari keep the open microphone until it is unplugged. An unplugged muted microphone stays `muted` and opens the system default on unmute. A mid-call `error` event `MICROPHONE_UNAVAILABLE` means no microphone is left or none could be opened, muted or not; `microphone` is then `off`.

### Timings

`state.timings` says how long each step of `start()` took, in milliseconds after `start()` was called: `sessionReadyMs`, `connectedMs`, `microphoneReadyMs` (the microphone opens while the call connects, so the permission prompt overlaps the earlier steps), `agentReadyMs` and `agentSpeakingMs` (the agent starts speaking while the browser may play it; its audio arrives a few hundred milliseconds later), plus `startedAt` (`Date.now()` at `start()`). Steps can finish out of order: the agent can be ready before the microphone. Send them to your analytics to measure how long visitors wait to hear the agent. `state.timings` is for logging and monitoring; don't show it to visitors, show the call status instead.

## Your session endpoint

You build this route on your own backend. It checks your own login, then creates a session with the Waylo API using an API key that has the `sessions:write` scope and is pinned to your workspace. The key never leaves your server.

**What the SDK sends.** One `POST {sessionEndpoint}` per `start()` with JSON `{ "agentId": string, "metadata"?: object }`, your site's cookies and any `headers` you configured. No `Idempotency-Key`, no retry; `stop()` aborts it.

**What your endpoint answers.**

| Status | When | SDK error code |
| --- | --- | --- |
| `200` | The `POST /sessions/web` response body, forwarded unchanged, with `Cache-Control: no-store`. | none: the call starts |
| `401` | The visitor is not logged in. | `AUTH_REQUIRED` |
| `403` | The visitor may not use this agent. | `ACCESS_DENIED` |
| `429` | Too many calls; try again later. | `LIMIT_REACHED` |
| Other, or no answer | Anything else, or no answer within 15 s. | `CONNECTION_FAILED` |

Answer `401` and `403` as JSON; never redirect. Any redirect fails with `AUTH_REQUIRED`.

A `200` whose body is not a valid session fails with `INVALID_SESSION`. The SDK never falls back to any other (public) way of starting a call when your endpoint fails.

A session is a short-lived pass to join the call, so return it as soon as Waylo answers; never cache or reuse one. If the pass runs out before the browser joins, `start()` fails with `SESSION_EXPIRED`: the visitor waited too long and should click again.

**Retries are your backend's job.** If you retry `POST /sessions/web`, send the same `Idempotency-Key` again, bound to the logged-in user. Do not pass a Waylo `401` or `403` on as is: those are about your key, not your visitor.

```ts
// Node with Express; any framework works the same way.
app.post('/api/waylo/session', express.json(), async (request, response) => {
  const user = await findLoggedInUser(request); // your own login

  if (!user) return response.status(401).json({ error: 'auth_required' });

  const { agentId, metadata } = request.body;

  if (!userMayUse(user, agentId)) return response.status(403).json({ error: 'access_denied' });

  const upstream = await fetch(`${WAYLO_API_URL}/sessions/web`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WAYLO_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `${user.id}:${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID, agentId, metadata }),
  });

  if (!upstream.ok) return response.status(upstream.status === 429 ? 429 : 502).end();

  response.set('Cache-Control', 'no-store').type('application/json');
  response.status(200).send(await upstream.text());
});
```

The session body has this shape (the SDK checks it; your page never sees it):

```ts
{
  sessionId: string;
  workspaceId: string;
  roomName: string;
  livekitUrl: string;
  participantToken: string;
  expiresAt: string; // ISO 8601
  turn?: { urls: string[]; username: string; credential: string };
}
```

## Errors

`start()` rejects with a `WayloVoiceError`; problems after start come as `error` events and in `state.end.error`. Use its `code` to decide what to do, not its message; codes stay fixed, messages may change.

| Code | What happened | What to tell the visitor | Try again? |
| --- | --- | --- | --- |
| `AUTH_REQUIRED` | The session endpoint answered 401 or redirected. | "Please sign in to talk." | After signing in |
| `ACCESS_DENIED` | The session endpoint answered 403. | "You can't use this assistant." | No |
| `LIMIT_REACHED` | The session endpoint answered 429. | "Too many calls right now. Try again in a minute." | Yes, later |
| `INVALID_SESSION` | The session endpoint's 200 body is not a Waylo session; return it unchanged. | "Something went wrong. Please try again later." | No, fix the endpoint |
| `SESSION_EXPIRED` | The session expired or was rejected. | "Please try again." | Yes, new call |
| `CONNECTION_FAILED` | The endpoint failed or took over 15 s, the call could not connect, or it dropped. | "Couldn't connect. Check your internet and try again." | Yes |
| `MICROPHONE_DENIED` | The visitor or the browser blocked the microphone. | "Allow the microphone in your browser, then try again." | After allowing it |
| `MICROPHONE_IN_USE` | Another app or tab holds the microphone, or the system could not start it. | "Your microphone is busy. Close other apps using it, then try again." | Yes |
| `MICROPHONE_UNAVAILABLE` | No usable microphone, the chosen one can't be opened, or the browser refused it for another reason. The original error is in `cause`. | "No working microphone found. Connect one, then try again." | Yes, after fixing it |
| `SPEAKER_UNAVAILABLE` | The chosen speaker can't be used or the browser can't choose one; the current speaker keeps playing. | Nothing; hide or reset the speaker picker. | Not needed |
| `AGENT_TIMEOUT` | The agent wasn't ready in time. | "The assistant isn't available right now. Try again." | Yes |
| `AGENT_LEFT` | The agent left without ending the call. | "The call dropped. Start a new one." | Yes, new call |
| `AGENT_ERROR` | The agent hit an error and ended the call; `state.end.reason` says why. | "Something went wrong. Try again." | Yes, new call |
| `TRANSCRIPT_FAILED` | One caption line couldn't be read; the call goes on. | Nothing. | Not needed |
| `ALREADY_STARTED` | `start()` was called twice on one instance; a code bug. | Nothing; create a new `WayloVoice` per call. | Not needed |
| `CANCELLED` | `stop()` was called while starting. | Nothing. | Not needed |

The troubleshooting section of the [example README](example/README.md) says what to do about each one.

## For AI coding assistants

The package includes `llms.txt` (`node_modules/@waylovoice/client/llms.txt`), a one-file summary of this SDK for AI assistants.

## Example

[`example/`](example/) is a minimal page and Node server that make a real call. Its [README](example/README.md) covers setup and running it.

## Security

- Your Waylo API key stays on your server.
- In your session endpoint, check the user's login, their permission to use the agent and CSRF. `metadata` comes from the browser, so forward only the keys you expect.

## Development

See [AGENTS.md](AGENTS.md) for the repository layout, commands and conventions.

## License

Not yet licensed.
