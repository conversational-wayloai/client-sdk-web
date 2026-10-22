# AGENTS.md

Rules for this repository: the Waylo Voice AI browser SDK, published as `@waylovoice/client`. It is framework-free TypeScript on top of `livekit-client`. One `WayloVoice` instance runs one call. The host page calls `start({ agentId })`; the SDK posts to the host's own `sessionEndpoint`, whose backend checks its login, calls `POST /sessions/web` with its API key and returns that response unchanged.

## Before writing code

- Before adding a helper, type or constant, search `packages/client/src` for an existing one and extend it.
- Follow the structure of the nearest existing file of the same kind (module, spec, fake).
- Verify `livekit-client` signatures against the installed version before calling them.
- Do not invent Waylo API behavior; ask, or check the API's published documentation.

## Layout

- `packages/client` — the SDK. `src/` is the code, `test/` mirrors it, `test/__setup__/` holds the shared LiveKit mock, fakes and fixtures.
- `example/` — a minimal page and Node server that install the SDK from the packed tarball. Its own pnpm project, outside the workspace. See [example/README.md](example/README.md).
- `.github/workflows/ci.yml` — builds, packs, validates, and type-checks and builds the example against the tarball.

## Tooling

- Use pnpm. Never npm, never yarn.
- Node 24 and pnpm are pinned in `.nvmrc` and `package.json` `packageManager`. Do not bump either as a side effect of another change.
- `pnpm lint` runs ESLint with `--fix` and rewrites files. Commit what it changed — CI runs `git diff --exit-code` after it.
- `pnpm format` runs Prettier over non-code files (`.yml`, `.json`, `.md`, `.css`, `.html`). `pnpm validate` checks it.
- New dependencies need approval before installing: ask before `pnpm add` or a new `package.json` entry. Shared versions go in the `pnpm-workspace.yaml` catalog.

## Commands

| Command | Does |
| --- | --- |
| `pnpm install` | Install the workspace |
| `pnpm validate` | Format check, then lint, typecheck and tests with coverage for the SDK, then lint the example |
| `pnpm -r build` | Build the SDK into `packages/client/dist` |
| `pnpm -r test` | Run the SDK tests |
| `pnpm pack:client` | Pack the SDK into `packages/client/waylovoice-client-<version>.tgz` |
| `pnpm install:example` | Install the example against the packed tarball |
| `pnpm build:example` / `pnpm dev:example` | Build the example once / on save |
| `pnpm lint:example` / `pnpm typecheck:example` | Lint / type-check the example |

After changing the SDK, run `pnpm build`, `pnpm pack:client` and `pnpm install:example` before checking the example.

## Testing

- Before reporting a change as done: `pnpm format`, then `pnpm validate`.
- A full-run failure in a file the change does not touch: re-run that file alone, once. It passes → report it as a flake and stop. It fails → it is real.
- While iterating, run the affected spec file (`pnpm --dir packages/client exec vitest run <file>`), not the suite.
- Tests mirror `src/`: `src/session.ts` → `test/session.spec.ts`; a large class gets a folder (`test/waylo-voice/start.spec.ts`).
- `describe` names the unit; `it` states the behavior in the present tense (`it('rejects an expired session')`).
- Use the shared LiveKit mock and fakes in `test/__setup__/`. Do not mock `livekit-client` again in a spec.
- Public types are pinned in `test/index.spec-d.ts`.
- Coverage floor is 85% for branches, functions, lines and statements. Do not lower it.

## Code

- Sealed box: never import from the application repository or any `@wayloai/*` package. A value copied from the Waylo API (a field, an enum, an end reason) names its source in a comment and has a test that pins it.
- The public API is what `src/index.ts` exports. Any change to it needs a type test. Once released, a change to it is breaking.
- No tokens, keys or other secrets in error messages, logs or thrown values. `WayloVoiceError` redacts them; keep it that way.
- Class state is `#private`, not TypeScript `private`.
- Verbs mean one thing:
  - `find*` returns the value or `undefined`, never throws.
  - `require*` returns the value or throws.
  - `is*` / `has*` are predicates.
  - `read*` pulls a value off untrusted input and returns `null` when off-contract.
  - `to*` maps between shapes.
- Minimal comments. Code explains what; a comment only explains a why the code cannot.
- No internal hostnames, machine-specific paths or environment details in code, tests or docs.

## Commits

- Subject: imperative, sentence case, 72 characters or less, no trailing period. No ticket ID in the subject.
- A body only when the why is not obvious.
- No trailers and no AI footers.
- Verify behavior changes with a real call in `example/` before reporting them done.
- A change to the public API, an error code or setup updates `README.md` and `example/README.md` in the same commit.
- Every commit passes `pnpm validate` on its own. Pull requests are rebase-merged, so each commit lands on `main` as is.
- Never push to or merge into `main`. Open a pull request.
- Branches: `feat/way-NNN-slug` or `fix/way-NNN-slug`. Pull request title: `WAY-NNN: Title`.

## Secrets

- No keys, tokens or credentials in code or commits.
- The example declares its variables in `example/.env.example`. Never commit `example/.env`.
- A Waylo API key never reaches the browser. The SDK only ever receives the session response, and never exposes its connection details to the host page.
