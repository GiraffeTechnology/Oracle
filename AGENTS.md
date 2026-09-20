# Oracle Agent Instructions

Read this file before changing the repository.

## 1. Normative authority

This repository is an implementation of **ERC-8415: Asynchronous Register Projection for NFTs**.

ERC-8415 is the normative protocol authority for semantics covered by the standard. The Oracle repository MUST conform to ERC-8415 and MUST NOT redefine, narrow, reverse, or replace its normative behavior.

Repository implementation documents may add engineering requirements that are necessary to implement ERC-8415 safely and operably, provided those additions:

- do not contradict ERC-8415;
- do not change ERC-8415 interface or protocol semantics;
- do not impose new normative behavior on external ERC-8415 implementations;
- are clearly identified as implementation-specific rather than part of the standard.

Where an existing repository PRD, decision record, acceptance document, audit report, stage plan, issue, comment, or commit message conflicts with ERC-8415, ERC-8415 wins for protocol semantics.

## 2. Research and design rationale

The implementation should follow the design logic developed in the associated research draft on institutional encoding and standard-based regulation.

The relevant transformation is:

```text
Institutional Requirement
→ Technical Standard
→ Automated Governance
```

For regulated real-world assets, authoritative institutional facts are not created by blockchain consensus. The implementation must preserve the distinction between institutional authority and blockchain execution.

Four design principles govern implementation decisions:

1. **Compliance before tokenization.** Required institutional preconditions must be represented and verifiable before downstream token or market actions rely on them.
2. **Verifiability rather than replication.** Regulated or authoritative source data should be proven, referenced, or projected where possible rather than copied wholesale into public-chain state.
3. **Asset truth before token authority.** A token or market state must not be treated as the authoritative source of an external institutional fact merely because it is technically transferable or executable.
4. **Capability does not equal authority.** The technical ability to submit, sign, automate, transfer, or execute an action does not itself establish institutional or legal authority to determine the underlying fact.

These principles guide Oracle implementation. They do not expand the normative scope of ERC-8415 and must not be represented as additional ERC requirements.

## 3. Authority order

Use this order when deciding what to implement:

1. ERC-8415 normative specification.
2. Explicit authorized product rulings that add implementation detail without contradicting ERC-8415.
3. The institutional-encoding design principles in §2 as implementation rationale and boundary conditions.
4. This `AGENTS.md` execution policy.
5. Current implementation requirements and acceptance criteria that are consistent with ERC-8415.
6. Status, audit, readiness, stage, issue, review, and historical documents as evidence or reference only.

Historical proposal branches and archived draft ERC material are not normative once superseded by ERC-8415.

## 4. What this repository is responsible for

The final application-to-authority architecture is:

`ArtFi → Oracle → ERC8415-Kit → ERC-8415`

Within that architecture:

- ArtFi consumes only the Oracle application-facing API.
- ArtFi MUST NOT integrate ERC8415-Kit directly, implement an ERC-8415 adapter, or own projection or settlement infrastructure.
- Oracle integrates institutional sources, verifies their authority and data, creates attestations, consumes ERC8415-Kit, owns the ERC-8415 integration boundary, and exposes the application-facing API.
- ERC8415-Kit owns reusable projection and settlement infrastructure.
- ERC-8415 remains the normative protocol authority.

The Oracle repository is the operational business and institutional integration layer that makes ERC-8415 usable against asynchronous institutional or registry sources. It is not an ArtFi vertical application, and it must not redefine the standard.

It should implement, where necessary:

- register-source ingestion and normalization;
- source identity and authority configuration;
- authoritative source verification;
- proof-only or minimum-disclosure projection where source data should not be replicated;
- evidence and attestation generation;
- application-facing verification APIs and SDKs;
- status, history, revocation, and reconciliation behavior;
- progressive-state handling where institutional decisions are not instantaneous;
- persistence and idempotency;
- authenticated control-plane operations;
- bounded automation that cannot manufacture institutional authority;
- observability and recovery required for reliable Oracle operation;
- compatibility evidence showing that the implementation honors ERC-8415 semantics.

