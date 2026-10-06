# Claim Companion

Voice-first car-insurance claims assistant for an Amazon hackathon. Svalinn is an original fictional insurer backend; all demo data is synthetic.

Version 0.2.0 completes Phases 1–2: the standalone TypeScript/Fastify Svalinn service with customer resolution, FNOL drafts and promotion, claim reads, documents, notes and mock adjuster actions. The remaining directories are scaffolding for later phases.

Read [the build spec](docs/codex-build-spec.md), then [the API contract](docs/svalinn-insurance-api-spec.md). [Design v3](docs/claims-concierge-design-v3.md) provides background. Spec ambiguities and build issues are tracked in [the friction log](docs/friction-log.md).

Requires Node.js 24 and npm. From the repository root, run `npm.cmd install`, `npm.cmd run build`, `npm.cmd test`, then `npm.cmd run dev` on Windows (`npm` elsewhere). The service listens at http://127.0.0.1:3001. `npm.cmd run start --workspace @claim-companion/svalinn-api` runs the compiled build.

Local credentials are in the ignored `services/svalinn-api/.env`. For a fresh checkout, copy `.env.example` to `.env` and replace both key placeholders with independently generated random strings. Do not use the literal spec keys. The service requires both keys. All FNOLs, claims, files, notes, tasks and idempotency records live in memory and reset on service restart; seed data reloads at startup.

Verify from PowerShell (use `curl.exe` to avoid the PowerShell curl alias):

```powershell
$config = Get-Content services/svalinn-api/.env | ConvertFrom-StringData
curl.exe -i http://127.0.0.1:3001/v1/claim-types -H "Authorization: ApiKey $($config.SVALINN_US_API_KEY)" -H "X-Svalinn-Tenant: TEN_001"
'{"externalCustomerId":"CUST_00234"}' | curl.exe -i http://127.0.0.1:3001/v1/customers/resolve -H "Authorization: ApiKey $($config.SVALINN_US_API_KEY)" -H "X-Svalinn-Tenant: TEN_001" -H "Content-Type: application/json" --data-binary '@-'
'{"phone":"+233245550192","policyNumber":"SV-GH-AUTO-2026-2201"}' | curl.exe -i http://127.0.0.1:3001/v1/customers/resolve -H "Authorization: ApiKey $($config.SVALINN_GH_API_KEY)" -H "X-Svalinn-Tenant: TEN_002" -H "Content-Type: application/json" --data-binary '@-'
```

Expect HTTP 200, five claim types, Jordan Reyes, and Ama Boateng respectively; each response includes requestId and rate-limit headers. Stop the server with Ctrl+C when running it yourself.

With the server running, run `npm.cmd run smoke` in another terminal. This executes separate real curl processes to create and correct a draft, read it, promote it twice, upload a generated PNG twice, add a note, change stage, create an adjuster task, and read the resulting claim. It asserts one claim/document, with the adjuster's task reflected in the later status response. Each run uses fresh idempotency keys and leaves one demo claim in the running mock.

Every write requires an `Idempotency-Key` header; customer resolution is a read-only lookup and remains exempt. Use the same key and body when retrying an operation. JSON field order and multipart boundary/order do not affect replays. A different body with the same key for the same tenant/method/path returns 409. Uploads require one nonempty image/PDF (maximum 10 MiB), kind and optional label. See [Phase 2 contract decisions](docs/phase-2-contract-decisions.md) for response and mock-stage rules chosen with the user's delegated discretion. Safety checks and voice behavior belong to the MCP/orchestrator phases; no LLM is called by this backend.

Git commits and remote syncing are handled by the user. The current checkpoint is version 0.2.0; see [CHANGELOG.md](CHANGELOG.md).

The application and Svalinn contract are original project work; Fastify, TypeScript, tsx, and Node types are third-party dependencies. Licensed under Apache-2.0.
