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

Call `start()` from a click handler so the browser allows audio playback. A `WayloVoice` starts once; create a new one for the next call.

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
| `agentTimeoutMs` | Optional. How long `start()` waits for the agent to join. Default 20000. |

## Your session endpoint

You build this route on your own backend. It checks your own login, then creates a session with the Waylo API using an API key that has the `sessions:create` scope and is pinned to your workspace. The key never leaves your server.

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

`start()` rejects with a `WayloVoiceError`. Branch on its `code`, never on the message. The codes are:

`AUTH_REQUIRED`, `ACCESS_DENIED`, `LIMIT_REACHED`, `INVALID_SESSION`, `SESSION_EXPIRED`, `CONNECTION_FAILED`, `MICROPHONE_DENIED`, `MICROPHONE_UNAVAILABLE`, `AGENT_TIMEOUT`, `AGENT_LEFT`, `ALREADY_STARTED`, `CANCELLED`.

The troubleshooting section of the [example README](example/README.md) says what to do about each one.

## Example

[`example/`](example/) is a minimal page and Node server that make a real call. Its [README](example/README.md) covers setup and running it.

## Security

- Your Waylo API key stays on your server.
- In your session endpoint, check the user's login, their permission to use the agent and CSRF. `metadata` comes from the browser, so forward only the keys you expect.

## Development

See [AGENTS.md](AGENTS.md) for the repository layout, commands and conventions.

## License

Not yet licensed.
