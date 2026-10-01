# I12 External Evidence Execution Runbook

I12 implementation and its verifier are in the repository, but I12 is complete only after actual evidence passes. This runbook prohibits substituting templates, short tests, successful mocks, or self-attestation for PRD requirements.

## Required evidence

| Evidence | Minimum requirement |
| --- | --- |
| security-scans | SAST, dependency, secret, container, IaC, API, and penetration scans all PASS; no unaccepted P0 |
| performance-capacity | State the load model, completed request count, p95, maximum backlog, and fault-injection results |
| 72h-stability | At least 259,200 actual continuous seconds, at least 4,320 samples, and no unexplained failures |
| restore-drill | Database and audit head intact; actual RPO/RTO within target |
| signer-rotation | New signer accepted, old signer rejected, rotation auditable, no private-key material observed |
| data-protection-response | DPIA, retention, deletion, incident-response exercise, and go/no-go checklist complete |
| reproducible-build | Two independent build hashes match; SBOM and artifact signature verification pass |
| independent-reviews | Independent security, privacy, and legal acceptance; no unaccepted P0 |

## Verification

Place evidence in `evidence/acceptance/`, then run:

```text
node scripts/verify-i12-evidence.mjs
node scripts/verify-iterations.mjs
```

Evidence files may contain public audit references and summaries only; do not commit credentials, keys, personal data, real endpoints, or confidential report bodies. `artifactSha256` must point to the controlled original report. Auditors must be able to obtain the original through that reference and recompute the digest.

Local synthetic 72-hour stability runner:

```text
node scripts/run-i12-stability.mjs
```

The runner executes for at least 259,200 seconds and samples every 60 seconds; process interruption, sample gaps over 120 seconds, secret-scan failure, or any unexplained anomaly produces FAIL. Output uses exclusive-new creation; existing evidence will not be overwritten. Do not modify duration constants, falsify system time, or copy old evidence and relabel its date.

CI may verify formats, hash references, and numeric gates, but cannot independently declare legal review, a real recovery drill, or 72-hour operation complete. If any item is missing, I12 and overall `allComplete` must remain false.
