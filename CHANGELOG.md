# Changelog

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

Phase 3 and later have not been implemented.
