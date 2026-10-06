# Phase 7: adjuster console

Version 0.7.0 adds the fictional Svalinn adjuster console at http://127.0.0.1:3006. It opens a claim by reference, shows its next move, tasks, received evidence and timeline, creates customer information requests, and sets demo stages.

## Run

Copy `services/adjuster-console/.env.example` to `.env` and use the same Svalinn URL, US tenant and local key as MCP. The current workspace has an ignored configuration. Keep Svalinn running, then run `npm.cmd run dev:adjuster` from the root.

The React page uses Svalinn's existing GET claim and `/v1/_mock/...` task/stage HTTP contracts. A loopback Vite proxy adds the server-side API key and tenant headers; there is no console claim database and no MCP write involved. The API key is not a VITE-prefixed browser environment variable. Production assets build without credentials; serving those assets elsewhere requires an equivalent protected proxy. This is local development hosting, not a deployed console.

## Demo the cross-session result

1. File a fictional claim through the voice simulator and copy its demo claim ID.
2. Open that reference in the adjuster console.
3. Use the default request: **Add one photo of the rear bumper from about ten feet back.** Click **Request more info**.
4. Open a new conversation in Claim Companion, select the existing claim, and ask **How is my claim going?**
5. The response should repeat the request stored in Svalinn. `get_claim_status` should report `nextMove: CUSTOMER` and the same `nextStepSummary`.

Each new action gets a fresh UUID idempotency key. A failed action retains its exact claim, payload and key for **Retry same action**. Buttons lock during requests; refreshing rereads Svalinn. A write whose response was lost can be replayed without creating a second task.

The console preserves Phase 2 contract decisions: a CUSTOMER task sets INFO_REQUESTED, the oldest open task controls nextMove/nextStepSummary, and changing stage does not close tasks. There is no task-completion endpoint in the original API, so none is invented here. Multiple open requests remain visible; later requests do not replace the oldest request in the voice response. All seeded data, branding and requests are fictional.

## Verification

Run `npm.cmd run smoke:remembered` with Svalinn, MCP, the voice simulator and adjuster console running. It files a new claim through real MCP, clicks the console action, intentionally drops its first response after Svalinn commits it, retries through the UI, and asserts exactly one task. It then changes stage and verifies the task still determines the next move.

The script starts a **separate fresh Node process containing a new MCP HTTP server and new orchestrator**, with an empty conversation and only the existing claim handle. That process must return the exact stored request. Finally a new browser page opens a fresh voice conversation and checks the same response. No prior conversation or console state is passed to the probe. Browser speech output is muted in automation; live microphone, live Bedrock, cloud deployment and physical-phone checks remain pending.

Screenshots are saved under ignored `.local/`: `adjuster-console-desktop.png`, `adjuster-console-mobile.png`, and `remembered-voice.png`. Git commits and syncing remain user-managed. Phase 8 is not started.
