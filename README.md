# Waylo Voice web SDK

`@waylovoice/client` connects a web page to a Waylo voice agent. Your backend creates a call session with the Waylo API; the page hands that session to the SDK, which joins the call, turns on the microphone and plays the agent's voice. It is framework-free TypeScript and works with any front end.

## Requirements

- Browsers: recent Chrome, Edge, Firefox and Safari (desktop and mobile) with microphone access over HTTPS or `localhost` (browser coverage is not yet tested beyond Chrome).
- Developing this repository or the example: Node 24 and pnpm, pinned in `.nvmrc` and `package.json` `packageManager`.

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

**1. On your backend**, create a web session with an API key that has the `sessions:create` scope, and return the response to your page unchanged:

```ts
const response = await fetch(`${WAYLO_API_URL}/sessions/web`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${WAYLO_API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({ workspaceId: WORKSPACE_ID, agentId: AGENT_ID }),
});

// Forward status and body to the browser as is, with `cache-control: no-store`.
```

**2. In the browser**, create one `WayloVoice` per call and pass it that session:

```ts
import { WayloVoice } from '@waylovoice/client';

const session = await fetch('/your-session-route', { method: 'POST' }).then(r => r.json());

const wayloVoice = new WayloVoice();

await wayloVoice.start(session);
// ...
await wayloVoice.stop();
```

Call `start()` from a click handler so the browser allows audio playback. A `WayloVoice` starts once; create a new one for the next call.

## Errors

`start()` rejects with a `WayloVoiceError`. Branch on its `code` (`microphone_denied`, `session_expired`, `connection_failed`, …), never on the message. The troubleshooting section of the [example README](example/README.md) lists every code and what to do about it.

## Example

[`example/`](example/) is a minimal page and Node server that make a real call. Its [README](example/README.md) covers setup and running it.

## Security

- Your Waylo API key stays on your server. Never send it to the browser.
- Check your own user's login before creating a Waylo session: every session costs money.
- The session response carries a short-lived call token. Do not cache or log it.

## Development

See [AGENTS.md](AGENTS.md) for the repository layout, commands and conventions.

### Git hooks

`pnpm install` installs a pre-commit hook with husky. It runs `repo-tools check-remote`, `pnpm typecheck` and `lint-staged`, which runs ESLint and Prettier on staged files and the tests related to them.

## License

Not yet licensed.
