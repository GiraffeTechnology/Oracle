# Giraffe RWA Oracle (L2) Product Requirements Document

## 0. Document Control

| Item | Content |
| --- | --- |
| Document name | Giraffe RWA Oracle (L2) PRD |
| Version | v0.4 |
| Date | 2026-09-03 (v0.3: 2026-08-24) |
| Status | Oracle-only scope-confirmed draft for product, architecture, legal, and development acceptance cross-reference |
| v0.4 change | The sole substantive change is D-008: ERC-721 transfers are not blocked while registration is in flight; rights are instead classified as deferrable or perishable. Requirement IDs, numbering, and scope are unchanged; 24 requirements remain. Affected items: CONSUMER-004 through CONSUMER-009, premise P7, and new §7.0. |
| Product entity | Giraffe ArtFi Corp. |
| Positioning | Verification and attestation infrastructure for RWA registration, provenance, certificates, custody, and settlement status |
| Exclusions | NFT financialization, fractionalization, lending, pledging, yield products, market making, pricing, matching, and financial settlement; all subject-level compliance functions, including KYC/AML/sanctions screening, jurisdictional eligibility, licensing eligibility, and investor suitability |
| Related documents | ACCEPTANCE_RWA_ORACLE_ZH.md (acceptance standard), STATUS.md (evidence snapshot) |
| Previous version | v0.2; this version repairs broken requirement IDs, missing premise evidence, and misattributed financial-separation clauses, and removes subject-level compliance functions incorrectly included in the protocol |

This document defines only the verification layer (L2 Oracle) in Giraffe's four-layer RWA architecture. Off-chain asset registration, cultural-property and artwork operations, custody, and certificate issuance belong to the asset layer (L1); Token standards, NFT state machines, and ERC proposals belong to an independent protocol project (L3); lending, pledging, structured products, and similar services belong to third-party applications (L4).

The L3 ERC proposal and its reference contract have been handed off to the independent task “ERC.” This repository may define facts that downstream protocols must verify, proof formats, and consumption interfaces, but this project must not assign an ERC number, submit an ERC proposal, or make implementation of a particular NFT contract an Oracle completion condition.

Compliance descriptions here are product constraints and launch gates, not statements of regulatory approval. Any mainnet, real-asset, real-funds, or public production enablement still requires a separate written go/no-go. This gate concerns cross-border cultural property, real funds, and physical-redemption rights; it is a legal release condition and must not be omitted because technical tests pass or confused with engineering schedule gates.

### 0.1 Relationship to ArtCCH:ArtFi (Decision Required First)

This product and the ArtFi commercialization project are structurally incompatible in Token semantics; three conflicts are recorded:

| Conflict | This document | Existing ArtFi product |
| --- | --- | --- |
| Fractionalization | CONSUMER-001: one physical asset, one certificate, one NFT; fractionalization prohibited | Core product: ERC-721 → Vault → ERC-20 fractions |
| Matching | CONSUMER-008: no order book, matching, or counterparty role | Quoting module M2 includes an order book and matching engine |
| Charity edition | Entirely separate from, and must not be mixed with, “issue 100 NFTs for one artwork” | Charity edition: 37 × 100 = 3,700 NFTs as its validation dataset |

Until a decision below is made, this PRD proceeds on the assumption of an independent product line and does not cite, depend on, or reuse ArtFi contracts, databases, Token semantics, or validation datasets:

- Decision A: Independent product line — separately quoted, separately maintained repository and schedule, decoupled from the ArtFi contract. No change to this document is needed.
- Decision B: ArtFi underlying layer — ArtFi must abandon fractionalization and adopt 1:1 digital title certificates; M1/M2/M3/M4 must all be rewritten, and the original quotation scope must be renegotiated. The §0.1 conflict table must become an ArtFi-side scope-change request.

The unresolved commercial and token-model decision remains a production gate. It does not change the authorized technical dependency direction: ArtFi may integrate only through the Oracle application-facing API and must not integrate ERC8415-Kit or ERC-8415 directly.

### 0.2 Scope and Schedule Contract (Pending Signature)

This PRD currently has no corresponding quotation, person-day budget, or milestone dates. ArtFi's six modules at 450 person-days / USD 155,000 do not cover any work in this project. Before the production candidate (Stage F), complete:

| Outstanding item | Owner | Due |
| --- | --- | --- |
| Person-days and quotation by module | Business | Before exit from Stage A |
| Milestone calendar (including the T+3 business-calendar convention) | PM | Before exit from Stage A |
| Third-party audit budget (legal, privacy, security, contract) | Business | Before exit from Stage E |
| Technology-stack decision: operating cost of running this repository's Node/TypeScript stack alongside ArtFi's Go backend | Architecture | Before exit from Stage B |

### 0.3 Authorized Integration Architecture and Repository Responsibilities

The final application-to-authority architecture is:

~~~text
ArtFi → Oracle → ERC8415-Kit → ERC-8415
~~~

- ArtFi consumes only the Oracle application-facing API. It must not directly integrate ERC8415-Kit, implement an ERC-8415 adapter, or own projection or settlement infrastructure.
- Oracle owns institutional-source integration, authority verification, attestation, consumption of ERC8415-Kit, the ERC-8415 integration boundary, and the application-facing API.
- ERC8415-Kit owns reusable projection and settlement infrastructure.
- ERC-8415 remains the normative protocol authority.

This allocation preserves existing code, the completed temporal projection slice, and historical evidence. It does not authorize a new settlement engine, payment integration, custody workflow, release workflow, or refund workflow. Documentation alignment is not delivery evidence.

## 1. Project Premises

The business owner has confirmed the following facts as design premises. Written support, an evidence date, and a review interval must be retained for every item; if a premise becomes invalid or cannot be evidenced, the scope must be reviewed and the premise must not continue to be treated as “confirmed.”

