# Waylo voice example

A minimal web page that talks to a Waylo voice agent with `@waylovoice/client`. A small Node server keeps your API key and asks the Waylo API for a web session. The page creates one `new WayloVoice()` per call and passes that session to its `start()`.

It installs the SDK from the packed tarball, not from the source tree, to prove a real install works. It is its own pnpm project, outside the root workspace.

Using the SDK (one `WayloVoice` per call):

```ts
import { WayloVoice } from '@waylovoice/client';

const wayloVoice = new WayloVoice();

await wayloVoice.start(session); // the JSON from POST /talk
await wayloVoice.stop();
```

## Prerequisites

- Node.js 24 (see `.nvmrc`). The server uses `node --env-file`.
- pnpm, enabled with `corepack enable`.
- A Chromium-based browser and a microphone.

## Setup

1. Copy the env file: `cp example/.env.example example/.env` (then `chmod 600 example/.env`).
2. Fill in the values:

| Variable        | What it is                                                             |
| --------------- | ---------------------------------------------------------------------- |
| `WAYLO_API_URL` | The Waylo API base URL.                                                |
| `WAYLO_API_KEY` | An API key with the `sessions:create` scope, pinned to your workspace. |
| `WORKSPACE_ID`  | The workspace that owns the agent.                                     |
| `AGENT_ID`      | The agent to talk to.                                                  |
| `HOST`, `PORT`  | Where the example server listens. Defaults: `127.0.0.1`, `5190`.       |

**Getting an API key.** There is no dashboard page for API keys yet. An organization owner or admin creates one through the API reference at `/docs` on your Waylo API URL: call `POST /api-keys` with the `sessions:create` scope and your workspace. Copy the key when it is shown; it is not shown again. The same owner or admin can give you the workspace and agent IDs.

## Run

From the repository root:

```sh
pnpm install
pnpm build
pnpm pack:client        # writes packages/client/waylovoice-client-0.1.0.tgz
pnpm install:example
pnpm build:example
cd example && pnpm start
```

Open http://127.0.0.1:5190 in Chrome.

While editing `src/main.ts`, run `pnpm dev:example` in a second terminal to rebuild on save. After changing the SDK, run `pnpm pack:client` and `pnpm install:example` again.

## What you should see

1. Click **Talk**. The status goes from `requesting session` to `connecting`.
2. The browser asks for the microphone. Allow it.
3. The status shows `connected, agent joined` and the assistant greets you.
4. Click **Hang up**. The browser's microphone indicator turns off.

## Troubleshooting

Errors from the example server (`POST /talk`):

| Status | Error | What to do |
| --- | --- | --- |
| 400 | `attempt_id_required` | Send a JSON body with an `attemptId`. |
| 400 | `invalid_attempt_id` | `attemptId` must be a UUID, e.g. from `crypto.randomUUID()`. |
| 415 | `json_required` | Send `Content-Type: application/json`. |
| 500 | `internal_error` | Check the server terminal. |
| 502 | `api_unreachable` | Check `WAYLO_API_URL` and your network. The terminal shows the cause. |
| 504 | `api_timeout` | The Waylo API did not answer within 10 seconds. Try again. |

Errors from the Waylo API, passed through unchanged:

| Status | Likely cause                                                                   |
| ------ | ------------------------------------------------------------------------------ |
| 401    | `WAYLO_API_KEY` is wrong or revoked.                                           |
| 403    | The key lacks `sessions:create` or is pinned to a different workspace.         |
| 404    | `WORKSPACE_ID` or `AGENT_ID` is wrong.                                         |
| 409    | The same `attemptId` was reused for a different request. Click **Talk** again. |

Errors from the SDK (`WayloVoiceError.code`):

| Code | What to do |
| --- | --- |
| `microphone_denied` | Allow microphone access in the browser and try again. |
| `microphone_unavailable` | Connect a microphone, close other apps using it, and try again. |
| `session_expired` | The session expired. Click **Talk** again. |
| `agent_timeout` | The assistant didn't join in time. Try again. |
| `connection_failed` | Check your network and try again. |
| `agent_left` | The assistant ended the call. Click **Talk** to start a new one. |
| `cancelled` | The call was stopped while it was starting. |
| `already_started` | Each `WayloVoice` starts once. Create a new `WayloVoice` for each call. |
| `invalid_session` | Check that `/talk` returns the Waylo API response unchanged. |

## Files

| File                | Role                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `server.mjs`        | Your backend route: `POST /talk` creates a Waylo session.         |
| `src/main.ts`       | Your page code: fetches `/talk` and starts the call with the SDK. |
| `public/index.html` | The page markup.                                                  |

## Security

- The API key stays on the server. Never send it to the browser.
- `/talk` has no authentication. In a real app, check your own user's login before creating a Waylo session: every session costs money.
- The session response carries a call token. The server sends it with `cache-control: no-store`.
