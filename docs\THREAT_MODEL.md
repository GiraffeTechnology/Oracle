# Giraffe RWA Oracle threat model

## Protected assets

- integrity and ordering of registry, certificate and warehouse facts;
- signing-key confidentiality and signer-set integrity;
- append-only certificate and audit history;
- privacy of identity mappings and source documents;
- availability of current status and revocation results;
- separation from transaction signing, funds and financial decisions.

## Trust boundaries

1. Approved external authorities to the ingestion gateway.
2. Ingestion and canonicalization to the state engine.
3. State engine to the attestation signer.
4. Oracle storage to public query and audit clients.
5. Oracle attestations to independent protocol consumers.

## Initial threats and required controls

| Threat | Control | Iteration |
| --- | --- | --- |
| Caller substitutes an endpoint | Fixed source registry; endpoint fields rejected | I0–I1 |
| Unknown or inactive authority submits facts | Source and key-set gates | I1–I2 |
| Payload changes after signing | Deterministic canonicalization and hashing | I2 |
| Duplicate or reordered event | Nonce, timestamp, idempotency and version checks | I2–I4 |
| Two current certificates exist | Unique current projection plus conflict state | I3 |
| Old fact overwrites a new certificate | Strict version and previous-hash checks | I3–I4 |
| Attestation reused for another asset or chain | Purpose and subject binding | I5 |
| Revoked attestation remains accepted | Revocation registry and fail-closed verifier | I7 |
| Administrator fabricates a valid fact | Evidence-derived state and dual control | I10 |
| Sensitive evidence reaches public output | Field allowlists, commitments and export scans | I2, I6, I10 |
| Oracle is treated as financial approval | Prohibited fields and public wording gates | I0, I6, I12 |
| Dependency or build compromise | Locked dependencies, SBOM and reproducible artifacts | I0, I12 |

## Iteration 0 controls implemented

- Development/test environments only.
- Loopback-only server binding.
- External writes cannot be enabled.
- Caller-supplied source endpoints are rejected.
- No third-party runtime dependency.
- Synthetic fixtures only.
- Repository scan for common credential content and non-loopback IPv4 literals.

## Residual risk

The current service is an engineering baseline, not a production Oracle. It has no persistent database,
authenticated ingestion, production signing, revocation propagation, high availability or disaster
recovery. It must not process real evidence or serve as a production decision source.