| # | Premise | Supporting document | Evidence date | Review interval | Owner |
| --- | --- | --- | --- | --- | --- |
| P1 | Cultural relics and artworks in China are registered on the China Cultural Relics Preservation Chain; registration includes subject-matter details and owner information | To be supplied | To be supplied | Annual | Legal |
| P2 | The China Cultural Relics Preservation Chain is supervised by the National Copyright Administration and the National Cultural Heritage Administration, its evidence is connected to the judicial chain, and it is recognized by Internet Courts | To be supplied | To be supplied | Annual | Legal |
| P3 | The operator of the China Cultural Relics Preservation Chain is Zhongchuang Wenmao (Beijing) Cultural Relics and Artworks Co., Ltd. | To be supplied | To be supplied | Annual | Legal |
| P4 | Zhongchuang Wenmao is wholly owned (100%) by the China Cultural Relics Exchange Center, is qualified for cultural-relic and artwork trading, custody, and approved import/export, and can guide warehouse supervision | To be supplied | To be supplied | Annual | Legal |
| P5 | The physical warehouse receipt records Preservation Chain registration facts, a unique registration reference, and the corresponding hash | To be supplied | To be supplied | Semiannual | Product |
| P6 | Each product NFT corresponds to exactly one unique physical item and one complete, exclusive, enforceable physical-redemption right; it is not split or shared | To be supplied | To be supplied | Semiannual | Product |
| P7 | An overseas transaction snapshot is created at T+0; the Preservation Chain completes the owner change, revokes the old certificate, and issues the new certificate no later than T+3 | To be supplied | To be supplied | Semiannual | Product |
| P8 | Giraffe does not provide NFT financialization services; third-party on-chain financial institutions may independently use NFTs in their authorized businesses, while Giraffe provides only asset-fact query and verification-interface technical support | To be supplied | To be supplied | Annual | Legal |

P1–P4 are the regulatory foundation of the product. If any one cannot be evidenced, Stage F must be blocked.

> P7 split rationale (v0.4, per D-008): In v0.3, P7 also included “the NFT becomes tradable again only after completion.” That was a product design choice, not an external-world fact, so it did not belong in the premise table. It has been removed and is now governed by D-008: transfers are not blocked while registration is in flight. The portion retained in P7 is the external fact that the Preservation Chain completes the change no later than T+3. Its evidence gap is listed in the premise register as “pending SLA/business-calendar signature”; this is a service-level convention, not a regulatory determination.
>
> A repository-wide search found no document describing “transfers must be prohibited during the settlement window” as an external requirement of the Preservation Chain, a regulator, or a compliance party. If contrary evidence is obtained later, D-008 must be reconsidered before any ERC submission.

## 2. Product Objectives

### 2.1 Core Objectives

1. Convert authoritative off-chain facts provided by Zhongchuang Wenmao, the Preservation Chain, warehouses, and certificate issuers into verifiable, revocable, time-bounded on-chain attestations.
2. Provide independently verifiable factual attestations to downstream protocols implementing “one asset, one certificate, one Token”; do not issue or transfer Tokens.
3. Preserve traceability among assets, warehouse receipts, authoritative registrations, and certificate versions, and detect conflicts or multiple valid claims of right.
4. Establish a deterministic state machine for fixing the T+0 snapshot and completing T+3 registration and certificate reissuance, so the confirmed holder at any past time can be resolved uniquely.
5. Provide factual queries and technical integration capabilities to third-party applications while strictly separating all financial products, decisions, and execution.

### 2.2 Success Criteria

- Any valid NFT can be traced back to one unique asset, current valid certificate, warehouse-receipt hash, Preservation Chain registration reference, and settlement status.
- If an asset has multiple current certificates, warehouse receipts, or claims of right, Oracle must return a conflict and stop issuing valid attestations.
- From T+0 until registration completes, Oracle must continuously return TRANSFER_PENDING or a stricter status.
- After registration completes, Oracle must issue an attestation containing the new certificate hash, incremented version, and prior-certificate hash.
- Every Oracle output can be verified for source, signature, time, validity period, and revocation status.
- Giraffe produces no conclusion on price, collateral ratio, yield, credit, or investor suitability.

## 3. Four-Layer Architecture and Product Boundary

| Layer | Responsible party | Responsibility of this product |
| --- | --- | --- |
| L1 Asset layer | Zhongchuang Wenmao, Preservation Chain, regulated warehouses, certificate issuer | External authority foundation; Giraffe does not replace their appraisal, registration, custody, or approval |
| L2 Verification layer | Giraffe RWA Oracle | The sole implementation scope of this PRD: query, verification, signed attestations, status synchronization, revocation, and audit |
| L3 Protocol layer | Independent ERC/protocol project | This PRD defines only the compatibility boundary for consuming Oracle attestations; it does not implement NFTs or own ERC submissions |
| L4 Application layer | External markets, wallets, licensed on-chain financial institutions, etc. | Independent third-party responsibility; not Giraffe's financial or trading business |

The operational dependency chain is ArtFi → Oracle → ERC8415-Kit → ERC-8415. Oracle is the business and institutional integration layer, not an ArtFi vertical application. ArtFi consumes only Oracle's application-facing API. Oracle consumes ERC8415-Kit, and ERC8415-Kit implements reusable infrastructure under the normative authority of ERC-8415.

### 3.1 Giraffe's Exact Role

Giraffe is:

- An oracle for RWA asset facts and provenance;
- A query service for ownership and custody status;
- A T+0/T+3 state-coordination and factual-attestation service;
- A provider of third-party verification APIs, SDKs, and integration technical support.

Giraffe is not:

- An appraisal or valuation institution for cultural property;
- An entity trading, storing, or importing/exporting cultural property within China;
- A securities issuer, broker, exchange, market maker, or clearing institution;
- A lender, pledge platform, fund, SPV, yield product, or derivatives provider;
- An agent, underwriter, risk manager, or collateral liquidator for a third-party financial institution;
- A KYC/AML/sanctions screening provider, compliance-review institution, or jurisdictional eligibility assessor.

### 3.3 Subject-Level Compliance Boundary (Added in v0.3)

