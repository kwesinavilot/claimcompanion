# Claim Companion — Build Spec (for Codex / agentic build)

**Read this file first.** It tells you what to build and in what order. For full rationale, UX dialogues, and the hackathon context, read `claims-concierge-design-v2.md`. For the insurer backend's exact API contract, read `svalinn-insurance-api-spec.md`. This file does not repeat either — it tells you how to turn both into working code.

---

## 0. The one-sentence product

A voice assistant (Alexa+, simulated for the demo) that lets someone report a car accident, lets their phone handle photos, and answers "how's my claim going" — talking to a separate mock insurer API (Svalinn) the same way it would talk to a real one.

## 1. Non-negotiable rules — do not violate these while building

1. **No LLM call inside an MCP tool's synchronous path.** Tools read/write fast state (Svalinn, or our own small store) and return in well under 500ms. Anything that needs a model (damage reading, summarization) happens async, in the evidence pipeline, never inside a `tools/call` response.
2. **The MCP server is stateless.** It holds no claim data of its own — Svalinn's FNOL/claim resources are the state store (see §4). The only state our server owns is short-lived evidence-processing data (§6).
3. **Svalinn is a separate, independently running service**, called over HTTP with an API key + tenant header, exactly as documented in `svalinn-insurance-api-spec.md`. Never import its code or database directly into the MCP server — that would defeat the point of building it as a real integration.
4. **No real insurer code, data, or API contracts anywhere in this repo.** Everything insurer-shaped is the invented Svalinn API. No employer names, formats, or screenshots.
5. **Safety before paperwork**, every time, no exceptions: injury/danger language pauses intake before any other question.
6. **The assistant never states coverage, fault, cost, or a denial.** Not in a prompt, not in a fallback string, not in test fixtures.
7. **Every write is idempotent.** Submitting a claim twice with the same key must never create two claims.

---

## 2. Repo layout

```text
claim-companion/
├─ README.md
├─ LICENSE                        # Apache-2.0
├─ docs/
│  ├─ claims-concierge-design-v2.md
│  ├─ svalinn-insurance-api-spec.md
│  ├─ codex-build-spec.md         # this file
│  └─ friction-log.md             # start on day one, one line per stumble
├─ services/
│  ├─ svalinn-api/                # the mock insurer — build this FIRST
│  │  ├─ src/
│  │  │  ├─ routes/                # fnols, claims, customers, documents, notes, _mock
│  │  │  ├─ store/                 # seed data + in-memory or SQLite persistence
│  │  │  └─ server.ts
│  │  └─ seed/                     # the two tenants from the API spec §9
│  ├─ mcp-server/                  # Claim Companion itself — the real product
│  │  ├─ src/
│  │  │  ├─ tools/                 # one file per tool, see §5
│  │  │  ├─ svalinn-client.ts      # typed HTTP client for the Svalinn API
│  │  │  ├─ evidence-store.ts      # the one small piece of state we DO own, see §6
│  │  │  └─ server.ts              # Streamable HTTP endpoint
│  │  └─ apps/                     # the 3 MCP Apps views (ui:// resources)
│  ├─ evidence-pipeline/           # Lambda workers: quality, OCR, damage read
│  └─ adjuster-console/            # small React page, calls Svalinn's /v1/_mock endpoints
├─ apps/
│  ├─ echo-sim/                    # the demo "stage" — orchestrator + mic/speech + MCP inspector panel
│  └─ photo-portal/                # mobile upload page
├─ infra/                          # CDK: one stack per deployable piece
├─ evals/                          # scenario suite + scoring script
└─ packages/
   └─ mcp-ask-back/                # the Open Source deliverable — build only after MVP works
```

---

## 3. Stack (already decided — don't re-litigate)

| Piece | Stack |
|---|---|
| Language | TypeScript everywhere |
| `svalinn-api` | Fastify, in-memory store or SQLite — it's a mock, keep it small |
| `mcp-server` | Official MCP TypeScript SDK, Streamable HTTP, Lambda + API Gateway (or local Node for dev) |
| `evidence-pipeline` | Step Functions + Lambda, S3, Rekognition (text detection), Bedrock (damage read) |
| `echo-sim` | Vite + React, Web Speech API, Bedrock-backed orchestrator agent |
| `adjuster-console` | Vite + React, calls `svalinn-api` directly |
| IaC | AWS CDK (TypeScript) |

---

## 4. How the MCP server and Svalinn fit together

The MCP server does **not** keep its own copy of claim state. It is a thin translation layer:

```text
Alexa+ / orchestrator  →  MCP tool call  →  mcp-server  →  HTTP  →  svalinn-api  →  response back up the chain
```

