# Phase 8 checkpoint (in progress)

Three MCP Apps resources expose intake review, evidence checklist with upload QR code, and status timeline. Existing five tools advertise their view URI; their schemas remain unchanged. The simulator uses the official AppBridge and a scripts-only sandboxed iframe. Views are bundled without external assets, have a restrictive CSP, and accept facts from tool results. Approved button messages re-enter the ordinary safety, consent and confirmation flow. The host permits only the upload link present in the current tool result and tears down old views.

`packages/mcp-ask-back` is an Apache-2.0 TypeScript package providing validated, ordered `needs_input` envelopes and tool results. Its build, two tests and npm pack dry-run pass. It has not been published.

Compatibility: ext-apps 1.7.5 supports the installed MCP SDK v1. Native multi-round tool requests exist in the published 2026-07-28 protocol, but this SDK supports 2025-11-25. The portable helper does not claim native multi-round support. See the [official SDK migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28).

## Pending specification decisions

Canonical build-spec sections 5.6–5.8 omit input/output schemas. Awaiting the user's answer on minimal strict contracts for fictional shops and simulated booking, Svalinn notes for claim-linked callbacks, and log-only pre-claim callback acknowledgements. Those tools are not implemented. No booking database or second claims store has been added.

Phase 8 is not complete. The repository version remains 0.7.0 until the remaining tools and checks are completed. AWS verification and physical microphone testing remain pending as documented in earlier phases. Git operations remain user-managed.

## Verification

All seven workspace builds pass. All 20 automated tests pass (the corrected MCP suite was rerun after the full workspace run). Chrome smoke passes real iframe confirmation, evidence QR rendering, scripts-only sandbox, status fullscreen, fresh conversation status, responsive layout and no JavaScript page errors. `npm pack --dry-run --workspace @claim-companion/mcp-ask-back --cache .local/npm-cache` verifies five publishable package files without publishing.

The browser check exposed two bugs now corrected: replacement-string interpolation corrupted bundled HTML, and a multi-tool turn displayed the first result rather than the latest result. The resource test covers template duplication; the browser smoke covers confirmation followed by the evidence view.