Oracle relays only authoritative-source facts about assets. It does not produce, relay, or adjudicate compliance conclusions about people or institutions.

| | Within this protocol | Outside this protocol |
| --- | --- | --- |
| Subject | Assets, warehouse receipts, certificates, registrations, physical status | Compliance identity of natural persons, institutions, or wallet holders |
| Examples (in scope) | Whether a registration exists; certificate hash and version; warehouse-receipt hash; encumbrance; judicial freeze; transferEligibility | — |
| Examples (out of scope) | — | KYC result, AML risk rating, sanctions-list match, jurisdictional eligibility, licensing eligibility, investor suitability |
| Responsible party | Giraffe Oracle | Each institution independently |

transferEligibility means only asset-side transferability declared by an authoritative source (registration, custody, encumbrance, judicial freeze); it does not include the compliance status of any counterparty. No institution may claim that its KYC, AML, sanctions, or suitability obligations have been satisfied because Oracle returned VALID.

A judicial freeze is an in-scope fact about an asset reported by an authoritative source; compliance evaluation of the person subject to the freeze is out of scope.

### 3.2 Requirement ID System

| Prefix | Meaning | Implementer | Acceptance method |
| --- | --- | --- | --- |
| ORACLE-* | L2 verification-layer requirement | This project | Project automation tests and runtime evidence |
| CONSUMER-* | Downstream protocol-consumption constraint | Independent protocol project (L3) | This project uses a synthetic consumer to verify that the constraint can be enforced |
| NFR-* | Non-functional requirement | This project | Load tests, drills, and audit records |

CONSUMER-* items are not deliverables of this project. This project's obligation is to prove these constraints can be enforced on the Oracle side: invalid, conflicting, expired, revoked, out-of-order, or replayed inputs cannot pass verification. Acceptance of downstream implementations belongs to the L3 project.

## 4. Roles and Permissions

| Role | Permissions | Prohibited actions |
| --- | --- | --- |
| Zhongchuang Wenmao registrar | Confirm registration facts, owner changes, certificate issuance/revocation, and Preservation Chain references | Must not bypass its own review process through a Giraffe interface |
| Custodian/warehouse | Confirm physical items, warehouse receipts, freeze/unfreeze, redemption, and encumbrance status | Must not issue multiple simultaneously valid redemption credentials for the same physical item |
| Giraffe Oracle | Verify authoritative inputs, issue time-bounded attestations, publish statuses and revocation events | Must not determine ownership, valuation, or financial eligibility independently |
| Downstream protocol implementer | Independently consume Oracle attestations and execute the Token lifecycle | Not within this Oracle project's implementation or ERC-submission scope |
| Seller | Initiate listing/transfer and accept fixation of the T+0 snapshot | While a gap is open, may not redeem or pledge (perishable exercises); Token transfers remain unrestricted |
| Buyer | Escrow payment and acquire confirmed attribution once the T+0 time is final | May not redeem before that time is final; Token transfers remain unrestricted |
| Third-party financial institution | Query asset-fact attestations and independently decide whether to conduct its business | Must not describe query results as Giraffe financial approval, compliance clearance, or guarantee |
| Authorized third party (custody/payment/compliance provider) | Independently perform fund custody, payment, and subject-level compliance checks | Its check results are not included in Oracle attestations and are not protocol gates |
| System auditor | Read immutable audit records and attestation chains | Must not modify business status or access personal information without authorization |

Production permissions must implement separation of duties. Zhongchuang Wenmao registration confirmation and Giraffe settlement execution must not be controlled by the same single key.

## 5. Core Object Model

### 5.1 AssetRecord

~~~text
assetId
wenbaoRegistryRef
assetFingerprintHash
classificationCode
transferEligibility
warehouseId
warehouseReceiptHash
currentCertificateHash
currentCertificateVersion
currentOwnerCommitment
encumbranceStatus
oracleStatus
updatedAt
~~~

### 5.2 CertificateRecord

~~~text
assetId
tokenId
certificateVersion
certificateHash
previousCertificateHash
wenbaoChangeRef
warehouseReceiptHash
effectiveAt
supersededAt
status
~~~

Certificate history must be append-only and must never be overwritten or deleted. A public chain stores only irreversible hashes, versions, and non-sensitive references; it must not store names, identity-document numbers, addresses, complete warehouse receipts, complete certificates, or other personal information.

### 5.3 OracleAttestation

~~~text
attestationId
schemaVersion
assetId
tokenId
factType
factValue
sourceAuthority
sourceRecordHash
observedAt
validFrom
expiresAt
nonce
revocationRef
signerSetId
signature
~~~

Every attestation must bind the request purpose, chain, contract, and Token ID to prevent cross-chain, cross-asset, and cross-purpose replay.

### 5.4 SettlementRecord

~~~text
settlementId
assetId
tokenId
sellerWallet
buyerWallet
t0SnapshotHash
externalExecutionRef
oldCertificateHash
newCertificateHash
wenbaoChangeRef
status
startedAt
deadlineAt
finalizedAt
failureReasonHash
~~~

## 6. L2 Verification-Layer Requirements (Implementation Scope of This Project)

### ORACLE-001 Authoritative Source Registry

The system must use an approved source registry that identifies at least Zhongchuang Wenmao, the Preservation Chain, and the custodian/warehouse. Callers must not provide arbitrary URLs, RPC endpoints, database addresses, or replacement sources in requests. Unknown sources are rejected by default.

### ORACLE-002 Fact Queries

The system must provide queries for:

- Whether an asset registration exists;
- Whether the NFT and physical item remain in a 1:1 relationship;
- Current certificate hash and version;
- Warehouse-receipt hash and custody status;
- Current owner commitment and wallet-binding status;
- Whether the item is frozen, seized, pledged, under redemption, or in settlement;
- Whether transfer is permitted;
- Whether the T+0 snapshot and T+3 settlement are complete;
- Whether an attestation has expired, been revoked, or requires human review.

Query results may use only:

~~~text
VALID
INVALID
TRANSFER_PENDING
FROZEN
REVOKED
EXPIRED
REVIEW_REQUIRED
NOT_VERIFIED
~~~

