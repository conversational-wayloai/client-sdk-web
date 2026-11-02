# Publishing

Publishing a GitHub release runs [`release.yml`](.github/workflows/release.yml), which checks the code and publishes `@waylovoice/client` to npm. npm trusts this repository and workflow directly, so no npm token is stored.

## Release a version

1. In a pull request, set `version` in `packages/client/package.json` and add its entry to `packages/client/CHANGELOG.md`.
2. Run `pnpm validate` and `pnpm test:pack`. Then run `pnpm pack:client` and `tar tzf packages/client/waylovoice-client-<version>.tgz`, and check the file list: `dist`, `llms.txt`, `README.md`, `LICENSE` and `package.json`.
3. Merge the pull request.
4. On GitHub, create a release from `main` with the tag `v<version>` (for example `v0.1.2`) and the changelog entry as its notes.

The `verify` job fails if the tag does not match the package version. A version with a suffix (`0.2.0-beta.1`) must be marked as a pre-release and is published under the `next` tag, so `pnpm add @waylovoice/client` never installs it. If npm already has the version, the `publish` job is skipped.

If publishing fails after the release is created, fix the cause and re-run the failed jobs.

## One-time setup

- npm links a trusted publisher only to a package that already exists, so the first version was published by hand with `pnpm --dir packages/client publish`.
- On npmjs.com, the `@waylovoice/client` package settings list a trusted publisher: GitHub Actions, organization `conversational-wayloai`, repository `client-sdk-web`, workflow `release.yml`, environment `npm`.
- The `publish` job runs in the `npm` GitHub environment. Add required reviewers there to approve each publish.
- Trusted publishing needs GitHub-hosted runners, so `release.yml` does not use the `CI_RUNNER` variable.
