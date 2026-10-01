# Proposed Standard Interface Specification: Cultural Relics Preservation Chain ↔ Giraffe Oracle (Draft v0.1)

| Item | Content |
| --- | --- |
| Document status | **Proposal draft** for discussion with the China Cultural Relics Preservation Chain technical team; before confirmation by both parties it is not an implementation commitment by either party |
| Proposer | Giraffe RWA Oracle (L2 verification layer) |
| Related PRD | docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md v0.3 |
| Status | Awaiting item-by-item confirmation with the Preservation Chain technical team; §9 lists questions requiring their response |

## 0. Purpose

Giraffe Oracle converts **registration facts** from the Preservation Chain into verifiable, revocable, time-bounded on-chain proofs. Oracle itself does not send transactions to any public chain (the PRD §5 layer division: L2 performs queries, verification, signed proofs, state synchronization, revocation, and audit). This interface therefore describes one-way reads from the Preservation Chain to Oracle only; it contains no Oracle-to-Preservation-Chain writes.

Every constraint in this specification traces to a specific PRD requirement; §1 lists the mapping. This makes the rationale auditable during bilateral discussion rather than a matter of design preference.

## 1. Sources of constraints

| This specification | Source | Constraint |
| --- | --- | --- |
| §2 pull model, §3.1 fixed endpoint | ORACLE-001 | Callers cannot supply arbitrary URL/RPC/database addresses; unknown sources are rejected by default |
| §5 field minimization | ORACLE-007 | Personal information, original certificates/warehouse receipts, and identity mappings must not enter public surfaces |
| §6 owner commitment | ORACLE-007 + PRD §14 | Identity mappings must not enter a public chain |
| §7 failure semantics | ORACLE-002 | Closed status vocabulary, default NOT_VERIFIED, fail closed |
| §4.3 change query | PRD premise P7 | T+0 snapshot → owner change, prior certificate revocation, and new certificate issuance completed no later than T+3 |
| §8 reconciliation | ORACLE-008 | Inconsistency in the authoritative projection must be detectable |
| §3.3 response signature | ORACLE-003 | Proofs must bind their source and be independently verifiable offline |

## 2. Interaction model

Use a two-step “change notification + authoritative pull” model; do not have the Preservation Chain push complete data directly:

    Preservation Chain --(1) change notice (reference only; no business data)--> Oracle
    Oracle --(2) pull authoritative record by reference-----------------------> Preservation Chain

Three reasons, each a requirement rather than a preference:

1. **ORACLE-001 requires data to come only from registered endpoints.** If pushed content is trusted as authoritative, any party able to forge a notification could inject facts. Pulling keeps authority on the Preservation Chain side.
2. **Notices may be lost, duplicated, or out of order, while pulls are idempotent.** Oracle implements replay handling and reconciliation; the Preservation Chain need not guarantee delivery semantics.
3. **Notices contain no business data, reducing exposure.** They carry only a reference and change type.

If the Preservation Chain cannot provide notifications, Oracle may fall back to **periodic polling of the incremental interface in §4.4**. Functionality is unchanged; only synchronization latency increases. This fallback is acceptable; please answer in §9.

## 3. Transport and authentication

### 3.1 Fixed endpoint

Endpoints, certificate fingerprints, and credentials are recorded on the Oracle side as deployment configuration in the approved source registry. **Callers must not provide endpoints in requests.** Oracle rejects source configuration containing url, endpoint, or rpcUrl fields with error code CALLER_SUPPLIED_ENDPOINT_REJECTED.

### 3.2 Transport security

- TLS 1.3; mutual TLS (mTLS) is recommended, with Oracle providing a client certificate.
- If token authentication is used, inject the token only through an environment variable; do not put it in source, logs, or error details.
- Restrict source IP ranges by caller, where available.

### 3.3 Response signature (recommended as MUST; please assess feasibility)