### ORACLE-003 Signed Attestations

Every attestation must include a versioned schema, source hash, observation time, validity period, nonce, signer set, and revocation reference. The system must fail closed if an attestation is expired, has insufficient signatures, has inconsistent sources, or has unavailable dependencies.

### ORACLE-004 Revocation and Emergency Freeze

When a Preservation Chain registration is withdrawn, a certificate becomes invalid, a custody anomaly or judicial freeze occurs, or a source dispute arises, the system must:

1. Revoke attestations that have not yet expired;
2. Change protocol status to FROZEN or REVIEW_REQUIRED;
3. Refuse affected attestations and irreversible exercises, and publish the authoritative asset-specific emergency restriction. The compatible consumer/application must enforce the existing emergency transfer/redemption block for the affected asset under its authorized policy. This preserves ORACLE-004 emergency enforcement without giving Oracle independent token-control authority; the restriction must not be inferred from an ordinary open projection gap or added as a universal ERC-8415 rule;
4. Retain the reason hash, operator, time, and evidence reference;
5. Publish an idempotent event to subscribers.

### ORACLE-005 Isolation of Subject-Level Compliance Conclusions

> v0.2 allowed Oracle to return status attestations for KYC, AML, sanctions, and jurisdictional eligibility. This placed institutional business-compliance functions in the protocol, conflicting with §§3.1 and 3.3; v0.3 reversed this and prohibited those functions.

The system must not generate, store, relay, or return any compliance conclusion about a natural person or institution, including but not limited to:

- KYC verification results or levels;
- AML risk ratings or suspicious-transaction determinations;
- Whether a sanctions-list match exists;
- Jurisdictional eligibility, investor suitability, or professional-investor classification;
- Licensing eligibility or business-qualification evaluations.

Each institution independently handles subject-level compliance under its own regulatory obligations. The protocol neither provides, acts as agent for, nor caches such conclusions; their absence must not block asset-fact queries.

The currentOwnerCommitment and wallet-binding status are authoritative-source-issued **asset-ownership facts**, not subject-level compliance conclusions, and are in scope.

### ORACLE-006 Prohibited Financial Outputs

The system must not generate or return:

- Valuation, market prices, or price forecasts;
- Collateral ratios, liquidation prices, or credit scores;
- Interest rates, yields, or liquidity curves;
- Investment recommendations or financial-product compliance approvals;
- Conclusions equivalent to “suitable for investment” or “guaranteed liquid.”

### ORACLE-007 Privacy and Data Minimization

- Public chains store only hashes, versions, statuses, and non-sensitive references.
- Owner names, identity documents, addresses, custody details, and full certificates remain only in authorized systems.
- The mapping between wallet addresses and real-world identities must not be public.
- Cross-border transfers include only the minimum fields required to complete the transaction and verification.
- Querying institutions are authorized by purpose; record the accessor, purpose, fields, time, and result.
- Third-party queries must not disclose personal identity materials, keys, internal server information, or unpublished certificate text.

### ORACLE-008 Audit and Traceability

- Retain immutable audit records for every state transition, attestation issuance, revocation, certificate upgrade, and administrator operation.
- Make the full T+0-to-T+3 process and certificate history auditable by replay.
- Store time uniformly in UTC and display it in the user's interface time zone; version the T+3 business calendar and deadline rules.

### ORACLE-009 Financial Separation (Giraffe's Own Obligation)

> In v0.2 this item was incorrectly classified as a downstream constraint (formerly PROTOCOL-009). It governs Giraffe's own conduct and is therefore within this project's implementation and acceptance scope under §6.

Third-party on-chain financial institutions may independently perform their authorized operations on NFTs. Giraffe provides only queries, attestations, SDKs, documentation, and interface troubleshooting. Giraffe must not:

- Design, deploy, or jointly operate third-party financial-product contracts;
- Submit, sign, or custody financial transactions on behalf of users;
- Match financing, participate in credit decisions, valuation, liquidation, forced liquidation, or collateral disposal;
- Receive principal, interest, yield, or liquidation proceeds;
- Charge compensation based on financing amount, yield, or financial transaction volume;
- Describe technical verification results as financial-product approval, guarantee, or investment advice.

Permitted fee items are limited to fixed subscriptions, queries, attestation issuance, and general interface technical support, none of which may be linked to financial-transaction outcomes.

### ORACLE-010 Consumer Adapter and SDK

Oracle may provide a read-only verification library or on-chain consumer adapter, but this must not make Oracle responsible for NFT issuance, trading, custody, or ownership of the ERC standard. Adapter acceptance is limited to whether attestations are correctly verified, expired or revoked attestations are rejected, asset/chain/contract/Token/purpose binding prevents replay, and consumer failure is fail-closed.

## 7. Downstream Protocol Consumption Constraints (Outside This Project's Implementation Scope)

This section does not define an ERC or require this project to deploy an NFT contract. It specifies the security semantics that any downstream protocol claiming compatibility with Giraffe Oracle must follow when consuming attestations. The independent “ERC” task maintains normative ERC interfaces, numbers, reference contracts, and community-submission workflow.

This project's obligation for this section is stated in §3.2: use a synthetic consumer to prove that these constraints can be enforced on the Oracle side.

### 7.0 Right Classification: Deferrable and Perishable (Added in v0.4 per D-008)

The off-chain registry updates asynchronously. There is a window between a T+0 transaction and completion of T+3 registration during which the question “who was the confirmed holder at a given time?” has no final answer. This section defines how each type of right is handled in that window.

v0.3 froze the Token until registration completed. v0.4 no longer does so because freezing does not solve the problem it was intended to solve: **blocking transfers cannot make the question answerable; it only shifts the cost of uncertainty to the holder** and destroys rights whose recording time falls within the window.

#### Change to the Baseline

Rights are no longer determined by “who currently holds the Token.” The baseline is instead the on-chain projection, using two queryable facts:

