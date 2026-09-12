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

## 2. Authority order

Use this order when deciding what to implement:

1. ERC-8415 normative specification.
2. Explicit authorized product rulings that add implementation detail without contradicting ERC-8415.
3. This `AGENTS.md` execution policy.
4. Current implementation requirements and acceptance criteria that are consistent with ERC-8415.
5. Status, audit, readiness, stage, issue, review, and historical documents as evidence or reference only.

Historical proposal branches and archived draft ERC material are not normative once superseded by ERC-8415.

## 3. What this repository is responsible for

The repository should implement the Oracle-side capabilities required to make ERC-8415 usable in a real system, including where necessary:

- register-source ingestion and normalization;
- authoritative source verification;
- projection state construction;
- evidence and attestation generation;
- verification APIs and SDKs;
- status, history, revocation, and reconciliation behavior;
- persistence and idempotency;
- authenticated control-plane operations;
- observability and recovery required for reliable Oracle operation;
- compatibility evidence showing that the implementation honors ERC-8415 semantics.

These are implementation concerns. They must not be presented as additional ERC-8415 normative requirements unless the standard itself says so.

## 4. No autonomous protocol governance

Codex, Claude Code, automated reviewers, CI agents, and other tools may implement, test, audit, and report evidence. They do not have authority to create or modify protocol semantics.

They MUST NOT independently:

- create a new protocol rule;
- reinterpret ERC-8415 into a different trust model;
- reintroduce superseded draft semantics;
- add a protocol gate that changes ERC-8415 behavior;
- turn an implementation recommendation into a normative requirement;
- treat an audit observation as authority to change the standard;
- make an implementation-specific provider, database, chain, model, or service a normative dependency;
- block a bounded implementation milestone with unrelated later-stage work.

If a proposed change affects protocol semantics rather than implementation mechanics, stop and report the conflict instead of deciding it autonomously.

## 5. Bounded delivery rule

Delivery must converge in finite implementation stages.

Use this sequence:

```text
ALIGN TO ERC-8415
→ IMPLEMENT BOUNDED CAPABILITY
→ INTEGRATE
→ TEST AGAINST STANDARD SEMANTICS
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

## 6. Classification for existing work

When reconciling existing code, documents, issues, or pull requests, classify material work into exactly one category:

- **KEEP** — useful, ERC-8415-compatible implementation or evidence.
- **FINISH-NOW** — required to complete the current bounded ERC-8415 implementation slice, or a concrete security/data-integrity defect affecting that slice.
- **FREEZE-LATER** — useful implementation that is compatible with ERC-8415 but not required for the current slice. Preserve it, stop expanding it, and do not let it block current delivery.
- **REMOVE** — conflicting, superseded, harmful, dead, duplicated, or unsupported material that creates active semantic or delivery conflict.

AI authorship alone is never a reason to remove useful implementation.

When uncertain between deletion and preservation, prefer FREEZE-LATER if the implementation is useful and harmless.

## 7. Preserve useful engineering

Do not perform a broad source rollback merely because repository governance or earlier drafts drifted.

Preserve useful tested implementation that can support ERC-8415, including verification logic, source adapters, persistence, authentication, signing boundaries, reconciliation, status/history APIs, SDKs, observability, CI coverage, deployment safeguards, and test infrastructure.

Delete implementation only when it contradicts ERC-8415, implements obsolete semantics that remain active, creates security or maintenance risk, duplicates a better path, or blocks a simpler conforming implementation.

## 8. Standard versus implementation additions

Implementation additions are permitted and expected when ERC-8415 leaves operational details open.

Examples of valid implementation additions include:

- database schema and retention mechanics;
- API authentication and authorization;
- deployment configuration;
- source adapter interfaces;
- retry and reconciliation strategies;
- idempotency controls;
- monitoring and incident evidence;
- testnet and local test infrastructure;
- operational safety controls.

Such additions must be labeled as implementation-specific and must not be used to claim that ERC-8415 itself requires the same architecture.

## 9. Historical draft handling

Historical draft ERC files, archived proposal text, review notes, and draft-specific CI guards may remain for provenance only if they cannot be mistaken for current normative authority.

Any active build, test, documentation, or acceptance dependency that still treats a superseded draft as normative must be removed or updated to ERC-8415.

Do not rewrite Git history. Preserve historical evidence where useful, but remove historical material from the active implementation path.

## 10. Before handoff

Before claiming a bounded stage is complete:

- identify the ERC-8415 behavior implemented;
- identify any implementation-specific additions separately;
- run the relevant conformance, integration, and regression tests;
- verify that no superseded draft semantics remain active in the delivered path;
- record later compatible work as FREEZE-LATER rather than a current blocker;
- do not create a new protocol requirement while reporting completion.

The objective is convergence: implement ERC-8415 faithfully, add only necessary implementation mechanics, preserve useful engineering, freeze each completed stage, and then proceed.