TLS alone lets the requester prove “the connection reached the other party,” but not later prove to a third party “the other party gave this exact response at that time.” Giraffe proofs must be independently verifiable offline, so this proposal recommends a Preservation Chain signature on every response body:

    X-Wenbao-Signature: <base64>
    X-Wenbao-Key-Id: <public-key identifier>
    X-Wenbao-Signed-At: <RFC3339 UTC>

The signed object is “canonical JSON response body ‖ signing time.” Exchange and register the Preservation Chain public key through an out-of-band channel.

If the Preservation Chain cannot provide signatures yet, Oracle will explicitly label proof strength as “transport layer only” and record this known limitation in acceptance documentation. **This weakens external evidentiary credibility; therefore this is recommended as MUST.**

## 4. Interface list

All interfaces are read-only, idempotent GET requests. All times use RFC3339 UTC (2026-09-01T12:00:00Z). All hashes use **lowercase 64-character SHA-256 hex** (validated on Oracle side with ^[a-f0-9]{64}$).

### 4.1 Registration-fact query

    GET /v1/registry/assets/{registryRef}

registryRef is the unique reference assigned by the Preservation Chain (Oracle field name wenbaoRegistryRef; maximum length 256).

Response:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| registryRef | string | Yes | Echoed to prevent identifier mix-up |
| registryStatus | enum | Yes | See §7.1 |
| assetFingerprintHash | hash | Yes | Subject-matter fingerprint hash; not the subject-matter details |
| classificationCode | string (≤64) | No | Classification code, no descriptive text |
| currentCertificateHash | hash | Yes | Hash of the current valid registration certificate |
| currentCertificateVersion | integer ≥1 | Yes | Current certificate version |
| currentOwnerCommitment | hash | Yes | See §6; must not be plaintext identity or its direct hash |
| encumbranceStatus | string (≤64) | Yes | Restricted-status code such as freeze, seizure, or pledge |
| registeredAt | date-time | Yes | Initial registration time |
| updatedAt | date-time | Yes | Last change time for this record |

### 4.2 Certificate-version query

    GET /v1/registry/certificates/{registryRef}
    GET /v1/registry/certificates/{registryRef}?version={n}

Without version, return the current valid certificate. With version, return that version, including revoked versions.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| registryRef | string | Yes | Echo |
| certificateVersion | integer ≥1 | Yes | Monotonically increasing version |
| certificateHash | hash | Yes | Hash of this version's certificate |
| previousCertificateHash | hash or null | Yes | Prior-version hash; null for first version |
| changeRef | string (≤256) | Yes | Change reference that produced this version (Oracle field wenbaoChangeRef) |
| status | enum | Yes | CURRENT / SUPERSEDED / REVOKED |
| effectiveAt | date-time | Yes | Effective time |
| supersededAt | date-time or null | Yes | Time superseded/revoked |

**Version-chain requirement:** previousCertificateHash must exactly equal the preceding version's certificateHash. Oracle validates every link; a broken chain is a source anomaly and triggers fail-closed handling under §7.2.

### 4.3 Change-status query (critical settlement path)

    GET /v1/registry/changes/{changeRef}

PRD premise P7 requires an overseas transaction snapshot at T+0 and completion of the Preservation Chain owner change, prior-certificate revocation, and new-certificate issuance **no later than T+3**. Oracle must repeatedly query whether the change has landed during this window.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| changeRef | string (≤256) | Yes | Echo |
| registryRef | string | Yes | Associated registration |
| changeType | enum | Yes | OWNER_TRANSFER / CERTIFICATE_REISSUE / REVOCATION / ENCUMBRANCE |
| changeStatus | enum | Yes | PENDING / COMPLETED / REJECTED / CANCELLED |
| oldCertificateHash | hash or null | Yes | Prior certificate |
| newCertificateHash | hash or null | Yes | Resulting certificate; null before completion |
| newOwnerCommitment | hash or null | Yes | See §6; null before completion |
| submittedAt | date-time | Yes | Submission time |
| completedAt | date-time or null | Yes | Completion time |
| rejectionCode | string (≤64) or null | Yes | Machine rejection code; no natural-language reason (may contain personal data) |