| Fact | Meaning |
| --- | --- |
| Confirmed holder at a given time | The party that the registry has confirmed held the asset at that time |
| Whether that time is final | Whether later registry entries can still change the answer for that time |
| Whether an unresolved gap exists | Whether that Token has an unclosed registration change |

#### Two Classes of Rights

| Class | Rule | Typical examples |
| --- | --- | --- |
| Deferrable right | May be initiated during the window. Settlement is deferred until the relevant time is final and executed for the confirmed holder at that time. It is neither blocked nor lost. | Notices and other independently permitted deferrable rights; this classification grants no dividend or yield right to this product |
| Perishable right | The relevant time must be final and have no unresolved gap; otherwise reject that exercise. | Redemption, destruction, voting, and any irreversible one-time exercise |

The test is whether the exercise is **irreversible**: if it cannot be corrected after attribution is determined, it is perishable; if it can be deferred and delivered to the correct holder without losing its meaning, it is deferrable.

#### Difference from Freezing

What is rejected is **that particular exercise**, not the Token's **transferability**.

The effect is equivalent to freezing—no irreversible action occurs while attribution is unresolved—but the Token remains transferable throughout, the market is not blocked, and there is no longer tension with CONSUMER-008 external-market compatibility: external markets need not understand a custom non-transferable state.

#### Four Distinct Meanings of “Freeze” (Terminology)

In this document, “freeze” refers to four distinct things. They must not be conflated in reading or implementation:

| # | Concept | Usage in this document | v0.4 status |
| --- | --- | --- | --- |
| 1 | Snapshot freeze | Fix the T+0 snapshot hash; the data cannot change | Retained |
| 2 | Transfer freeze | Prohibit ERC-721 transfers while registration is in flight | **Removed** |
| 3 | Emergency freeze | ORACLE-004: revoke attestations and block operations when registration is withdrawn, a certificate becomes invalid, a judicial freeze occurs, or a source dispute arises | Retained; unrelated to this change |
| 4 | External encumbrance status | encumbranceStatus: a freeze/seizure/pledge code reported by the Preservation Chain | Retained. This is a source fact, not an action taken by this product |

Item 3 is revocation of an already-issued attestation, triggered by an abnormal external authoritative status and unrelated to the settlement window. Item 4 is a registration fact on the Preservation Chain side; this product only reads and presents it and neither creates nor removes it.

### CONSUMER-001 One Asset, One Certificate, One NFT

- Each assetId maps to at most one valid Token ID;
- Each Token ID maps to only one assetId;
- Fractionalization, batch issuance with identical rights, and mapping one redemption right to multiple Tokens are prohibited;
- Duplicate asset fingerprints, current certificates, or warehouse receipts must be rejected at issuance;
- NFTs must not carry rights to dividends, interest, yield distributions, buybacks, or price support.

### CONSUMER-002 Initial Issuance

Before initial issuance, obtain a valid Oracle attestation confirming at least that:

- The asset is registered on the Preservation Chain;
- Zhongchuang Wenmao confirms the registration and permission to enter this protocol;
- The warehouse receipt is valid and its hash matches;
- The current certificate is valid;
- No encumbrance prevents issuance;
- The receiving wallet is bound to the lawful holder;
- No other valid Token already represents the asset.

### CONSUMER-003 Lifecycle

Permitted states:

~~~text
DRAFT
VERIFIED
ACTIVE
TRANSFER_PENDING
SETTLED
FROZEN
REVIEW_REQUIRED
REVOKED
REDEEMED
~~~

Primary state machine:

~~~text
VERIFIED -> ACTIVE(v1)
ACTIVE(vN) -> TRANSFER_PENDING
TRANSFER_PENDING -> SETTLED
SETTLED -> ACTIVE(vN+1)
TRANSFER_PENDING -> ACTIVE(vN)       # failure rollback
Any usable state -> FROZEN/REVIEW_REQUIRED
ACTIVE -> REDEEMED                   # circulation ends after redemption
~~~

Any state transition without a valid attestation must revert.

### CONSUMER-004 T+0 Snapshot and Registration Gap

> v0.4 change (D-008): This item was formerly titled “T+0 Snapshot and Freeze.” Snapshot freeze is retained (item 1; data is fixed); transfer freeze is removed (former items 2 and 4). The title was changed to eliminate ambiguity around “freeze”; see the four-way distinction in §7.0.

After an external market reports a matched trade, the system must at T+0:

1. Generate and fix a snapshot hash containing the asset, Token, buyer and seller wallets, external execution reference, old certificate, warehouse receipt, and time; the snapshot must not change thereafter;
2. Record the T+0 time as the baseline for determining subsequent rights attribution;
3. Open a registration gap and place the prior certificate and physical item in TRANSFER_PENDING;
4. Create an owner-change task due no later than T+3;
5. Handle operations in the window under §7.0:
   - Ordinary ERC-721 transfers must not be blocked; ownerOf changes immediately with each transfer;
   - Perishable exercises (redemption, destruction, and any irreversible one-time exercise) must be rejected until the relevant time is final and has no unresolved gap;
   - Deferrable rights may be initiated; settlement is deferred until the relevant time is final and executed for the confirmed holder at that time;
6. Process duplicate events idempotently; do not open duplicate gaps or create duplicate tasks.

The NFT must not be placed in protocol custody, a non-transferable state, or any equivalent transfer-blocking mechanism. The Token remains freely tradeable while the gap is open—this is not an omission but a direct requirement of §7.0: blocking transfers cannot resolve the gap; it only shifts uncertainty costs to holders and destroys rights whose recording time falls within the window.

Funds custody, payment, and market matching must be performed by authorized third parties and must not enter Giraffe accounts or key-control scope.

#### Settlement Authority: Who May Open a Gap

The party responsible for the off-chain register (the Zhongchuang Wenmao / Preservation Chain side), not the current Token holder and not the external market, has authority to open a registration gap. The downstream protocol must expose this authority explicitly as a queryable fact; it must not be implicit or derived from ownerOf.

There are two necessary reasons:

