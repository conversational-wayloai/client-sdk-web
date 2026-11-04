# Waylo Voice web SDK

[![npm](https://img.shields.io/npm/v/@waylovoice/client)](https://www.npmjs.com/package/@waylovoice/client) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/conversational-wayloai/client-sdk-web/blob/main/LICENSE)

Browser SDK for voice calls with a Waylo voice agent.

You add one route to your backend. It uses your API key to create a call session: a short-lived pass that lets one browser join one call. In the page, the SDK fetches that session, asks for the microphone, connects to your agent and plays its voice. It works with any front-end framework, or none.

**[Web SDK docs](https://docs.staging.app.waylovoice.ai/web-sdk)** · [Quickstart](https://docs.staging.app.waylovoice.ai/get-started/web-calls) · [API reference](https://docs.staging.app.waylovoice.ai/web-sdk/api) · [Example app](https://github.com/conversational-wayloai/client-sdk-web/tree/main/example) · [Changelog](https://github.com/conversational-wayloai/client-sdk-web/blob/main/packages/client/CHANGELOG.md)

## Requirements

- Recent Chrome, Edge, Firefox or Safari (desktop and mobile), on HTTPS or `localhost`.
- A bundler (Vite, esbuild, webpack…) for the page code.
- Node 20.6 or later for the backend example.
- A Waylo API key with the `sessions:write` scope (permission to create sessions) for your workspace. Keep it on your server.

## Install

```sh
npm install @waylovoice/client
```

Or `pnpm add @waylovoice/client`, or `yarn add @waylovoice/client`.

## Quickstart

### Add a session endpoint to your backend

The SDK never sees your API key. Add a route that checks the visitor's login, creates a session with the Waylo API and returns the response unchanged. This example uses Express; any framework works the same way:

```ts
import express from 'express';

const { WAYLO_API_URL, WAYLO_API_KEY, WORKSPACE_ID } = process.env;
const app = express();

app.post('/api/waylo/session', express.json(), async (request, response) => {
  const user = await findLoggedInUser(request); // your own login check

  if (!user) return response.status(401).json({ error: 'auth_required' });

  const { agentId, metadata } = request.body;

  // your own rule for who may use this agent
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

app.listen(3000);
```

Set these environment variables:

- `WAYLO_API_URL`: the Waylo API address. Ask the Waylo team for it.
- `WAYLO_API_KEY`: your API key.
- `WORKSPACE_ID`: the workspace that owns the agent.

The [session endpoint guide](https://docs.staging.app.waylovoice.ai/web-sdk/session-endpoint) covers every status code, retries and the session shape.

### Start a call from the page

Create a `WayloVoice`, listen for its events and start the call from a click:

```ts
import { WayloVoice } from '@waylovoice/client';

const wayloVoice = new WayloVoice({ sessionEndpoint: '/api/waylo/session' });

wayloVoice.on('state', state => console.log(state.stage));
wayloVoice.on('transcript', line => console.log(`${line.speaker}: ${line.text}`));

document.querySelector('#talk')?.addEventListener('click', () => {
  wayloVoice.start({ agentId: 'YOUR_AGENT_ID' }).catch(console.error);
});
document.querySelector('#hang-up')?.addEventListener('click', () => wayloVoice.stop());
```

Replace `YOUR_AGENT_ID` with your agent's ID. In the Waylo dashboard, go to **Build → Agents** and open the agent; the ID is the end of the page URL.

Click **Talk** and allow the microphone. The stage moves from `connecting` to `speaking` as the agent starts talking.

- Call `start()` from a click, so the browser lets the agent's audio play. It resolves once the agent is ready.
- One `WayloVoice` runs one call. Create a new one for the next call.
- You can call `stop()` at any time, even before the call connects.
- A transcript line arrives again with the same `id` as it grows. Update that line instead of adding a new one.

## What you can do

| Task | API | Guide |
| --- | --- | --- |
| Show call status | `on('state')`, `state.stage` | [Status line](https://docs.staging.app.waylovoice.ai/web-sdk/status) |
| Show live captions | `on('transcript')` | [Captions](https://docs.staging.app.waylovoice.ai/web-sdk/captions) |
| Mute, set volume, resume audio the browser blocked | `setMuted()`, `setVolume()`, `resumeAudio()` | [Controls](https://docs.staging.app.waylovoice.ai/web-sdk/controls) |
| Pick microphone and speaker | `WayloVoice.listDevices()`, `setMicrophoneDevice()`, `setSpeakerDevice()` | [Devices](https://docs.staging.app.waylovoice.ai/web-sdk/devices) |
| Measure how long a call takes to start | `state.timings` | [Timings](https://docs.staging.app.waylovoice.ai/web-sdk/timings) |
| Send your app's login token to your endpoint | `headers` option | [Start and stop options](https://docs.staging.app.waylovoice.ai/web-sdk/start-and-stop) |

## Errors

`start()` rejects with a `WayloVoiceError`; problems later in the call arrive as `error` events. Decide on `error.code`, never on the message:

```ts
import { WayloVoiceError } from '@waylovoice/client';

try {
  await wayloVoice.start({ agentId: 'YOUR_AGENT_ID' });
} catch (error) {
  if (error instanceof WayloVoiceError && error.code === 'MICROPHONE_DENIED') {
    alert('Allow the microphone in your browser, then try again.');
  } else {
    throw error;
  }
}
```

The most common codes are `MICROPHONE_DENIED`, `AUTH_REQUIRED`, `CONNECTION_FAILED` and `AGENT_TIMEOUT`. The [errors guide](https://docs.staging.app.waylovoice.ai/web-sdk/errors) lists every code, what to tell the visitor and whether to try again.

## For AI coding assistants

The package includes `llms.txt` (`node_modules/@waylovoice/client/llms.txt`): the full API and guides in one plain-text file.

## Security

- Your Waylo API key stays on your server. The browser only receives a short-lived session.
- In your session endpoint, check the visitor's login, their permission to use the agent and CSRF (another site making the visitor's browser call your endpoint).
- `metadata` comes from the browser, so forward only the keys you expect.
- Report security problems privately through [GitHub's vulnerability reporting](https://github.com/conversational-wayloai/client-sdk-web/security/advisories/new), not in a public issue.

## Support

- [Developer docs](https://docs.staging.app.waylovoice.ai/)
- [GitHub issues](https://github.com/conversational-wayloai/client-sdk-web/issues) for bugs and requests. Include the SDK version and browser. Never paste API keys or session data.

## Contributing

See [AGENTS.md](https://github.com/conversational-wayloai/client-sdk-web/blob/main/AGENTS.md) for the repository layout, commands and conventions, and [PUBLISHING.md](https://github.com/conversational-wayloai/client-sdk-web/blob/main/PUBLISHING.md) for releases.

## License

MIT. See [LICENSE](https://github.com/conversational-wayloai/client-sdk-web/blob/main/LICENSE).