### 4.4 Incremental reconciliation

    GET /v1/registry/changes?since={RFC3339}&limit={n}&cursor={opaque}

Return change references since since for periodic Oracle reconciliation (ORACLE-008 requires detection of projection inconsistencies) and recovery after missed notifications. Default limit is 100; maximum 1000. Response includes nextCursor, null when no more data exists.

Each item contains only changeRef, registryRef, changeType, changeStatus, and updatedAt—**no business data**. Details are still pulled under §4.3.

### 4.5 Health check

    GET /v1/health

Return { "status": "UP" | "DEGRADED" | "DOWN", "schemaVersion": "<string>", "serverTime": "<RFC3339>" }.

Oracle implements circuit breaking, rate limiting, and timeouts (default timeout 1000 ms, 10 requests per second, circuit opens after 2 consecutive failures). This endpoint is used for health and clock-skew checks and is excluded from rate limiting.

## 5. Field minimization (important)

Public information says the Preservation Chain's asset-registration dataset covers approximately **260 fields**. **This interface should return only a small minority of them.**

Oracle needs only the fields in the four interfaces above to perform all PRD duties, approximately 20 fields total:

1. **ORACLE-007** prohibits personal data, original certificates/receipts, and identity mappings on public surfaces.
2. Oracle outputs are ultimately published externally as hashes; **receiving data creates risk**—data never received cannot leak.
3. For cross-border data compliance, justifying a minimum dataset is much easier than trimming a full dataset afterward.

Therefore, request that the Preservation Chain return only the fields listed in this specification **at the interface**, rather than returning everything for Oracle to trim. If the interface can return only the full dataset, Oracle will whitelist and discard other fields at the transport-adapter boundary, but this is inferior because the data has already crossed the network.

**Not needed and must not be returned** (examples, not exhaustive): subject-matter name/description, photographs/video, dimensions/material/craft, appraisal opinion/appraiser, owner name/identity number/contact/address, transaction consideration, valuation/appraisal conclusions, and information identifying handlers or staff of operating institutions.

## 6. Owner commitment (currentOwnerCommitment / newOwnerCommitment)

PRD premise P1 says the Preservation Chain registration **includes owner information**, while PRD §14 lists “identity mapping enters a public chain” as a release blocker. Reconcile them as follows: **Oracle never receives owner identity; it receives only a commitment value.**

Requirements:

- Compute the commitment on the **Preservation Chain side**. Oracle does not participate and does not receive raw identity data needed for computation.
- Recommended: commitment = SHA-256(salt ‖ canonical owner identifier); the Preservation Chain holds salt and **does not export it**.
- The **same owner should** produce different commitments for different assets (use per-asset or per-registration salt); otherwise equal commitments could reveal “which cultural objects the same person owns,” creating an identity mapping.
- A changed commitment counts as an owner change. Oracle does not need to, and should not, know who the parties were before or after.

If the Preservation Chain cannot perform this computation, the parties must discuss another solution. **Oracle receiving plaintext identity and then hashing it is unacceptable**: once Oracle holds the plaintext, ORACLE-007 has already been violated, whether or not it is later deleted.

## 7. Status and failure semantics

### 7.1 Closed status values

Suggested registryStatus values: ACTIVE (registration valid), SUSPENDED, REVOKED (registration withdrawn), NOT_FOUND.

Oracle's public vocabulary contains exactly eight states and **fails closed by default**: VALID / INVALID / TRANSFER_PENDING / FROZEN / REVOKED / EXPIRED / REVIEW_REQUIRED / NOT_VERIFIED. Any source status that cannot be mapped resolves to NOT_VERIFIED; do not guess or default to passing. Notify Oracle before adding source status values; otherwise a new value is conservatively treated as unverifiable.

