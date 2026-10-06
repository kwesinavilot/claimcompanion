# Svalinn Insurance — Core API Specification (v1)

**Purpose of this document:** a complete, original, implementable spec for a *fictional* insurer's backend API. This is what "Claim Companion" (our MCP server) calls behind the scenes to simulate a real insurer integration. It is a new design, written for this project — not derived from any real company's API.

**Audience:** whoever builds this (e.g. handed to Codex or another coding agent) should be able to implement the whole thing from this document alone, with no other context needed.

**Safety note:** this spec uses `.example` domains and entirely invented test data. Never copy real company hostnames, API keys, policy numbers, or customer data into this file or into the resulting code.

---

## 0. What this system is, in one paragraph

Svalinn Insurance is a made-up motor insurer. This API is **their** system — the one that already existed before our voice product showed up. It knows about customers, policies, and vehicles, and it handles the claims lifecycle from first report through to completion. Our separate MCP server (Claim Companion) is a *client* of this API, the same way a real insurer-integration product would be a client of a real insurer's API. Building this as a clean, standalone, documented API — rather than a shortcut inside our own code — is what makes the "any insurer could plug in" story in our pitch actually true instead of just asserted.

---

## 1. How this maps to our MCP tools

Build this API first; it's what the MCP tools (`report_incident`, `confirm_and_submit_claim`, `get_claim_status`, etc.) will call once they exist. This table is the hand-off point between the two systems.

| MCP tool (consumer) | Svalinn endpoint(s) it calls |
|---|---|
| Account linking / "pull" at conversation start | `POST /v1/customers/resolve` |
| `report_incident` | `POST /v1/fnols` (first call), `PATCH /v1/fnols/{fnolId}` (corrections) |
| `confirm_and_submit_claim` | `POST /v1/fnols/{fnolId}/promote` |
| `request_photo_upload` / evidence attach | `POST /v1/claims/{claimId}/documents` |
| `review_evidence` | `GET /v1/claims/{claimId}` (reads `evidence[]`) |
| `get_claim_status` | `GET /v1/claims/{claimId}` |
| Mock adjuster console (our own demo tool, not a real insurer feature) | `POST /v1/claims/{claimId}/tasks`, `PATCH /v1/claims/{claimId}/stage` |

---

## 2. Base URL and environments

```
Sandbox:    https://api.svalinn-insurance.example/v1
```

Only a sandbox environment exists — there is no production, since Svalinn isn't real. Keep this URL as an environment variable in the implementation, never hardcoded, so swapping in a real insurer later is a config change, not a code change.

---

## 3. Authentication

Two headers on every request:

```
Authorization: ApiKey svk_live_7fQmR2xYtN9pLk4cVbHj3eAw
X-Svalinn-Tenant: TEN_001
```

- **`Authorization`** — a single API key (no separate secret). Sandbox keys are provided in §9.
- **`X-Svalinn-Tenant`** — which insurer tenant you're operating as. Svalinn is multi-tenant internally even though there's only one fake insurer in our demo, because this is designed to mirror how a real integration platform works: one API, many insurer clients. Use `TEN_001` for the default US-flavored demo tenant, `TEN_002` for the Ghana-flavored tenant (see §9).

A request with a missing or invalid key returns `401`. A request with a valid key but wrong tenant for the resource being accessed returns `403`.

Production note (not needed for the hackathon, but worth leaving in the spec): a real deployment would add HMAC request signing and short-lived tokens instead of a static key. Flagged here as a deliberate simplification, not an oversight.

---

## 4. Request / response conventions

**All request and response bodies are JSON.** All timestamps are ISO 8601 UTC (`2026-10-04T14:32:00Z`). All money fields, if present, are decimal strings with an explicit currency code — not used in MVP endpoints below.

**Success envelope:**

```json
{
  "status": "ok",
  "data": { },
  "requestId": "req_8f3k2m9p"
}
```