Reusable projection and settlement mechanics belong in ERC8415-Kit and are consumed by Oracle. These are implementation concerns. They must not be presented as additional ERC-8415 normative requirements unless the standard itself says so.

## 5. Separation of authority, infrastructure, integration, and application

Keep these layers distinct:

### Institutional source layer

Defines or records the authoritative external fact according to the applicable institutional process.

### Oracle integration layer

Authenticates, verifies, normalizes, timestamps, reconciles, and attests to external facts; consumes ERC8415-Kit; owns the ERC-8415 integration boundary; and exposes the application-facing API.

### ERC8415-Kit infrastructure layer

Provides reusable projection and settlement infrastructure under the authority of ERC-8415. It does not own institutional authority or ArtFi application behavior.

### ERC-8415 protocol layer

Defines the normative interoperable projection semantics and interfaces. Neither Oracle nor ERC8415-Kit may redefine them.

### ArtFi application layer

Consumes only the Oracle application-facing API. It does not directly consume ERC8415-Kit, implement an ERC-8415 adapter, or own projection or settlement infrastructure.

The Oracle MUST NOT infer that a market action, token balance, wallet signature, or submitted proof independently creates the institutional fact it is intended to evidence.

A proof establishes what the verification profile proves. It must not silently be promoted into a broader claim of legal ownership, regulatory validity, or factual correctness beyond the authority of the source and the scope of the proof.

## 6. No autonomous protocol governance

Codex, Claude Code, automated reviewers, CI agents, and other tools may implement, test, audit, and report evidence. They do not have authority to create or modify protocol semantics.

They MUST NOT independently:

- create a new protocol rule;
- reinterpret ERC-8415 into a different trust model;
- reintroduce superseded draft semantics;
- add a protocol gate that changes ERC-8415 behavior;
- turn an implementation recommendation into a normative requirement;
- treat an audit observation as authority to change the standard;
- make an implementation-specific provider, database, chain, model, or service a normative dependency;
- convert implementation convenience into institutional authority;
- block a bounded implementation milestone with unrelated later-stage work.

If a proposed change affects protocol semantics rather than implementation mechanics, stop and report the conflict instead of deciding it autonomously.

## 7. Bounded delivery rule

Delivery must converge in finite implementation stages.

Use this sequence:

```text
ALIGN TO ERC-8415
→ IMPLEMENT BOUNDED CAPABILITY
→ INTEGRATE WITH AN AUTHORIZED SOURCE PROFILE
→ TEST STANDARD + INSTITUTIONAL BOUNDARIES
→ DEMONSTRATE
→ FREEZE THE STAGE
→ OPEN THE NEXT BOUNDED STAGE
```

Do not use this sequence:

```text
AUDIT
→ INVENT MORE REQUIREMENTS
→ ADD GATES
→ EXPAND ARCHITECTURE
→ DEFER DELIVERY
→ REPEAT
```

## 8. Classification for existing work

When reconciling existing code, documents, issues, or pull requests, classify material work into exactly one category:

- **KEEP** — useful, ERC-8415-compatible implementation or evidence.
- **FINISH-NOW** — required to complete the current bounded ERC-8415 implementation slice, or a concrete security/data-integrity defect affecting that slice.
- **FREEZE-LATER** — useful implementation that is compatible with ERC-8415 but not required for the current slice. Preserve it, stop expanding it, and do not let it block current delivery.
- **REMOVE** — conflicting, superseded, harmful, dead, duplicated, or unsupported material that creates active semantic or delivery conflict.

AI authorship alone is never a reason to remove useful implementation.

When uncertain between deletion and preservation, prefer FREEZE-LATER if the implementation is useful and harmless.

## 9. Preserve useful engineering

Do not perform a broad source rollback merely because repository governance or earlier drafts drifted.