Use the mapping table in `svalinn-insurance-api-spec.md` §1 as the source of truth for which tool calls which endpoint. The one ID to understand: **`intake_id` in our tool schemas IS Svalinn's `fnolId`.** Don't invent a second ID and a mapping table between them — that's needless state. Once promoted, `claim_id` is Svalinn's `claimId`.

---

## 5. The 8 MCP tools — complete schemas

Build in this order: **1 → 5 → 2 → 3 → 4, then 6/7/8 last (they're stretch, see §8).**

Response envelope (every tool, same shape):

```ts
type ToolResult<T> = {
  status: "ok" | "needs_input" | "ready_to_review" | "submitted" | "error";
  summary: string;              // <=2 sentences, no IDs, voice-safe
  data: T;
  missing?: { field: string; priority: number; question: string }[];
  next_question?: string;
  safety?: { level: "none" | "check_needed" | "emergency"; guidance?: string };
};
```

### 5.1 `report_incident` (P0 — build first)

```json
{
  "name": "report_incident",
  "description": "Call when the customer describes an accident or adds/corrects a detail, before or after filing. Returns what's still missing or that it's ready to review.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "intake_id": { "type": "string", "description": "Omit to start a new report." },
      "claim_type_code": { "type": "string", "enum": ["MOTOR_COLLISION", "MOTOR_HIT_AND_RUN", "MOTOR_THEFT", "MOTOR_GLASS", "MOTOR_WEATHER"] },
      "narrative": { "type": "string" },
      "occurred_at": { "type": "string", "format": "date-time" },
      "date_confidence": { "type": "string", "enum": ["exact", "approximate", "unsure"] },
      "location_description": { "type": "string" },
      "vehicle_registration_number": { "type": "string" },
      "anyone_injured": { "type": "boolean" },
      "vehicle_drivable": { "type": "boolean" },
      "other_parties": { "type": "array", "items": { "type": "object", "properties": {
        "role": { "type": "string", "enum": ["OTHER_DRIVER", "PASSENGER", "PEDESTRIAN", "WITNESS"] },
        "plate_number": { "type": "string" }, "name": { "type": "string" }, "phone": { "type": "string" }
      } } },
      "police_report_number": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

**Behavior:** safety scan on `narrative` first (deterministic keyword match — don't use an LLM for this, it's the one check that must never be slow or fuzzy). If no `intake_id`, call Svalinn `POST /v1/fnols`; else `PATCH /v1/fnols/{intake_id}`. Compute `missing[]` from Svalinn's `missingRequiredFields` response field — **don't duplicate that rule-set in our own code**, Svalinn already told you what's missing.

### 5.2 `get_claim_status` (P0 — build second, it's the simplest read)

```json
{
  "name": "get_claim_status",
  "description": "Call when the customer asks about progress or next steps. Returns stage, who has the next move, and the next step in plain language.",
  "inputSchema": { "type": "object", "properties": { "claim_id": { "type": "string" } }, "additionalProperties": false }
}
```

**Behavior:** `GET /v1/claims/{claim_id}` from Svalinn, map `nextMove`/`nextStepSummary`/`openTasks` straight into the response. This is the tool behind the "it remembered" demo moment — get it working early and test it by filing a claim, then using the adjuster console to add a task, then calling this tool again in a fresh process to prove nothing is held in memory.

### 5.3 `confirm_and_submit_claim` (P0)

```json
{
  "name": "confirm_and_submit_claim",
  "description": "Call only after reading the summary back to the customer and getting an explicit yes.",
  "inputSchema": { "type": "object", "properties": {
    "intake_id": { "type": "string" }, "confirmed": { "type": "boolean" }
  }, "required": ["intake_id", "confirmed"], "additionalProperties": false }
}
```

**Behavior:** if `confirmed` is not `true`, return an error — don't silently no-op. Otherwise call Svalinn `POST /v1/fnols/{intake_id}/promote` with `Idempotency-Key: ${intake_id}`. Also kick off `request_photo_upload` internally so the response can include the upload link in one turn instead of making the customer ask separately.

### 5.4 `request_photo_upload` (P0)

```json
{
  "name": "request_photo_upload",
  "description": "Call when the customer asks how to send photos. Creates an upload link and checklist.",
  "inputSchema": { "type": "object", "properties": { "claim_id": { "type": "string" } }, "additionalProperties": false }
}
```

**Behavior:** generate an upload-session token, store it in our own small evidence-session store (§6) mapped to `claim_id`, return a URL to `photo-portal` carrying that token. Checklist is a static list for MVP: scene wide, own car all four corners, damage close-up, other car plate.

### 5.5 `review_evidence` (P0)

```json
{
  "name": "review_evidence",
  "description": "Call when the customer asks if photos arrived or what's still needed.",
  "inputSchema": { "type": "object", "properties": { "claim_id": { "type": "string" } }, "additionalProperties": false }
}
```

**Behavior:** `GET /v1/claims/{claim_id}` from Svalinn, read `evidence[]` and `openTasks`. No separate data source needed.

### 5.6–5.8 `find_repair_shops`, `book_estimate_appointment`, `request_callback` (P1 — build after everything above works end to end)

- `find_repair_shops` and `book_estimate_appointment` have **no Svalinn backing** — Svalinn's API has no shops/estimates concept. Back these with a small static seeded list in `mcp-server` (5–6 fake shops, fixed). Don't build a real Location-service integration for the hackathon.
- `request_callback` calls Svalinn `POST /v1/claims/{claim_id}/notes` (or, if no claim exists yet, just logs the request — this tool must work even in the emergency branch before any claim exists).

---

## 6. The one thing `mcp-server` actually stores

A single small table (DynamoDB is fine, so is SQLite for local dev) — **not** a claims database, just working state for the photo flow:

```text
upload_sessions: { token, claim_id, created_at, expires_at (TTL 30 min), used: boolean }
evidence_jobs:   { photo_key, claim_id, status (pending|done|failed), quality_result, ocr_result, damage_result }
```

`evidence-pipeline` writes to `evidence_jobs` as each async step finishes, then **forwards the raw file to Svalinn's `POST /v1/claims/{claimId}/documents`** once quality-checked (don't forward unusable photos — ask for a retake first, that's the quality gate's whole purpose).

---

## 7. Build order — do these in sequence, each one should leave something runnable

1. **`svalinn-api` hello-world.** Implement `GET /v1/claim-types` and `POST /v1/customers/resolve` against the seed data in the API spec §9. Deployed or running locally, reachable over HTTP. *Done when: `curl` returns real seed data.*
2. **`svalinn-api` complete.** Implement the rest of §6 of the API spec, including the `/_mock` endpoints. *Done when: you can create an FNOL, promote it, upload a document, and read it back, entirely via curl/Postman, no MCP involved yet.*
3. **`mcp-server` hello-world.** One tool (`get_claim_status`) wired to the running `svalinn-api`. Deployed, reachable over Streamable HTTP. *Done when: MCP Inspector can call it and get a real answer back.*
4. **`mcp-server` core loop.** `report_incident`, `confirm_and_submit_claim`, `request_photo_upload`, `review_evidence` all working, tested via MCP Inspector (no voice yet). *Done when: you can file a full claim by sending raw MCP JSON-RPC calls by hand.*
5. **`echo-sim`.** Orchestrator + mic + speech output, calling the real `mcp-server`. *Done when: you can speak a full accident report out loud and hear it filed.*
6. **`photo-portal` + `evidence-pipeline`.** *Done when: a photo uploaded from a phone shows up, processed, in `review_evidence`.*
7. **`adjuster-console`.** *Done when: clicking "request more info" there changes what `get_claim_status` says in a completely separate, later call — this is the demo's centerpiece, test it explicitly.*
8. **MCP Apps views, tools 6–8, `mcp-ask-back` package, polish.** Everything here is P1/P2 — cut freely if time runs short; nothing above this line should ever be cut.

---

## 8. Config

```bash
SVALINN_API_BASE_URL=https://.../v1   # or http://localhost:PORT/v1 for dev
SVALINN_API_KEY=svk_test_us_...
SVALINN_TENANT_ID=TEN_001
AWS_REGION=us-east-1
EVIDENCE_TABLE_NAME=claim-companion-evidence
EVIDENCE_BUCKET_NAME=claim-companion-photos
BEDROCK_ORCHESTRATOR_MODEL_ID=...
BEDROCK_DAMAGE_MODEL_ID=...
```

---

## 9. Testing — minimum bar before calling any phase "done"

- Unit tests on anything in `mcp-server` that isn't a thin Svalinn passthrough (safety-keyword scanner, upload-token logic).
- One contract test per tool: call it via MCP Inspector or the SDK's test client against a running `svalinn-api`, assert the response shape matches §5.
- One end-to-end scripted run of the "it remembered" scenario (§7, step 7) — this is the single most important thing to have working and tested, since the whole demo video depends on it.

## 10. Explicitly out of scope — do not build these

Coverage/pricing Q&A, payments, real insurer integration, Alexa+ store certification submission, SMS delivery, Amazon Location integration, VIN decode, a second locale, full OAuth account linking (hardcode one linked demo customer instead).