# mcp-ask-back

Portable TypeScript helpers for MCP tools that need one more customer detail. Original project code, licensed under Apache-2.0. This package is prepared for local packaging; it has not been published to npm.

```ts
import { needsInput, toToolResult } from '@claim-companion/mcp-ask-back';

const reply = needsInput({
  summary: 'I need one more detail.',
  data: {},
  missing: [{ field: 'when', priority: 1, question: 'When did it happen?' }],
});
return toToolResult(reply);
```

`needsInput` validates unique field names, nonempty questions and positive finite priorities, copies and stably sorts missing fields, and selects one `next_question`. `toToolResult` mirrors the summary in MCP text content and includes the complete envelope in structuredContent. Callers own their validation, safety rules, voice-safe summaries, operation keys and persistence. The helper makes no network/model calls and holds no session state.

`needs_input` is an application envelope, not a protocol-level elicitation request. It works through the repository's SDK v1 / 2025-11-25 tools/call path. Native 2026-07-28 MRTR (`input_required`, `inputRequests`, `inputResponses`) is not implemented by this package or negotiated by this server. That protocol is published, but requires an SDK v2 transport migration before this project can claim live support. See the [official SDK migration guidance](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28).

Build with `npm.cmd run build --workspace @claim-companion/mcp-ask-back`; test with the corresponding test script. `npm.cmd pack --dry-run --workspace @claim-companion/mcp-ask-back` checks package contents without publishing. The exported build includes JavaScript and declarations and has no runtime dependencies.