**Error envelope:**

```json
{
  "status": "error",
  "error": {
    "code": "FNOL_NOT_FOUND",
    "message": "No FNOL exists with that ID for this tenant."
  },
  "requestId": "req_8f3k2m9p"
}
```

Every response — success or error — includes `requestId`, generated server-side, for support/debugging correlation. The calling client should log it.

**Idempotency:** `POST /v1/fnols` and `POST /v1/fnols/{fnolId}/promote` require an `Idempotency-Key` header (any unique string the client generates). Replaying the same key returns the original result instead of creating a duplicate. This matters because a flaky network call during a voice conversation should never create two claims.

```
Idempotency-Key: ic_report-incident_8f3k2m9p
```

---

## 5. HTTP status codes

| Code | Meaning | When |
|---|---|---|
| `200` | OK | Successful read |
| `201` | Created | FNOL or claim created |
| `400` | Bad Request | Validation failure — see `error.code` |
| `401` | Unauthorized | Missing/invalid API key |
| `403` | Forbidden | Key valid, but wrong tenant or missing scope |
| `404` | Not Found | No resource with that ID in this tenant |
| `409` | Conflict | Idempotency key reused with a different body |
| `422` | Unprocessable | Well-formed JSON, but business rule failed (e.g. policy expired) |
| `429` | Too Many Requests | Rate limit exceeded (see `X-RateLimit-*` headers) |
| `500` | Server Error | Something broke on Svalinn's side |

---

## 6. Resources

### 6.1 Claim types — `GET /v1/claim-types`

Returns the claim types this tenant supports, and which fields each one requires on FNOL creation. A real insurer's requirements differ by product and jurisdiction — this endpoint is how the MCP server stays config-driven instead of hardcoding insurer-specific rules.

**Response `200`:**

```json
{
  "status": "ok",
  "data": [
    {
      "code": "MOTOR_COLLISION",
      "label": "Motor Collision",
      "requiredFields": ["incidentAt", "incidentLocation", "vehicleRegistrationNumber", "narrative"]
    },
    { "code": "MOTOR_HIT_AND_RUN", "label": "Motor Hit and Run", "requiredFields": ["incidentAt", "incidentLocation", "narrative"] },
    { "code": "MOTOR_THEFT", "label": "Motor Theft", "requiredFields": ["incidentAt", "incidentLocation", "policeReportNumber"] },
    { "code": "MOTOR_GLASS", "label": "Motor Glass Only", "requiredFields": ["incidentAt", "narrative"] },
    { "code": "MOTOR_WEATHER", "label": "Motor Weather or Falling Object", "requiredFields": ["incidentAt", "incidentLocation", "narrative"] }
  ],
  "requestId": "req_c1a2b3"
}
```

---

### 6.2 Resolve customer — `POST /v1/customers/resolve`

A single composite lookup: given either a known external customer reference *or* a phone + policy number pair, returns the customer plus their policies and vehicles in one call. This is the "pull" step — used once when a customer links their Alexa+ account, and optionally refreshed before each conversation.

**Request body (one of the two shapes):**

```json
{ "externalCustomerId": "CUST_00234" }
```

or

```json
{ "phone": "+14155550192", "policyNumber": "SV-AUTO-2026-10481" }
```

**Response `200`:**

```json
{
  "status": "ok",
  "data": {
    "customer": {
      "externalCustomerId": "CUST_00234",
      "firstName": "Jordan",
      "lastName": "Reyes",
      "phone": "+14155550192",
      "email": "jordan.reyes@example.com"
    },
    "policies": [
      {
        "policyNumber": "SV-AUTO-2026-10481",
        "status": "ACTIVE",
        "effectiveDate": "2026-01-15",
        "expirationDate": "2027-01-15",
        "vehicles": [
          { "vehicleRegistrationNumber": "7KBX294", "vin": "1HGCM82633A004352", "make": "Honda", "model": "Civic", "modelYear": 2021, "color": "Silver" }
        ],
        "coverages": [
          { "type": "LIABILITY", "limit": "100000.00", "currency": "USD" },
          { "type": "COLLISION", "deductible": "500.00", "currency": "USD" }
        ]
      }
    ]
  },
  "requestId": "req_d4e5f6"
}
```

