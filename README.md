# Claim Companion

Voice-first car-insurance claims assistant for an Amazon hackathon. Svalinn is an original fictional insurer backend; all demo data is synthetic.

Implementation is limited to Phase 1: the standalone TypeScript/Fastify Svalinn service with claim-type lookup and customer resolution. The remaining directories are scaffolding for later phases.

Read [the build spec](docs/codex-build-spec.md), then [the API contract](docs/svalinn-insurance-api-spec.md). [Design v3](docs/claims-concierge-design-v3.md) provides background. Spec ambiguities and build issues are tracked in [the friction log](docs/friction-log.md).

Requires Node.js 24 and npm. From the repository root, run `npm.cmd install`, `npm.cmd run build`, `npm.cmd test`, then `npm.cmd run dev` on Windows (`npm` elsewhere). The service listens at http://127.0.0.1:3001. `npm.cmd run start --workspace @claim-companion/svalinn-api` runs the compiled build.

Local credentials are in the ignored `services/svalinn-api/.env`. For a fresh checkout, copy `.env.example` to `.env` and replace both key placeholders with independently generated random strings. Do not use the literal spec keys. The service requires both keys. In-memory seed data reloads at startup; neither implemented endpoint writes business state.

Verify from PowerShell (use `curl.exe` to avoid the PowerShell curl alias):

```powershell
$config = Get-Content services/svalinn-api/.env | ConvertFrom-StringData
curl.exe -i http://127.0.0.1:3001/v1/claim-types -H "Authorization: ApiKey $($config.SVALINN_US_API_KEY)" -H "X-Svalinn-Tenant: TEN_001"
'{"externalCustomerId":"CUST_00234"}' | curl.exe -i http://127.0.0.1:3001/v1/customers/resolve -H "Authorization: ApiKey $($config.SVALINN_US_API_KEY)" -H "X-Svalinn-Tenant: TEN_001" -H "Content-Type: application/json" --data-binary '@-'
'{"phone":"+233245550192","policyNumber":"SV-GH-AUTO-2026-2201"}' | curl.exe -i http://127.0.0.1:3001/v1/customers/resolve -H "Authorization: ApiKey $($config.SVALINN_GH_API_KEY)" -H "X-Svalinn-Tenant: TEN_002" -H "Content-Type: application/json" --data-binary '@-'
```

Expect HTTP 200, five claim types, Jordan Reyes, and Ama Boateng respectively; each response includes requestId and rate-limit headers. Phase 2 endpoints intentionally remain unimplemented. Stop the server with Ctrl+C when running it yourself.

The application and Svalinn contract are original project work; Fastify, TypeScript, tsx, and Node types are third-party dependencies. Licensed under Apache-2.0.
