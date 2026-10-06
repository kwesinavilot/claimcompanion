# Friction log

- 2026-10-06: Specs arrived at repo root under alternate filenames; copied into docs under canonical names, retaining originals and a v2 design alias required by build-spec §2.
- 2026-10-06: Build-spec references design v2 although the supplied design is v3; user identifies v3 as background and build-spec as schema authority.
- 2026-10-06: API §9 lacks several fields shown in §6.2 resolve responses; asked user whether to generate fictional values or omit unspecified fields. Implementation pending answer.
- 2026-10-06: API §9 prints sandbox keys but requires fresh generated keys; local generated credentials will be used.
- 2026-10-06: PowerShell blocks npm.ps1 under local execution policy; use npm.cmd without changing execution policy.
- 2026-10-06: User approved Jordan's §6.2 example plus fictional supplemental fields for the remaining four customers, with all policies ACTIVE; implemented those values in seed/customers.json.
- 2026-10-06: Dependency download failed with EACCES under sandbox restrictions; requested approved network execution for npm install.
- 2026-10-06: Resolve is a POST lookup, not a write; it creates no state and repeated requests return the same seed data (with fresh request IDs). No idempotency key is required for this endpoint by the API contract.
- 2026-10-06: Phase 1 verified: TypeScript build and contract tests pass; live curl returns HTTP 200 with five claim types, Jordan by external ID, and Ama by phone/policy.
- 2026-10-06: Version-control setup blocked: Git and gh are unavailable; existing Program Files/Git contains only etc. Git installation approval was rejected by the user. No commit, tag, remote, or sync has occurred.
