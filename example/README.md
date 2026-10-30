# Waylo voice example

A minimal web page that talks to a Waylo voice agent with `@waylovoice/client`. A small Node server keeps your API key and serves the session endpoint `POST /api/waylo/session`. The page creates one `WayloVoice` per call and starts it with the agent id; the SDK fetches the session itself.

It is a workspace member and uses the SDK through `workspace:*`. `pnpm test:pack` installs the packed tarball into a temporary copy of it to prove a real install works.

Using the SDK (one `WayloVoice` per call):

```ts
import { WayloVoice } from '@waylovoice/client';

const wayloVoice = new WayloVoice({ sessionEndpoint: '/api/waylo/session' });

wayloVoice.on('state', render);
wayloVoice.on('transcript', upsertRow);
await wayloVoice.start({ agentId }); // agentId comes from GET /api/example/agent
await wayloVoice.stop();
```

## Prerequisites

- Node.js 24 (see `.nvmrc`). The server uses `node --env-file`.
- pnpm, enabled with `corepack enable`.
- A Chromium-based browser and a microphone.

## Setup

1. Copy the env file: `cp example/.env.example example/.env` (then `chmod 600 example/.env`).
2. Fill in the values:

| Variable        | What it is                                                            |
| --------------- | --------------------------------------------------------------------- |
| `WAYLO_API_URL` | The Waylo API base URL.                                               |
| `WAYLO_API_KEY` | An API key with the `sessions:write` scope, pinned to your workspace. |
| `WORKSPACE_ID`  | The workspace that owns the agent.                                    |
| `AGENT_ID`      | The agent to talk to.                                                 |
| `HOST`, `PORT`  | Where the example server listens. Defaults: `127.0.0.1`, `5190`.      |

**Getting an API key.** An organization owner or admin creates one in the dashboard: go to **Integrations → API keys** and click **+ API key**. Under **Access** choose **Scoped** and set **Sessions** to **Write**, and pick your workspace. Copy the key when it is shown; it is not shown again. The same owner or admin can give you the workspace and agent IDs.

## Run

From the repository root:

```sh
pnpm install
pnpm build              # builds the SDK, then the example
cd example && pnpm start
```

Open http://127.0.0.1:5190 in Chrome.

While editing `src/main.ts`, run `pnpm dev:example` in a second terminal to rebuild on save. After changing the SDK, run `pnpm build` again.

## What you should see

1. Click **Talk**. The status shows **Calling the agent…**, then **The agent is joining…** and **The agent is getting ready…**.
2. The browser asks for the microphone. Allow it.
3. The agent greets you: the status shows **The agent is speaking**, then **Go ahead, I'm listening** and **Thinking…** as you talk. On a weak connection a grey line under it says so. Both sides appear as captions; grey lines are still changing.
4. **Mic level**, under **Microphone**, lights up as you speak and stays flat while muted. **Mute my mic**, **Agent volume**, **Microphone** and **Speaker** apply at once; the device lists fill in once the microphone is allowed, or before a call with **Show microphone names**. Browsers that can't choose the speaker show a note instead. **Tap to hear the agent** shows only when the browser blocks sound.
5. Once the agent is heard, **Start-up time** at the bottom shows how long that took after **Talk**, with each step as a bar on one timeline; steps can overlap.
6. Click **Hang up** (or say goodbye and let the agent end the call). A summary shows how the call ended, its length and the session id, and the microphone indicator turns off.

The event log at the bottom numbers each call, so a late event from an old call would stand out.

## How the server works

| Route | Does |
| --- | --- |
| `GET /api/example/agent` | Returns `{ agentId }`. The agent id is not secret. |
| `POST /api/waylo/session` | The session endpoint. `403` for any agent other than `AGENT_ID`, otherwise calls `POST /sessions/web` with the API key and returns the body unchanged with `Cache-Control: no-store`. |
| `GET /api/example/setup-error` | Returns the last `502` / `504` body with its developer `hint`, which the page shows under a failed call. Never the key or token. |