**Errors:** `404` if nothing matches (`CUSTOMER_NOT_FOUND`); `422` if the policy is found but not active (`POLICY_NOT_ACTIVE`).

---

### 6.3 Create FNOL — `POST /v1/fnols`

Registers a first notice of loss. This is a **draft** — lighter-weight than a full claim, and nothing downstream (adjuster queues, etc.) is notified yet. Use `PATCH` to add details across multiple calls as a voice conversation fills in fields gradually; use `promote` (§6.5) once the customer confirms.

**Request body:**

```json
{
  "externalCustomerId": "CUST_00234",
  "policyNumber": "SV-AUTO-2026-10481",
  "claimTypeCode": "MOTOR_COLLISION",
  "vehicleRegistrationNumber": "7KBX294",
  "incidentAt": "2026-10-04T14:10:00Z",
  "dateConfidence": "exact",
  "incidentLocation": { "description": "Grocery store parking lot on Oak Street", "city": "Springfield", "region": "IL" },
  "narrative": "Another car backed into the rear bumper while parked.",
  "anyoneInjured": false,
  "vehicleDrivable": true,
  "otherParties": [
    { "role": "OTHER_DRIVER", "name": null, "phone": null, "plateNumber": "9QRT581", "insurerName": null }
  ],
  "policeReportNumber": null
}
```

Only `externalCustomerId` or `policyNumber`, plus `claimTypeCode`, are required to create a draft — everything else can arrive via `PATCH` as the conversation progresses. `dateConfidence` is one of `exact | approximate | unsure`.

**Response `201`:**

```json
{
  "status": "ok",
  "data": { "fnolId": "fnol_7h2k9m", "status": "DRAFT", "missingRequiredFields": [] },
  "requestId": "req_g7h8i9"
}
```

`missingRequiredFields` compares what's been provided against the claim type's `requiredFields` from §6.1 — the MCP server uses this to decide what to ask next, instead of duplicating that rule-set itself.

---

### 6.4 Update FNOL — `PATCH /v1/fnols/{fnolId}`

Same body shape as create; only send the fields that changed. Fields not included are left untouched — this is what lets "actually it was Oak Street, not Elm" update one field without resubmitting everything.

**Response `200`:** same shape as create, with the current merged state.

**Errors:** `404` (`FNOL_NOT_FOUND`), `422` if the FNOL has already been promoted to a claim (`FNOL_ALREADY_PROMOTED`) — at that point, updates go through `POST /v1/claims/{claimId}/notes` instead.

---

### 6.5 Get FNOL — `GET /v1/fnols/{fnolId}`

Returns the current draft state. Mainly for debugging/testing; the MCP server generally doesn't need this once it's holding the draft state itself, since `create`/`update` already return the current state.

---

### 6.6 Promote FNOL to claim — `POST /v1/fnols/{fnolId}/promote`

Turns a confirmed FNOL into a real claim with a claim number. This is the one-way door — call it only after the customer has heard the read-back and explicitly said yes. Requires the `Idempotency-Key` header (§4): calling it twice with the same key returns the same claim rather than creating a second one.

**Request body:** `{}` (empty — all the data is already on the FNOL)

**Response `201`:**

```json
{
  "status": "ok",
  "data": { "claimId": "clm_3n8p2q", "claimNumber": "SV-CLM-2026-004817", "stage": "SUBMITTED" },
  "requestId": "req_j1k2l3"
}
```

**Errors:** `422` if required fields are still missing (`FNOL_INCOMPLETE`, with the missing list included), or if the FNOL was already promoted (returns the existing claim instead of erroring, matching the idempotency behavior above).

