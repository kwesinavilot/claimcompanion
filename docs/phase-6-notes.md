# Phase 6 work in progress

The portal workspace is scaffolded but not yet runnable or included in root workspace commands. The evidence-pipeline workspace contains independently testable AWS Rekognition OCR and Bedrock damage adapters, a strict observations schema, and explicit unavailable-analysis responses. It does not yet accept photos, run a job queue, forward documents, or deploy AWS infrastructure.

Pending clarification sent to the user: may the local development flow run asynchronous image-quality checks while leaving OCR/damage explicitly unavailable without AWS settings; may one upload token authorize a batch of up to eight photos and be consumed only after that batch is accepted? Build-spec section 6 defines a used flag but not its consumption/retry semantics or quality thresholds.

No live AWS calls have been tested. Model observations require human review; extracted text requires confirmation and never updates claim fields automatically. The new image decoder was updated to sharp 0.35.5 after dependency audit reported advisories against 0.34; installation then reported zero vulnerabilities.

References used for the adapter and planned quality implementation: [AWS DetectText](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/rekognition/command/DetectTextCommand/) and [sharp image metadata/statistics](https://sharp.pixelplumbing.com/api-input/).

Phase 5 remains the runnable product checkpoint. Phase 6 is not complete; no physical-phone upload, asynchronous processing, or review_evidence acceptance test has passed yet. Git operations remain user-managed.
