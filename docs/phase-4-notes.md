# Phase 4 — core MCP loop

The five core tools are now available at POST /mcp: report_incident, review_evidence, get_claim_status, confirm_and_submit_claim and request_photo_upload. The user approved the following choices on 2026-10-06 to fill gaps in the build specification.

- New reports and corrections require a stable operation key in tools/call params._meta["claim-companion/idempotency-key"]. A client generates a fresh key for a new operation and reuses it with the same arguments when retrying. This keeps the specified tool input schemas unchanged and makes Svalinn the sole owner of report-write idempotency. A missing key returns a safe error without writing.
- Safety runs first, before metadata checks or insurer calls. Explicit injuries or danger keywords pause intake with emergency guidance. A new report also pauses until anyone_injured is false. Corrections inherit the stored safety flag and recheck the merged narrative before writing. The deterministic scanner handles a small set of explicit negations; ambiguous keywords still pause conservatively. It is a demo safety gate, not a language-understanding model. Emergency language takes precedence even when unrelated tool arguments fail schema validation; the HTTP preflight forwards emergency-only arguments through the SDK. No LLM is called.
- LINKED_CUSTOMER_ID defaults to CUST_00234. A report starts with this external customer reference; Svalinn resolves its policy. Missing claim_type_code prompts for the incident category. Other missing questions are mapped from Svalinn's missingRequiredFields; there is no duplicate per-type required-field rule set in MCP. New reports return Svalinn's fnolId directly as intake_id.
- GET FNOL provides the latest read-back details. A complete draft returns ready_to_review. Submission requires confirmed:true, rechecks the stored safety state and linked customer, and promotes with Idempotency-Key equal to intake_id. False confirmation returns an error. Upstream business-rule errors remain errors, with safe summaries. The caller/orchestrator is responsible for obtaining the customer's explicit yes after read-back; Phase 4 does not implement voice.
- Post-submission corrections become idempotent Svalinn claim notes. A late replay of a pre-submission patch is checked through Svalinn first so it cannot accidentally create a new note. MCP never keeps report/claim copies or a routing map.
- Submission also creates a 30-minute upload session, keyed by submit:intake_id. A repeated successful submission returns the same claim and active link. If link creation fails or that session has expired, submission still returns submitted with upload_status: unavailable: the already-filed claim is not misreported as a failure.
- request_photo_upload validates the claim against Svalinn before creating evidence working state. A supplied metadata key creates/replays that upload operation; without one, the default operation is scoped to claim_id. Use a fresh metadata key to request a replacement for an expired/used link. Reusing a live operation returns its original link. Reusing an expired operation returns UPLOAD_LINK_EXPIRED, rather than silently changing a retry's result.
- The SQLite evidence store contains only tenant-scoped upload-session mappings, tokens, operation keys, timestamps and the used flag. It stores no claim narrative, draft fields, claim status or customer details. Tokens use 32 random bytes and expire after 30 minutes; get rejects expired or used tokens. Expired records remain as replay records in this local checkpoint; deletion/consumption and evidence-job processing belong to the Phase 6 portal/pipeline work. The SQLite file is ignored by Git. Node 24's built-in SQLite currently prints an experimental-feature notice.
- PHOTO_PORTAL_BASE_URL defaults to http://localhost:3003/upload. Link generation and the static checklist are implemented; the photo portal and processing pipeline are Phase 6 and are not running. review_evidence reads only Svalinn evidence and openTasks. It does not analyze images or use the upload-session store as an evidence source.
- A single 350 ms abort budget covers each multi-request report/submission operation; no model calls or synchronous retries are hidden inside the tool path. Local smoke timing is evidence for the current machine, not a cloud latency guarantee.

Run npm.cmd run smoke:core with both services running. It uses fetch with raw MCP JSON-RPC, not the SDK, to initialize, list tools, pause an unsafe report, create and correct a draft, reject false confirmation, promote twice, create/replay an upload link, review evidence and read status. Each run leaves one synthetic claim in Svalinn.

Example PowerShell raw tool call after initialize (change the operation key for a new report; keep it for retries):

```powershell
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"report_incident","arguments":{"claim_type_code":"MOTOR_GLASS","narrative":"The window is cracked.","anyone_injured":false},"_meta":{"claim-companion/idempotency-key":"demo-report-001"}}}' | curl.exe -sS http://127.0.0.1:3002/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2025-11-25' --data-binary '@-'
```

Inspector equivalent:

```powershell
node_modules\.bin\mcp-inspector.cmd --cli http://127.0.0.1:3002/mcp --transport http --method tools/call --tool-name report_incident --tool-arg 'claim_type_code=MOTOR_GLASS' 'narrative=The window is cracked.' 'anyone_injured=false' --tool-metadata 'claim-companion/idempotency-key=demo-report-001'
```

Official reference for the local store: [Node 24 SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). No new npm dependencies are needed for this phase. Git operations remain with the user; cloud deployment and later phases remain unimplemented.