---

### 6.7 Get claim — `GET /v1/claims/{claimId}`

The single read that backs `get_claim_status`. Returns everything needed to answer "how's my claim going" in one call.

**Response `200`:**

```json
{
  "status": "ok",
  "data": {
    "claimId": "clm_3n8p2q",
    "claimNumber": "SV-CLM-2026-004817",
    "stage": "INFO_REQUESTED",
    "nextMove": "CUSTOMER",
    "nextStepSummary": "Add one photo of the rear bumper from about ten feet back.",
    "openTasks": [
      { "taskId": "task_55", "owner": "CUSTOMER", "text": "Add one photo of the rear bumper from about ten feet back.", "createdAt": "2026-10-04T16:02:00Z" }
    ],
    "evidence": [
      { "documentId": "doc_91", "kind": "PHOTO", "uploadedAt": "2026-10-04T15:11:00Z", "label": "Front bumper, wide" }
    ],
    "timeline": [
      { "at": "2026-10-04T15:04:00Z", "event": "CLAIM_FILED" },
      { "at": "2026-10-04T15:11:00Z", "event": "EVIDENCE_RECEIVED" },
      { "at": "2026-10-04T16:02:00Z", "event": "ADJUSTER_REQUESTED_INFO" }
    ]
  },
  "requestId": "req_m4n5o6"
}
```

**Claim `stage` values** (same lifecycle as the main design doc, included here so the two systems stay in sync):
`SUBMITTED → ACKNOWLEDGED → INFO_REQUESTED → ESTIMATE_PENDING → ESTIMATE_RECEIVED → IN_REPAIR → COMPLETED`, with `WITHDRAWN` reachable from most states.

**`nextMove`** is one of `CUSTOMER | INSURER | REPAIRER` — this single field is what lets the assistant say "that's on you" vs "they're working on it" without the MCP server having to interpret the stage itself.

---

### 6.8 Upload document — `POST /v1/claims/{claimId}/documents`

`multipart/form-data`.

| Field | Required | Description |
|---|---|---|
| `file` | yes | The file itself (image or PDF) |
| `kind` | yes | `PHOTO \| POLICE_REPORT \| OTHER` |
| `label` | no | Short free-text label, e.g. "rear bumper close-up" |

**Response `201`:** `{ "documentId": "doc_92", "kind": "PHOTO", "uploadedAt": "..." }`

Svalinn does not perform any image analysis itself — plate reading, damage assessment, and quality checks are entirely our own product's job (the async pipeline in the main design doc), not the insurer's. This endpoint only stores the file and records that it arrived.

---

### 6.9 Add note — `POST /v1/claims/{claimId}/notes`

```json
{ "note": "Customer confirmed vehicle is drivable; proceeding without a rental request." }
```

**Response `200`:** `{ "noteId": "note_41", "createdAt": "..." }`

---

## 7. Mock-only endpoints (simulate the insurer's internal side)

These two endpoints don't exist in a real insurer's public API — a real adjuster works inside the insurer's *own* internal tools, which we'll never see or build. We need a stand-in so our demo can show "the insurer did something" without building an entire claims-management product. Keep these clearly separated in the implementation (e.g. a different route prefix, `/v1/_mock/...`) so it's obvious they're a demo convenience, not part of the real contract.

### 7.1 Create task (simulated adjuster action) — `POST /v1/_mock/claims/{claimId}/tasks`

```json
{ "owner": "CUSTOMER", "text": "Add one photo of the rear bumper from about ten feet back." }
```

This is what the mock adjuster console calls when someone clicks "request more info" — and it's exactly what makes the "it remembered" demo moment real: the task created here is what `GET /v1/claims/{claimId}` returns as `openTasks` and what drives `nextStepSummary`, moments or days later, in a completely separate conversation.

