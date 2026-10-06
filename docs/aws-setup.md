# AWS setup for Claim Companion

For the current local apps, prepare access to **Amazon Bedrock and Amazon Rekognition** through a locally configured AWS credential profile. You do not yet need to create buckets, databases, Lambdas or workflows to test these adapters.

Choose an AWS region where the intended models and Rekognition are available. `us-east-1` is the development default, not a guarantee of model availability. Provide the profile name, chosen region, and model/inference-profile IDs; never put keys or session tokens in chat or committed files.

## Local AI settings

In `apps/echo-sim/.env`:

```dotenv
ORCHESTRATOR_MODE=bedrock
AWS_PROFILE=your-local-profile
AWS_REGION=your-region
BEDROCK_ORCHESTRATOR_MODEL_ID=your-tool-capable-model-or-inference-profile-id
```

In `apps/photo-portal/.env`:

```dotenv
EVIDENCE_ANALYSIS_MODE=aws
AWS_PROFILE=your-local-profile
AWS_REGION=your-region
BEDROCK_DAMAGE_MODEL_ID=your-image-capable-model-or-inference-profile-id
```

Restart the affected apps. Credentials come from the AWS SDK's standard provider chain. The orchestrator model needs Converse tool use; the damage model needs Converse image input. The same model can fill both roles if it supports both. Runtime identity needs `bedrock:InvokeModel` for the selected model/profile resources and `rekognition:DetectText`. Keep invocation permissions separate from administrative permissions used to enable model access or deploy infrastructure. Inference profiles may require permissions on their underlying model resources too.

Access to many Bedrock models is enabled by default with appropriate Marketplace permissions; first use can require a one-time enablement by an account administrator. Anthropic requires first-time use-case details. Follow the current [AWS model-access guide](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html). Account-level access does not replace runtime IAM permissions.

The current OCR adapter sends image bytes directly to [Rekognition DetectText](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/rekognition/command/DetectTextCommand/), so local adapter testing does not require S3. Damage observations and recognized text remain unconfirmed evidence; no claim fields are updated from model output.

## Planned cloud services

| Service | Project use |
|---|---|
| S3 | Private uploaded-photo storage |
| Lambda | Quality, OCR, damage and insurer-forwarding workers; HTTP handlers |
| Step Functions | Asynchronous pipeline orchestration and retries |
| Rekognition | Text extraction |
| Bedrock | Conversation tool selection and damage observations |
| DynamoDB | Expiring upload sessions and evidence jobs, never a duplicate claims database |
| API Gateway | Public HTTPS MCP/upload endpoints |
| CloudWatch | Logs and diagnostics |

These resources should be created through the repository's planned CDK stacks, rather than manually assembled now. The local SQLite worker is not a Lambda deployment artifact. Cloud storage, worker handlers, state-machine wiring, IAM roles, and hosting still need implementation before cloud deployment. Step Functions requires permissions to [invoke its Lambda workers](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html); each worker will receive only the service permissions it uses. Cloud workers will also need a deployed, reachable Svalinn API; they cannot reach this PC's localhost.

No AWS resources have been created or live AWS calls verified by this checkpoint. Physical phone testing can use the documented LAN setup while cloud work remains pending.