| If authority comes from ownerOf | Consequence |
| --- | --- |
| Registrar cannot open a gap | A completed registry change cannot be recorded on-chain—the party responsible for the registry cannot record its own change |
| Token holder may open a gap | The last buyer could repeatedly supersede workflow requests and obstruct registrar processing; gap operations themselves must not alter the finality accessor |

Neither authority follows from holding a tradeable position. Third parties that depend on the projection but have no relationship with the registrar need a queryable answer as to who holds this authority; the answer may differ by deployment.

The configuration layer must also constrain the boundary of supersession: superseded settlements cannot be finalized, and attestations already produced for them become invalid. Unbounded supersession is equivalent to indefinitely censoring registry updates.

> Protocol provenance: ERC-8415 is the normative authority. The earlier unnumbered settlement draft is historical; its optional settlement authority surface is not a claim that Kit v2.0 supplies a settlement product. Pin the exact supported interface and source revision for each integration, preserve the existing temporal slice, and do not revive archived draft rules.

### CONSUMER-005 T+3 Settlement

Settlement may be completed only after all of the following evidence is obtained:

- The Preservation Chain owner change is complete;
- Zhongchuang Wenmao has issued the new certificate and revoked the old certificate;
- The custodian/warehouse confirms the new redemption-right holder;
- New certificate, warehouse receipt, and T+0 snapshot hashes match;
- The Oracle attestation is valid and not revoked;
- The new holder's wallet binding is valid.

The settlement subject is the confirmed holder at T+0, not the current holder when settlement occurs. Before closing the gap, the system must confirm that the T+0 time is final; no settlement may occur while it is not final. Tokens may have changed hands several times during the gap, but that does not affect who settles: the registry record for T+0 determines attribution, not on-chain possession.

After success, the system must:

1. Keep the original Token ID unchanged;
2. Update currentCertificateHash to the new certificate hash;
3. Increment certificateVersion;
4. Store previousCertificateHash and the full append-only history;
5. Record the confirmed holder at T+0 in the projection and close the gap;
6. Set status to ACTIVE;
7. Publish CertificateSuperseded and SettlementFinalized events.

> v0.4 change (D-008): Former item 5, “release the NFT to the new holder,” and item 8, “restore the ability to trade,” were removed—the Token was never seized or made non-tradeable during the window, so there is nothing to release and no ability to restore. Settlement closes the gap and confirms attribution; it does not lift a freeze.

### CONSUMER-006 T+3 Failure and Timeout

If any required confirmation fails, conflicts, or times out, the system must:

- Not write the new certificate hash;
- Not display the buyer as having completed ownership of the redemption right;
- Notify the third-party escrow system to execute its refund process;
- Retain a SettlementCancelled or SettlementDisputed audit event;
- Defer disposition of the physical item to Zhongchuang Wenmao/warehouse evidence.

Cancellation or timeout does not make any time final. After a gap is cancelled, the T+0 time remains **non-final**—it is not a “definitive failure” and attribution does not “revert to the former holder.” The distinction is substantive:

- Non-final means later registry entries can still provide the answer for that time, so perishable exercises must still be rejected;
- Misclassifying it as final would allow irreversible actions before the registry has spoken, exactly what this model prevents.

Token transferability is also unaffected on the failure path—there is no action to “restore it to the former holder” because it was never moved. Former item 4 was removed accordingly.

#### Timing Constraint on Cancellation

Cancellation may occur only after the T+3 deadline; cancellation before the deadline must be rejected. Otherwise, an initiating party could cancel early after the registry has actually completed the change but before proof submission, unilaterally discarding a record that is already final remotely.

Cancellation does not change the projection: it writes no entry and therefore makes no time final (see above).

> Cancellation of a workflow must not be confused with an authoritative rejection record. A missing local notification is neither. Historical draft cancellation ABIs do not prescribe a current ERC interface.

### CONSUMER-007 Redemption and Termination

Redemption is a perishable right (§7.0): delivery is irreversible and cannot be corrected after attribution is known.

Redemption therefore requires all of the following:

1. The time on which the exercise is based is final;
2. The Token has no unresolved registration gap;
3. The exercising party is the confirmed holder at that time.

If any condition is not met, reject that exercise, but do not restrict Token transferability.

After the warehouse completes delivery and the Preservation Chain confirms it, the NFT must enter REDEEMED and must not continue to trade as a valid redemption right. Whether the Token is burned or retained as a historical credential is determined by release policy, but it cannot again become a valid redemption right.

> v0.4 change (D-008): The former sentence “only the current ACTIVE holder may initiate redemption” depended on the freeze mechanism that placed the Token in a non-ACTIVE state during the window. That mechanism is removed, so the rule now depends on temporal finality. In the former phrase “retain as a non-transferable historical credential,” non-transferable refers to the REDEEMED terminal state no longer being traded; it is unrelated to the removed transfer freeze during the window. The text is retained but rewritten to avoid confusion.

### CONSUMER-008 External-Market Compatibility

The protocol may be compatible with authorized external markets, but Giraffe does not build an order book, conduct anonymous matching, become a counterparty, or control market funds. External-market events may trigger a pending T+0 intent only; they must not bypass Oracle or certificate-update gates.

The Token always appears to external markets as an ordinary ERC-721. While a registration gap is open, there is no custom non-transferable state that an external market must understand; the gap, finality, and confirmed holder are queryable facts, not gates on the transfer path.

> v0.4 change (D-008): The v0.3 transfer freeze was inherently in tension with this item—external markets would not understand a custom non-transferable state, while this item requires compatibility with external markets. Removing the transfer freeze resolves that tension; no reconciliation between “external-market compatibility” and “blocking transfers during the window” is needed.

### CONSUMER-009 Fail-Closed Attestation Consumption

Downstream consumers must deterministically reject invalid, expired, revoked, out-of-order, or replayed attestations and fail closed when dependencies are unavailable. They must not continue state transitions using cached attestations, defaults, or optimistic assumptions.

Fail-closed behavior must cover both cases below; neither may be treated as “the attestation is valid, so proceed”:

