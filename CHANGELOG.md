# Changelog

## 0.5.0 — 2026-10-06

- Add React voice simulator, typed fallback, speech output and real MCP inspector.
- Add Bedrock Converse tool-selection adapter and explicitly labeled local demo interpreter.
- Gate intake on safety and consent; refresh readback before host-authorized submission.
- Preserve stable message keys for retries and support a fresh conversation with an existing claim.
- Add orchestrator tests and headless Chrome workflow verification.

Live Bedrock and physical microphone acceptance remain pending; Phase 6 is not started.


## 0.4.0 — 2026-10-06

- Implement report_incident, review_evidence, confirm_and_submit_claim and request_photo_upload alongside get_claim_status.
- Run deterministic injury/danger checks before insurer calls, and require an explicit safe response before intake.
- Keep claim state in Svalinn, derive missing questions from its requirements, and route filed-claim corrections to idempotent notes.
- Require stable report operation keys in MCP metadata; reuse promotion results and active upload links on retries.
- Add a SQLite upload-session store with random tokens and thirty-minute expiration.
- Add safety/token unit tests, per-tool SDK contracts, raw JSON-RPC smoke verification and Inspector checks.

Photo portal, voice simulator and image processing remain for later phases.

## 0.3.0 — 2026-10-06

- Add a standalone local MCP Streamable HTTP service with get_claim_status using the official SDK.
- Read and validate Svalinn responses over HTTP without storing claim state or calling a model.
- Preserve the optional claim_id schema and return needs_input on omission, plus safe upstream error results.
- Add SDK contract tests across real service processes, including a full MCP restart, and a live smoke command.
- Verify tool listing and a real claim-status call with MCP Inspector CLI; add run/Inspector instructions.

Phase 4 and later remain unimplemented. This checkpoint is local; cloud deployment is not configured.

## 0.2.0 — 2026-10-06

- Complete Svalinn Phase 2: FNOL drafts, corrections, promotion, claim reads, multipart document storage, notes and mock adjuster actions.
- Require tenant-scoped idempotency on every write, preserving original results and rejecting changed-body replays.
- Add lifecycle/tenant/upload contract tests and a repeatable live curl smoke command.
- Document delegated contract decisions and in-memory restart behavior.

## 0.1.0 — 2026-10-06

- Scaffold the Claim Companion repository and canonical spec documents.
- Implement the standalone Svalinn API Phase 1: claim types and customer resolution.
- Seed five synthetic customers across two authenticated tenants.
- Add JSON envelopes, request IDs, validation, tenant isolation, and sandbox rate limiting.
- Verify TypeScript build, contract tests, and live HTTP curl requests.