The example has no login. A real app checks its own user's login and access to the agent at the marked spot in `server.mjs`.

## Troubleshooting

Errors from the session endpoint (`POST /api/waylo/session`):

| Status | Error | What to do |
| --- | --- | --- |
| 400 | `invalid_request` | Send a JSON object with `agentId` and, optionally, a `metadata` object. |
| 403 | `access_denied` | The page asked for an agent other than `AGENT_ID`. |
| 415 | `json_required` | Send `Content-Type: application/json`. |
| 429 | `api_error` | The Waylo API is rate limiting. Wait and try again. |
| 500 | `internal_error` | Check the server terminal. |
| 502 | `api_error` | The Waylo API refused the request. The body's `upstreamStatus` and `hint`, and the terminal, say why. |
| 502 | `api_unreachable` | Check `WAYLO_API_URL` and your network. The terminal shows the cause. |
| 504 | `api_timeout` | The Waylo API did not answer within 10 seconds. Try again. |

Waylo API errors the terminal can show:

| Status | Likely cause |
| --- | --- |
| 401 | `WAYLO_API_KEY` is wrong or revoked. |
| 403 | The key lacks `sessions:write`. |
| 404 | `WORKSPACE_ID` or `AGENT_ID` is wrong, the agent is inactive, or the key is pinned to another workspace. |

Errors from the SDK (`WayloVoiceError.code`):

| Code | What to do |
| --- | --- |
| `AUTH_REQUIRED` | The session endpoint answered `401` or redirected. The example itself does not check login. |
| `ACCESS_DENIED` | The session endpoint answered `403`. The page asked for an agent the endpoint does not allow. |
| `LIMIT_REACHED` | The session endpoint answered `429`. Wait and try again. |
| `INVALID_SESSION` | Check that `/api/waylo/session` returns the Waylo API response unchanged. |
| `SESSION_EXPIRED` | The session expired. Click **Talk** again. |
| `CONNECTION_FAILED` | The session endpoint failed, could not be reached or did not answer within 15 s, or the call dropped. Check the server terminal and your network. |
| `MICROPHONE_DENIED` | Allow microphone access in the browser and try again. |
| `MICROPHONE_IN_USE` | Close other apps or tabs using the microphone, and try again. |
| `MICROPHONE_UNAVAILABLE` | Connect a microphone and try again. Mid-call, pick another microphone. The error's `cause` says what the browser reported. |
| `SPEAKER_UNAVAILABLE` | The chosen speaker is gone or this browser can't choose one; the current speaker keeps playing the agent. |
| `AGENT_TIMEOUT` | The agent didn't get ready in time. Try again. |
| `AGENT_LEFT` | The agent left the call without ending it. Click **Talk** to start a new one. |
| `AGENT_ERROR` | The agent hit an error and ended the call. `state.end.reason` says why, e.g. `worker_error`. |
| `TRANSCRIPT_FAILED` | One caption line could not be read. The call goes on. |
| `CANCELLED` | The call was stopped while it was starting. |
| `ALREADY_STARTED` | Each `WayloVoice` starts once. Create a new `WayloVoice` for each call. |

## Files

| File | Role |
| --- | --- |
| `server.mjs` | Your backend: `GET /api/example/agent` and the session endpoint `POST /api/waylo/session`. |
| `src/main.ts` | Your page code: starts and stops the call, shows its state and captions, and wires the controls. |
| `public/index.html` | The page markup. |
| `public/brand/` | Waylo logo and favicon, copied from the dashboard. |

## Security

- The API key stays on the server. Never send it to the browser.
- Every session costs money. Before you deploy, add your own login and access check to the session endpoint.
- The session endpoint only accepts JSON, so a plain cross-site form cannot start calls.
- The session response carries a call token. The server sends it with `cache-control: no-store` and never logs it. The page never sees it: only the SDK does.