| Case | Requirement |
| --- | --- |
| The relevant time is not yet final | Reject perishable exercises. The attestation itself may be entirely valid; a valid attestation does not mean attribution is final |
| The Token has an unresolved registration gap | Same. An open gap is a separate product exercise restriction; it does not redefine whether the queried instant is final |

> v0.4 addition (D-008): v0.3 fail-closed conditions covered only attestation validity. That was sufficient under the freeze model because a Token could not move while attribution was unresolved. Once the transfer freeze is removed, “attestation is valid” and “attribution is final” are independent facts and must be checked separately; otherwise, an irreversible exercise could be allowed while the attestation is valid but attribution remains unresolved.

## 8. Oracle On-Chain Consumer Adapter

Oracle owns the ERC-8415 adapter and consumes ERC8415-Kit for reusable projection infrastructure. ArtFi must not implement or directly integrate this adapter. The current verified Kit handoff covers the v2.0 temporal projection surface only; optional gap behavior and legacy settle() must not be represented as a v2.1 or v2.2 settlement product.

The following interface is a non-normative compatibility example from existing product discussions. It is not an ERC draft or a mandatory ABI for Oracle production deployments. Downstream contracts may differ; acceptance criteria are in ORACLE-010.

~~~solidity
function assetOf(uint256 tokenId) external view returns (bytes32 assetId);
function currentCertificateHash(uint256 tokenId) external view returns (bytes32);
function certificateVersion(uint256 tokenId) external view returns (uint64);
function transferStatus(uint256 tokenId) external view returns (uint8);
function beginSettlement(
    uint256 tokenId,
    bytes32 settlementId,
    bytes32 snapshotHash,
    address expectedBuyer,
    uint64 deadline
) external;
function finalizeSettlement(
    uint256 tokenId,
    bytes32 settlementId,
    bytes32 newCertificateHash,
    bytes32 wenbaoChangeRef,
    bytes calldata oracleAttestation
) external;
function cancelSettlement(
    uint256 tokenId,
    bytes32 settlementId,
    bytes32 reasonHash
) external;
function freeze(uint256 tokenId, bytes32 reasonHash) external;
function markRedeemed(uint256 tokenId, bytes32 redemptionEvidenceHash) external;
~~~

Minimum events:

~~~solidity
event SettlementStarted(...);
event CertificateSuperseded(...);
event SettlementFinalized(...);
event SettlementCancelled(...);
event AssetFrozen(...);
event AttestationRevoked(...);
event AssetRedeemed(...);
~~~

## 9. Minimum API

This is the application-facing boundary consumed by ArtFi. ArtFi must not bypass it to call ERC8415-Kit or an ERC-8415 adapter directly.

~~~text
GET  /healthz
GET  /readyz
GET  /v1/oracle/statuses
GET  /v1/rwa/assets/{assetId}
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/certificate-history
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/transfer-eligibility
GET  /v1/rwa/attestations/{attestationId}
POST /v1/rwa/attestations/verify
POST /v1/rwa/settlements
GET  /v1/rwa/settlements/{settlementId}
POST /v1/rwa/settlements/{settlementId}/finalize
POST /v1/rwa/settlements/{settlementId}/cancel
POST /v1/rwa/revocations
~~~

All write interfaces must use strong authentication, RBAC, request signatures, idempotency keys, replay protection, and immutable audit logs. External writes are disabled in the current iteration and cannot be enabled by this iteration; development services bind to localhost only.

Interface names must not contain subject-level compliance semantics such as kyc, aml, sanction, suitability, or accredit; transfer-eligibility returns asset-side transferability only.

## 10. UI Requirements

### ORACLE-011 Asset Detail Display

The asset detail view must display:

- One physical item / one NFT identification;
- Preservation Chain registration status and non-sensitive reference;
- Current certificate hash, version, and update time;
- Warehouse-receipt hash and custody status;
- NFT status and whether trading/redemption is permitted;
- T+0 snapshot time, T+3 deadline, and current progress;
- Data source, observation time, and attestation expiry time;
- An explicit statement that Giraffe does not provide financialization services.

During a transaction, the UI must distinguish:

- Snapshot fixed: T+0 has matched; the gap is open and not yet closed;
- Registration in progress: Preservation Chain change and certificate reissuance are in progress;
- Settlement complete: certificate hash is updated, the T+0 time is final, and the gap is closed;
- Settlement failed/disputed: do not display the new holder as having obtained a complete redemption right; show that the time is still non-final, not “definitively failed” or “attribution reverted to the former holder.”

The UI must not describe any of these states as “Token locked,” “non-transferable,” or equivalent—the Token remains transferable throughout the entire window (D-008). While the gap is open, also display whether the time is final, whether an unresolved gap exists, and that perishable exercises such as redemption will be rejected during this period, so holders do not infer that transferability also permits redemption.

> v0.4 change (D-008): The former label was “Trade Locked,” and the former “Settlement Complete” text said “NFT tradability restored.” Both implied that the Token could not be traded during the window, contrary to §7.0, and have been rewritten.

Query pages must not contain misleading wording about valuation, yield, collateral ratios, financial recommendations, or “SEC approval.”

## 11. Security and Non-Functional Requirements

### NFR-001 Keys and Permissions

- Separate Oracle signing keys from protocol-administrator permissions; use multisignature or threshold signatures in production.
- Administrators must not bypass Zhongchuang Wenmao, the custodian/warehouse, and Oracle attestations to restore trading directly.
- Contract upgrades, signer rotation, emergency pause, and recovery must each have timelocks, audits, and rollback plans.
- Production credentials, personal data, original documents, and signing keys must not enter this repository; all test fixtures must be synthetic.

### NFR-002 Replay Protection and Ordering

- Bind all attestations to chain ID, contract, Token ID, nonce, validity period, and schema version.
- Certificate upgrades must prevent replay, out-of-order events, duplicate settlement, and an old attestation overwriting a new version.

### NFR-003 Fail Closed by Default