### 7.2 Set stage (simulated adjuster action) — `PATCH /v1/_mock/claims/{claimId}/stage`

```json
{ "stage": "ESTIMATE_PENDING" }
```

Moves the claim forward. The adjuster console's "fast-forward" button for demo purposes calls this directly instead of waiting on real elapsed time.

---

## 8. Rate limiting

Sandbox default: **2,000 requests/hour per API key**, generous for a hackathon demo. Every response includes:

```
X-RateLimit-Limit: 2000
X-RateLimit-Remaining: 1987
X-RateLimit-Reset: 1759603200
```

Exceeding it returns `429` with the same headers indicating when to retry.

---

## 9. Sandbox test data

Two tenants, matching the US-demo / Ghana-portability-pack split from the main design doc. **All values below are invented for this project — none correspond to any real person, vehicle, or policy.**

### Tenant `TEN_001` — US demo (default)

**API key:** `svk_test_us_4mQ9rT2wXpL7yVbN8cEj`

| externalCustomerId | name | phone | policyNumber | vehicle reg | make/model |
|---|---|---|---|---|---|
| `CUST_00234` | Jordan Reyes | +14155550192 | SV-AUTO-2026-10481 | 7KBX294 | Honda Civic 2021 |
| `CUST_00235` | Priya Shah | +14155550133 | SV-AUTO-2026-10502 | 4LMN812 | Toyota RAV4 2023 |
| `CUST_00236` | Sam Okafor | +14155550177 | SV-AUTO-2026-10519 | 2XJT067 | Ford F-150 2019 |

### Tenant `TEN_002` — Ghana market pack (portability proof)

**API key:** `svk_test_gh_9kLw3pQ1mXz5bYcR7sTv`

| externalCustomerId | name | phone | policyNumber | vehicle reg | make/model |
|---|---|---|---|---|---|
| `CUST_01001` | Ama Boateng | +233245550192 | SV-GH-AUTO-2026-2201 | GR 4521-25 | Toyota Corolla 2020 |
| `CUST_01002` | Kojo Mensah | +233245550133 | SV-GH-AUTO-2026-2219 | AS 1187-24 | Hyundai Tucson 2022 |

These keys/values are placeholders meant for local/sandbox use only — generate fresh random-looking strings in the actual implementation rather than reusing the literal strings above verbatim, so nothing here accidentally becomes a real shared secret once the repo is public.

---

## 10. Error codes reference

| `error.code` | HTTP status | Meaning |
|---|---|---|
| `CUSTOMER_NOT_FOUND` | 404 | No customer matches the given reference |
| `POLICY_NOT_ACTIVE` | 422 | Policy found but lapsed/cancelled |
| `FNOL_NOT_FOUND` | 404 | No FNOL with that ID in this tenant |
| `FNOL_ALREADY_PROMOTED` | 422 | FNOL already converted to a claim |
| `FNOL_INCOMPLETE` | 422 | Missing required fields for this claim type |
| `CLAIM_NOT_FOUND` | 404 | No claim with that ID in this tenant |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same key reused with a different request body |
| `VALIDATION_ERROR` | 400 | Malformed request body |
| `RATE_LIMITED` | 429 | Too many requests |

---

## 11. Build notes for whoever implements this

- This can be a small standalone service (e.g. Express/Fastify on Node, or any framework) backed by a simple database (even SQLite or an in-memory store is fine for a hackathon mock) — it does not need to be elaborate; its only job is to behave exactly as documented above so the MCP server has something real to call.
- Seed it at startup with the test data in §9.
- The `/v1/_mock/...` endpoints (§7) should be unauthenticated or lightly protected (they're only ever called by our own adjuster console, never by Alexa+), but keep them namespaced separately so it's visually obvious in the code that they're not part of the "real" contract.
- Log every request with its `requestId` — useful both for debugging and as a source of friction-log material if something here turns out to be awkward to integrate against.