Preserve useful tested implementation that can support ERC-8415, including verification logic, source adapters, persistence, authentication, signing boundaries, reconciliation, status/history APIs, SDKs, observability, CI coverage, deployment safeguards, and test infrastructure.

Delete implementation only when it contradicts ERC-8415, implements obsolete semantics that remain active, creates security or maintenance risk, duplicates a better path, or blocks a simpler conforming implementation.

## 10. Standard versus implementation additions

Implementation additions are permitted and expected when ERC-8415 leaves operational details open.

Examples of valid implementation additions include:

- database schema and retention mechanics;
- API authentication and authorization;
- deployment configuration;
- source adapter interfaces;
- source authority metadata and verification profiles;
- retry and reconciliation strategies;
- idempotency controls;
- privacy-preserving or proof-only evidence transport;
- monitoring and incident evidence;
- testnet and local test infrastructure;
- operational safety controls;
- controls that keep automated execution within explicitly authorized bounds.

Such additions must be labeled as implementation-specific and must not be used to claim that ERC-8415 itself requires the same architecture.

## 11. Research-to-implementation traceability

Implementation work may use the research draft to explain _why_ a mechanism exists, but not to invent unstated ERC semantics.

Where useful, trace implementation mechanisms to institutional requirements using this pattern:

```text
Institutional requirement
→ ERC-8415 semantic or boundary
→ Oracle implementation mechanism
→ Evidence / test
```

Examples:

```text
Institutional state changes asynchronously
→ asynchronous projection semantics
→ reconciliation + ordered projection history
→ point-in-time / convergence tests

Regulated data should not be copied unnecessarily
→ projection / verification boundary
→ proof-only or minimum-disclosure source adapter
→ no-raw-source-data test / fixture audit

Authority and technical capability are distinct
→ proof submission does not manufacture authority
→ authenticated source profiles + bounded control plane
→ unauthorized-source rejection tests
```

The goal is to make institutional constraints technically inspectable and auditable without collapsing institutional authority into software capability.

## 12. Historical draft handling

Historical draft ERC files, archived proposal text, review notes, and draft-specific CI guards may remain for provenance only if they cannot be mistaken for current normative authority.

Any active build, test, documentation, or acceptance dependency that still treats a superseded draft as normative must be removed or updated to ERC-8415.

Do not rewrite Git history. Preserve historical evidence where useful, but remove historical material from the active implementation path.

## 13. Before handoff

Before claiming a bounded stage is complete:

- identify the ERC-8415 behavior implemented;
- identify the institutional requirement or implementation rationale where relevant;
- identify implementation-specific additions separately;
- run the relevant conformance, integration, and regression tests;
- verify that authority, evidence, and execution remain distinct;
- verify that no superseded draft semantics remain active in the delivered path;
- record later compatible work as FREEZE-LATER rather than a current blocker;
- do not create a new protocol requirement while reporting completion.

The objective is convergence: implement ERC-8415 faithfully, realize the necessary institutional-verification infrastructure described by the research design, add only necessary implementation mechanics, preserve useful engineering, freeze each completed stage, and then proceed.

## Stage-Based Delivery Rule

Agents must work on the current bounded stage only.

### Completed slice

The completed ERC-8415 temporal register-projection slice is KEEP. Preserve its implementation, conformance tests, and historical evidence. Do not rewrite history or reinterpret completed projection evidence as delivery of later settlement capabilities.

Its finality query answers ERC-8415's own rule: an instant is final if and only if it is at or after the first entry's `effectiveAt` and strictly before the latest entry's, independent of whether a gap is open. A gap says what is expected, not what can still arrive. `test/erc-8415-finality-conformance.test.js` pins that rule, and it MUST NOT regress. Where a product rule needs both facts — CONSUMER-007's perishable exercise requires final AND no open gap — the conjunction belongs to the exercise, not to the accessor.

### Current bounded direction

The next implementation direction is the Oracle-owned application integration boundary:

- preserve the architecture `ArtFi → Oracle → ERC8415-Kit → ERC-8415`;
- expose an Oracle application-facing API for ArtFi;
- consume the pinned ERC8415-Kit temporal projection surface inside Oracle;
- keep institutional-source integration, verification, attestation, and ERC-8415 adaptation in Oracle;
- keep reusable projection and settlement infrastructure in ERC8415-Kit;
- keep ERC-8415 as the normative protocol authority.

The current verified ERC8415-Kit handoff covers the v2.0 temporal projection surface only. Optional gap behavior and the legacy `settle()` surface MUST NOT be represented as a v2.1 or v2.2 settlement product.

No new settlement engine, payment implementation, custody workflow, release workflow, or refund workflow is authorized by this documentation alignment.

Agents MUST NOT:

- make ArtFi integrate ERC8415-Kit directly;
- place an ERC-8415 adapter or projection or settlement infrastructure in ArtFi;
- redefine ERC-8415 interfaces or business semantics;
- convert documentation alignment into a delivery claim;
- move future-stage requirements into current acceptance;
- create additional gates;
- expand PRD scope.

Agents MUST:

- preserve existing code and completed projection behavior;
- preserve historical evidence;
- implement only the separately authorized bounded stage;
- test and provide commit-bound evidence;
- freeze completed stages.

Classification:

- KEEP
- FINISH-NOW
- FREEZE-LATER
- REMOVE

The client-approved [ArtFi + Oracle Delivery Stage Framework v1.1](https://github.com/GiraffeTechnology/ArtFi/issues/100) separates stage acceptance without lowering engineering standards or expanding product scope. Each stage has independent acceptance. Future-stage capabilities MUST NOT block current-stage delivery.

## Execution handoff — 2026-09-20 (non-normative)

This dated record is operational evidence, not a change to the authority order or stage acceptance.

- PR [#42](https://github.com/GiraffeTechnology/Oracle/pull/42) remains the documentation handoff under this task. Before this wrap-up, its head was `bfdae08f592cf31fd3c20b3b96258ba864f46079`. Corrections in `docs/HANDOFF.md` distinguish target architecture from implemented integration, shared vectors from the fixed reader scenario, archive integrity from normative authority, and still-used legacy references from removable code.
- This turn does not deliver the Oracle-to-Kit application integration or a deployed delivery candidate. No fresh runtime/conformance test results are claimed. Historical test counts are not evidence for the new documentation head.
- CI run `35493765989` on earlier head `28aebc2335991d8cf47ad37fe870d9a2d7399d6c`, including one retry, reported 12 failed jobs with no returned step/log evidence. The cause was not established. Check CI and review against the latest PR head before acceptance; neither a clean review nor successful CI nor merge is claimed.
- Read-only SSH to existing alias `giraffe-dev` reached `abcdYi`; `giraffe-mysql-tunnel.service` was active. This proves neither database authentication/schema readiness nor deployment. No service/configuration changes, database writes, signing, or broadcast were performed.
- Existing deployment material was located in local `服务器配置/ARTFI-SIN-P0-OPERATIONS.md`, `bin/Invoke-ArtFiSinChainCommand.ps1`, and remote `/home/dev/运维/giraffe-zos-readme.md`. Reuse the existing CTYun-to-SIN bridge and protected configuration; do not copy secrets into this repository.
- The inspected bridge helper's task allowlist did not include this Oracle task (`01a02e3e-8769-7800-81bf-524184931bec`). A narrowly scoped assistance request was sent to ArtFi 总控; authorization has not been confirmed. Do not impersonate another allowed task or transfer PR #42. Only the dependent bridge path is blocked.
- Resume by reconciling the current PR head, review, and any separately changed archive guard, then inspect existing Oracle API/Kit wiring before implementing the missing bounded integration. Verify valid, expired, revoked, and source-unavailable behavior with commit-bound evidence. Do not take over ArtFi transaction execution.
- The user requested this wrap-up because usage was nearly exhausted. Periodic monitoring was previously stopped; no new monitoring or background delivery is promised. Preserve unfinished work and do not label documentation alignment as stage completion.