If any authoritative source is unavailable, inconsistent, or times out, the system defaults to frozen or review-pending status. It must not guess, use cached values, or fall back to optimistic defaults.

### NFR-004 Availability and Recovery

- Target query API availability of at least 99.9%.
- Settlement write services must support queue recovery and idempotent retries.
- Provide drills for reconciliation, disaster recovery, key rotation, certificate conflicts, and data-source interruptions.

## 12. Public-Statement Boundaries

Permitted product statement:

> Giraffe provides RWA provenance, custody and settlement attestations about assets, and a 1:1 digital title protocol connecting authoritative off-chain cultural-asset records with blockchain systems. Giraffe does not provide or participate in NFT financialization.

Prohibited statements:

- SEC approved / SEC certified;
- Guaranteed not to be a security;
- Guaranteed appreciation, liquidity, yield, or marketability;
- Giraffe officially appraises or values physical items;
- Giraffe approves, guarantees, or underwrites third-party financial products;
- A Preservation Chain hash itself replaces Zhongchuang Wenmao, warehouse, or statutory approval;
- Giraffe has completed KYC, AML, sanctions, or suitability checks on any natural person or institution;
- A query returning VALID means a counterparty is compliant.

The non-security design of a 1:1 NFT depends on actual rights, issuance method, marketing materials, and transaction facts. If a third party creates lending, pledging, packaging, securitization, yield, or derivatives products based on the NFT, that is an independent third-party business; all licensing, disclosure, suitability, custody, clearing, AML, and regulatory responsibilities belong to that third party.

## 13. Phased Delivery

The completed temporal projection slice and its historical evidence are preserved. The main baseline now includes the read-only Oracle application integration boundary over the pinned ERC8415-Kit temporal surface. The next bounded work must be authorized separately and does not authorize a new settlement engine, payment or custody handling, or a delivery claim.

The complete mapping between stage exit criteria and requirement IDs is in ACCEPTANCE_RWA_ORACLE_ZH.md §5.

| Stage | Content | Primary coverage |
| --- | --- | --- |
| A Contract and data contract | Fix roles and responsibilities; confirm authoritative fields, signature format, change SLA, T+3 calendar, revocation and dispute process; complete data-minimization, retention, and cross-border-transfer assessment | P1–P8 evidence, ORACLE-001, ORACLE-007 |
| B L2 Oracle sandbox | Source adapters, attestation schema, signature verification, expiry, revocation, and query API; use synthetic assets and identities for conflict, latency, offline, and replay tests | ORACLE-001 through ORACLE-009, NFR-001 through NFR-003 |
| C Downstream protocol compatibility tests | Synthetic downstream consumers verify attestation validation, status inputs, revocation, expiry, and certificate-upgrade events; test SDK, verification library, adapter, and fail-closed semantics | ORACLE-010, CONSUMER-001 through CONSUMER-009 |
| D Controlled end-to-end drill | External-market event, Oracle, Preservation Chain test interface, certificate reissuance, and recovery-settlement drill; reconciliation, timeout, dispute, revocation, freeze, disaster recovery | Full scope + NFR-004 |
| E Third-party read-only integration | Provide query API, SDK, and verification library to authorized third parties; verify they cannot trigger Giraffe financial transactions, bypass gates, or obtain subject-level compliance conclusions | ORACLE-005, ORACLE-009 |
| F Production candidate | Independent legal, privacy, security, contract, and operations audits; remediation and retest; separate approval for mainnet, real assets, external markets, and each jurisdiction | Full scope + completion of §0.2 contract |

Stages A–E use synthetic data only; they do not touch real assets, real funds, or real personal information.

## 14. Production Release Blockers

Block production release if any of the following applies:

- One asset, one certificate, one NFT cannot be proven;
- Preservation Chain, certificate, or warehouse-receipt hashes do not match;
- Zhongchuang Wenmao or custodian/warehouse status cannot be verified;
- Any regulatory premise P1–P4 cannot be evidenced;
- Oracle treats an open gap or a valid attestation as sufficient for a perishable exercise, fabricates finality, or restricts ordinary ERC-721 transfer merely because registration is pending;
- Oracle attests that the buyer has completed settlement before the authoritative registry has completed;
- The old certificate is not revoked or certificate history is overwritten;
- Oracle can determine ownership independently or bypass authoritative sources;
- API, UI, or contract includes valuation, yield, collateral ratios, investment advice, or financial-product approval;
- Oracle output, schema, interface names, or contract include KYC, AML, sanctions, jurisdictional eligibility, suitability, or licensing conclusions;
- Giraffe handles third-party financial-transaction signatures, funds, credit, clearing, or outcome-based compensation;
- Personal information, certificate text, warehouse-receipt text, or identity mapping enters a public chain;
- Independent legal, security, privacy, or Oracle consumer-adapter audit is missing;
- Separate written approval for mainnet, real assets, and real funds is missing;
- ArtFi integration has occurred before the §0.1 decision;
- The §0.2 scope and schedule contract remains unsigned.

## 15. Regulatory and Rules References

- SEC Release No. 33-11412 / 34-105020, Application of the Federal Securities Laws to Certain Types of Crypto Assets and Certain Transactions Involving Crypto Assets.
- SEC 2026 Statement on Tokenized Securities.
- Civil Code of the People's Republic of China provisions on delivery by instruction, warehouse receipts, and warehousing contracts.
- Cultural Relics Protection Law of the People's Republic of China and applicable rules for cultural-property trading, custody, import, and export.
- Provisions of the Online Litigation Rules of the People's Courts concerning verification of blockchain electronic evidence.
- Applicable privacy, cross-border data, and consumer-protection rules (governing Giraffe's own data-processing conduct).

KYC, AML, sanctions, and investor-suitability rules govern the respective institutions themselves; they are not implementation or acceptance requirements of this protocol and are listed here only to clarify ownership.

These references do not replace jurisdiction-specific legal advice, regulatory engagement, or approval to launch real assets. During Stage A, verify the currently effective version of every cited provision and record the verification date.
