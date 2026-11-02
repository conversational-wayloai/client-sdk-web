# Changelog

All notable changes to `@waylovoice/client` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-02

First public release.

### Added

- `new WayloVoice({ sessionEndpoint })` starts a call with `start({ agentId })` and ends it with `stop()`; the session comes from your own backend.
- Live call state (`stage`, `connection`, `agent`, `microphone`, `network`, `playback`), transcripts and error codes.
- Reconnects after short network drops, and ends the call with `CONNECTION_LOST` when it can't continue.
- Mute, agent volume, audio resume, microphone level, and microphone and speaker choice.
- Start timings for each step of the call.
- `llms.txt`, a one-file summary of the SDK for AI coding assistants.

[Unreleased]: https://github.com/conversational-wayloai/client-sdk-web/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/conversational-wayloai/client-sdk-web/releases/tag/v0.1.1
