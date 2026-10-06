# Claim Companion

Voice-first car-insurance claims assistant for an Amazon hackathon. Svalinn is an original fictional insurer backend; all demo data is synthetic.

Version 0.7.0 adds the Svalinn adjuster console and the cross-session information-request demo. Voice, photos and adjuster actions use real MCP/Svalinn state locally; cloud AI and deployment remain pending. See [Phase 7 notes](docs/phase-7-notes.md) and [AWS setup](docs/aws-setup.md).

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

To run MCP, configure `services/mcp-server/.env` using `.env.example`: set SVALINN_API_BASE_URL to the running Svalinn /v1 URL, SVALINN_API_KEY to the local US key, and SVALINN_TENANT_ID to TEN_001. The current workspace already has an ignored local configuration. Keep Svalinn running, then run `npm.cmd run dev:mcp` in a second terminal. MCP listens at http://127.0.0.1:3002/mcp.

Run `npm.cmd run smoke:mcp` in a third terminal. It creates a glass claim through Svalinn HTTP, reads status via the SDK, adds an adjuster task, then reads the task through a new client connection. It prints the claim_id and measured call times. `npm.cmd test` also proves the changed task survives a full MCP process restart while Svalinn stays running.

Verify independently through Inspector (set $claimId to the value printed by smoke:mcp):

```powershell
node_modules\.bin\mcp-inspector.cmd --cli http://127.0.0.1:3002/mcp --transport http --method tools/list
node_modules\.bin\mcp-inspector.cmd --cli http://127.0.0.1:3002/mcp --transport http --method tools/call --tool-name get_claim_status --tool-arg "claim_id=$claimId"
```

For the Inspector web interface, run `node_modules\.bin\mcp-inspector.cmd --web` and connect using Streamable HTTP to the same /mcp URL. The agent had no built-in browser capability; verification used Inspector CLI and SDK clients. [Phase 3 notes](docs/phase-3-notes.md) describe the local-only hosting and protocol scope. Missing claim_id returns needs_input; missing claims and backend failures return safe error results. There is no MCP claim cache or LLM call.

Run `npm.cmd run smoke:core` with both services running to exercise all five tools using raw MCP JSON-RPC. This verifies safety pauses, missing-field questions, read-back readiness, explicit confirmation, write retries and upload-link generation. See [Phase 4 notes](docs/phase-4-notes.md) for raw curl and Inspector examples and the approved contract choices.

New report/correction calls require `_meta["claim-companion/idempotency-key"]` in tools/call params, outside arguments. Generate a fresh key per operation and reuse it for retries. Submission uses intake_id as its insurer key. New intake requires anyone_injured:false; injury/danger pauses before any insurer call. The linked demo customer defaults to CUST_00234. The shared evidence SQLite file contains upload sessions, batch replay receipts and temporary photo jobs; all claim state stays in Svalinn. Restarting MCP preserves file-backed upload sessions. Set EVIDENCE_DB_PATH and PHOTO_PORTAL_BASE_URL in the service environment to change local settings.

Upload tokens expire after thirty minutes. Start the Phase 6 portal with `npm.cmd run dev:photos` to serve upload links on port 3003; quality checks run asynchronously and usable originals reach Svalinn. The voice UI is available; cloud deployment remains unconfigured.

Git commits and remote syncing are handled by the user. The current checkpoint is version 0.7.0; see [CHANGELOG.md](CHANGELOG.md).

The application and Svalinn contract are original project work; Fastify, TypeScript, tsx, and Node types are third-party dependencies. Licensed under Apache-2.0.

Start the simulator with `npm.cmd run dev:echo` while Svalinn and MCP are running, then open http://127.0.0.1:5173. Run `npm.cmd run smoke:ui` for headless Chrome verification. Start photo uploading with `npm.cmd run dev:photos`; verify with `npm.cmd run smoke:photos`. The local flow is implemented; physical phone and AWS checks remain pending.

Start the adjuster console with `npm.cmd run dev:adjuster` and open http://127.0.0.1:3006. Copy a filed claim ID from the simulator, open it here, and click **Request more info**. A fresh voice conversation then reads that task from Svalinn. Verify with `npm.cmd run smoke:remembered` while Svalinn, MCP, echo-sim and the console are running.
