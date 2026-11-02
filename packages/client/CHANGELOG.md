# Changelog

## 0.1.1

First public release.

- `new WayloVoice({ sessionEndpoint })` starts a call with `start({ agentId })` and ends it with `stop()`; the session comes from your own backend.
- Live call state (`stage`, `connection`, `agent`, `microphone`, `network`, `playback`), transcripts and error codes.
- Reconnects after short network drops and ends the call with `CONNECTION_LOST` when it can't continue.
- Mute, agent volume, audio resume, microphone level, and microphone and speaker choice.
- Start timings for each step of the call.
- `llms.txt`, a one-file summary of the SDK for AI coding assistants.