### 7.2 Error response

All failures return structured, machine-readable codes and **no natural-language reason** (which may contain personal data):

    { "errorCode": "REGISTRY_REF_NOT_FOUND", "requestId": "<string>", "serverTime": "<RFC3339>" }

HTTP status codes: 400 invalid parameters; 401/403 authentication failure; 404 reference not found; 409 state conflict; 429 rate limited; 5xx server failure.

Oracle handles **any** non-2xx response, timeout, signature-check failure, or field-validation failure consistently: the asset's public status becomes NOT_VERIFIED; stale data is not substituted. This is a core product safety property; “if unavailable, use the last value” is not acceptable.

## 8. Consistency and reconciliation

- Oracle periodically reconciles its local projection using §4.4; inconsistencies enter the human-review queue (ORACLE-008).
- The Preservation Chain should ensure that query results for the same changeRef **do not change after completion** (immutable history). If correction is necessary, create a new changeRef rather than editing in place; otherwise reconciliation cannot distinguish a correction from tampering.
- Oracle warns when clock skew exceeds ±60 seconds; both parties should use a trusted time source.

## 9. Questions for the Preservation Chain technical team

| # | Question | Impact |
| --- | --- | --- |
| 1 | Can you provide **change notifications**? If not, what is the shortest acceptable polling interval? | Determines two-step model or polling fallback in §2 |
| 2 | Can you provide **§3.3 response signatures**? If yes, which algorithm and public-key exchange method? | Determines external verifiability strength of Giraffe proofs |
| 3 | Can the interface return **only §4's listed fields**, rather than all ~260 fields? | Determines whether minimization occurs at source or Oracle |
| 4 | Can the Preservation Chain compute **owner commitments** (§6)? Is salt separated per asset? | If not, the privacy design must be revisited |
| 5 | Is the Preservation Chain also the **certificate issuer** (issuing “digital on-chain registration certificates”), or is there a separate issuer? | Determines whether the source registry records one or two authorities |
| 6 | Format and stability of registryRef: is it immutable for life, or can references be recycled? | Reuse would invalidate Oracle idempotency/reconciliation assumptions |
| 7 | Are certificate versions strictly increasing without gaps? Is previousCertificateHash guaranteed continuous? | Determines whether §4.2 chain validation can be a hard gate |
| 8 | What is the query-rate limit for change status during the **T+3 window**? | Determines settlement-path polling policy |
| 9 | Is there a sandbox/test environment and test dataset? | Determines whether Oracle can complete contract tests before production integration |
| 10 | What is the interface versioning policy? How are breaking changes announced? Can old versions run in parallel? | Determines Oracle schema-version negotiation |
| 11 | What are service levels: availability target, maintenance window, and incident-notification channel? | Determines Oracle circuit-breaker parameters and external SLA wording |
| 12 | Hashes of cultural-relic registration data will be published by Giraffe on Ethereum mainnet. Does the Preservation Chain have legal guidance or approval requirements? | Legal gate, not a technical issue, but determines whether the full path can launch |

## 10. Out of scope

- **Warehouse-provider interface:** warehouse-receipt hashes and warehouse status come from regulated warehouses, an independent source alongside the Preservation Chain, and will be specified separately.
- **Oracle writes to public chains:** outside this interface. Under PRD §5, L2 issues signed proofs only and a separate module handles on-chain activity; that module's integration with this project is constrained by PRD §0.1 and must not proceed before the decision.
- **Commercial and legal terms:** data-use authorization, liability allocation, cross-border approvals, and service agreements are outside this technical specification and require separate signatures (PRD §0.2).

---

This is a proposal draft. After item-by-item confirmation with the Preservation Chain technical team, update this document and its version. Unconfirmed clauses must not be used as Oracle implementation authority.
