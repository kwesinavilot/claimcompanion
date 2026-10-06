# Phase 6: local photo flow

Version 0.6.0 adds a mobile photo portal and an asynchronous local evidence worker. The user approved local quality checks with explicitly unavailable OCR/damage while AWS settings are deferred, and one token per accepted batch of up to eight photos.

## Run and verify

Keep Svalinn (3001), MCP (3002), and the voice simulator (5173) running. Copy `apps/photo-portal/.env.example` to `.env`, replacing the placeholder with the local US Svalinn key. This workspace already has an ignored configuration. Run `npm.cmd run dev:photos` from the root. The portal listens on port 3003; its API is loopback-only on 3005. The MCP and portal must point at the **same absolute SQLite file**; relative defaults resolve to `services/mcp-server/.local/evidence.sqlite` from their workspace directories.

File a claim in the simulator, then use **Add your photos**. Choose up to eight JPEG, PNG or WebP images (10 MiB each), label them, and send one batch. Camera capture can add photos to the selection. Processing updates appear on the page. For more photos or retakes, ask the companion for a new link. `review_evidence` reads received documents from Svalinn alone.

Run `npm.cmd run build`, `npm.cmd test`, and `npm.cmd run smoke:photos`. The smoke test drives installed headless Chrome in a mobile viewport, submits generated fictional detailed/dark images, and verifies that only the usable photo appears through a fresh MCP call. It checks token removal from the URL, label/preview behavior, retake guidance, invalid links and browser errors. Screenshot: ignored `.local/photo-portal-mobile.png`. This is mobile-browser automation; physical phone/camera and live AWS acceptance remain pending.

For an actual phone on the same LAN, set `PHOTO_PORTAL_HOST=0.0.0.0` and `PHOTO_PORTAL_ORIGIN=http://YOUR_PC_LAN_IP:3003` in the portal environment, and `PHOTO_PORTAL_BASE_URL=http://YOUR_PC_LAN_IP:3003/upload` in MCP. Restart both services, request a **new** photo link, and open it on the phone. Allow port 3003 on the intended private network if Windows prompts. `localhost` on a phone refers to that phone. Keep this development server on the private network.

## Contract and processing decisions

- Every batch POST requires a UUID Idempotency-Key. Token authentication scopes the request to one tenant/claim; no browser insurer key is exposed. Original filename, MIME, label and SHA-256 determine the fingerprint. Same token/key/batch replays return the original acceptance; changing the batch or key after acceptance returns 409. Expired or unknown links return 410.
- The server validates file count, size, declared MIME, magic bytes, labels and the live Svalinn claim before acceptance. Validation failures leave the token usable. A SQLite transaction stores all jobs and marks the token used together, before returning 202. Quality rejection happens later and requires a new link for a retake.
- The local worker processes at most three photos concurrently. Pending jobs survive a process restart while the 30-minute session remains active. Stable job IDs become Svalinn document idempotency keys, preventing duplicates across a crash between forwarding and recording success. Forwarding failures retry up to three times. Run one local worker process for this SQLite configuration.
- Quality is deterministic: supported single-frame JPEG/PNG/WebP, maximum 24 million pixels, dimensions at least 320×240, grayscale mean brightness at least 25 and at most 240, no more than 85% nearly white pixels, Laplacian variance at least 15 on an oriented image resized within 512×512. These are MVP heuristics, not calibrated accuracy claims; low-texture photos may need a retake. Decoder errors reject the photo. Original usable files are forwarded unchanged to Svalinn; analysis uses a resized JPEG.
- Quality results, OCR and damage results are saved as each step completes. OCR/damage execute concurrently in background work, never inside an MCP response. Local mode records unavailable, with human review required, and invents no observations. AWS failures also require a human look; a usable photo can still reach Svalinn.
- Working photo bytes are erased when a job becomes done/failed. Job records are removed when their upload session expires; a worker left offline beyond that TTL cannot recover those photos. Svalinn remains the received-evidence store. Small session/batch replay receipts persist locally, matching Phase 4 behavior.
- Tokens are removed from the browser address after opening; the page uses a Bearer header and a no-referrer policy. Refreshing requires reopening the original link. The API does not log capability tokens or photo content. It accepts configured local/LAN origins.

## AWS configuration

See [AWS setup](aws-setup.md). The implemented adapters use Rekognition DetectText and Bedrock Converse; the cloud S3/Lambda/Step Functions/DynamoDB deployment is **not implemented or deployed in this local checkpoint**. Live OCR/model output is unverified. Model observations require human review; extracted text requires confirmation and never updates claim fields automatically. Strict enums reject free-form model decisions.

References: [AWS DetectText](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/rekognition/command/DetectTextCommand/) and [sharp image metadata/statistics](https://sharp.pixelplumbing.com/api-input/). The decoder dependency is sharp 0.35.5 after advisory remediation. Git operations remain user-managed; Phase 7 is not started.
