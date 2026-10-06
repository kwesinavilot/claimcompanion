# Phase 3 — MCP claim-status integration

The Claim Companion MCP service runs independently from Svalinn. It exposes exactly one tool, get_claim_status, over POST /mcp using the official TypeScript SDK's stateless Streamable HTTP transport with JSON responses. Each request gets a new MCP server/transport; the HTTP client contains configuration only. There is no claim cache, insurer-store import, model call or write in the tool path.

The optional claim_id schema from the build spec is preserved, including additionalProperties: false. If omitted or blank, the result is needs_input with one question and no insurer request. No lookup or linked-claim state is invented. Svalinn stage, nextMove, nextStepSummary and openTasks are forwarded in structured data, along with claim identifiers, evidence and timeline. The short spoken summary is a fixed sentence based on nextMove, preventing arbitrary adjuster text or IDs from entering that summary.

Missing claims and upstream failures return status: error and MCP isError: true with a voice-safe summary; only error_code and correlation request_id are exposed. API credentials and raw upstream errors are never returned. Upstream calls time out after 350 ms; no synchronous retries occur. Svalinn requestId and HTTP status are logged for correlation.

This is a local Phase 3 checkpoint at http://127.0.0.1:3002/mcp, with loopback host checks and Inspector origins allowed. GET and DELETE return 405 because there are no SSE subscriptions or sessions. Public cloud deployment needs deployment/account configuration and is not part of this local checkpoint. Evidence state and the other tools remain unimplemented.

The built-in browser is unavailable in this tool session. SDK HTTP integration tests exercise separate Svalinn and MCP processes; the first MCP process is terminated before an adjuster task is added and a fresh MCP process reads the changed claim. MCP Inspector CLI provides the independent protocol check. The live smoke command creates one glass claim and a customer task in Svalinn; it opens separate SDK client connections before/after the task and prints measured tool-call times.

Official references: [SDK server and transport documentation](https://ts.sdk.modelcontextprotocol.io/server) and [MCP Inspector CLI](https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md). The installed SDK v1 protocol support is used; no support for a newer protocol is claimed.
