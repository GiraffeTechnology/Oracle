# Project Decision Log

This file preserves decisions and their rationale. ERC-8415 and latest explicit authorized compatible product rulings take precedence, as AGENTS.md requires. Historical entries do not override the current normative protocol or a specifically superseding ruling. D-009 below records the current reconciliation; older entries remain for provenance.

## D-009 Full-product revision and receipt-integration reconciliation (2026-10-17 HKT)

The full PRD revision retains v0.4 and all 24 baseline IDs, adds separately tracked OX-001–012/OT-001–003, and preserves Stages A–F. The legacy 24-ID verifier does not certify the new overlay or every corrected semantic clause.

This records already authorized product direction, not autonomous protocol governance:

- Current architecture is Application → Oracle → ERC8415-Kit → ERC-8415. The current main application projection API exists. D-006's statements that Oracle has no application interface and may never write registration facts are superseded for the authorized receipt integration. Its financial separation, independent repositories and no custody of user keys remain intact. Existing main's no-broadcast code guard is a historical baseline check, not authority to reject the separately authorized source writer or to claim it is already shipped.
- ArtFi whole-artwork and EX whole-receipt alignment are settled technical boundaries. Commercial/legal evidence stays open; historical fractionalization/charity semantics are not imported. D-004's old technical decision prerequisite is superseded accordingly.
- D-008's transfer freedom remains. Temporal finality is gap-independent; cancellation does not change it. The separately approved 2026-10-16 20:06 UTC clarification distinguishes a future timestamp from the uint64 maximum and requires genuine source time, strict increase and the actual approved profile. It is not an EX v1.2 quotation or a claim that an unpublished ERC wording correction is already canonical.
- D-002's historical Oracle Hoodi evidence remains valid for its own runs. EX joint demonstration uses its specified Sepolia 11155111 configuration and approved test asset; this is a separate integration scenario, not silent replacement of the standalone Oracle test plan.
- PR48 and unpublished stage2 remain distinct from main. No publication, security change, deployment or real-funds action is authorized by documentation revision.

The original D-001 version wording and historical D-006 marker are retained for compatibility with existing baseline checks; those checks do not validate all new OX/OT semantics. Do not weaken a guard to manufacture a pass.

## D-001 Authoritative PRD is v0.4

| Item | Content |
| --- | --- |
| Decision | docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md v0.4 is the sole authoritative requirements document |
| Date | 2026-08-25 (v0.3); anchored to v0.4 on 2026-09-03 |
| Companions | ACCEPTANCE_RWA_ORACLE_ZH.md (acceptance), STATUS.md (single-commit snapshot), GAP_AUDIT_ZH.md (repository-wide gaps) |

Supersedes: v0.2 PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md (deleted).

**Version history:** v0.3 was promoted to v0.4 on 2026-09-03. The only substantive change is D-008 (do not block ERC-721 transfers while registry processing is pending). The requirement-ID set, numbering, and scope remain unchanged: 24 ORACLE/CONSUMER/NFR requirements.

> **The version number “v0.4” appeared twice in this project for two different documents.**
>
> | | File | ID system | Status |
> | --- | --- | --- | --- |
> | Former v0.4 | PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md | I0–I12 iterations | Deleted (D-005) |
> | Current v0.4 | PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md | 24 ORACLE/CONSUMER/NFR IDs | Authoritative |
>
> The former v0.4 existed on feature/oracle-all-iterations. This decision initially selected v0.3 as the baseline and required mapping its I0–I12 iterations into this system, not changing this system to match. That mapping was completed during integration (see TRACEABILITY_ZH.md), and the old file was deleted. **Always include the filename when citing “v0.4”**; the version alone is ambiguous. The version number was retained instead of advancing to v0.5 because the work item and its verifier (verify-prd-v0.4) were already anchored to that number.

## D-002 Preferred testnet is Hoodi

| Item | Content |
| --- | --- |
| Decision | **Hoodi is the preferred public-chain testnet**; Sepolia is optional for reruns |
| Chain ID | **560048** (source: eth-clients/hoodi metadata/config.yaml, DEPOSIT_CHAIN_ID: 560048) |
| Date | 2026-08-25 |

**Recorded trade-off:** ethereum.org recommends Sepolia by default for application and contract development and describes Hoodi as intended for validator, staking, and protocol-upgrade testing. Technically, both can run this project's contract tests. This decision follows the explicit request to prefer Hoodi. This trade-off is not a blocker; it is recorded for context.

**Hoodi is a test chain, not a production chain.** This decision selects where tests run; it makes no production decision:

- This project currently has **no production chain**. Hoodi is not a substitute, mirror, or pre-production environment for mainnet.
- **Do not** write real assets, funds, original certificates, real registry references, or personal information to Hoodi. Use synthetic fixtures only (acceptance standard §3: synthetic data is correct for this stage).
- Passing Hoodi tests does **not** clear the written go/no-go for mainnet, real assets, real funds, or each jurisdiction. Under acceptance standard §2.1 this is a **legal gate**, status PENDING-GATE; green technical tests cannot clear it.
- Hoodi deployment addresses and transaction hashes are test evidence and must not be represented externally as product launch, availability, or approval.

Implementation requirements are in TESTNET_TASK_HOODI_ZH.md. **Always read and assert the chain ID from the live RPC; never hard-code it.** The test suite follows this rule (the EIP-712 domain changes with chainId; a hard-coded value produces an incorrect domain separator).

## D-005 Branch integration and selection of the v0.3 revision

| Item | Content |
| --- | --- |
| Decision | Implementation from feature/oracle-all-iterations was merged into the candidate branch and then into main via PR #2, creating the first commit that contains requirements, acceptance, implementation, tests, and CI together |
| Date | 2026-08-28 |
| Related | Issue #5 |

**There were two v0.3 revisions.** Each of two branches held a PRD marked v0.3:

| | Bytes | Difference |
| --- | --- | --- |
| Existing branch copy | 28,019 | No §3.3 |
| feature branch copy | 30,922 | Added §3.3 entity-compliance boundary; renamed ORACLE-005 to “isolation of entity-compliance conclusions”; renamed §12 |

Their requirement-ID sets were identical (24 IDs). **Select the feature-branch revision**: it was later and the implementation was written against it. Thus D-001’s “v0.3 is authoritative” specifically means this revision.

Other integration decisions:

- Delete PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md (v0.4), per D-001.
- Remove this branch's minimal service skeleton (src/config.ts, src/server.ts, src/oracle-status.ts, src/index.ts and tests): src/app.js and test/app.test.js cover its guarantees more completely; retaining both would leave two Oracle services in one repository.
- Set engines to >=22.18.0: the other branch's 217 tests passed on Node 22.22.2; .nvmrc remains pinned to 24.19.0 for CI.

## D-006 Oracle and ArtFi: two independent repositories, boundary is a read-only verification SDK

| Item | Content |
| --- | --- |
| Decision | **ArtFi is the agent for public-chain trading of the cultural-relic-chain registration product**; Oracle and ArtFi are separate GitHub repositories developed as separate subprojects |
| Repositories | GiraffeTechnology/Oracle (this repository, L2 verification layer); GiraffeTechnology/ArtFi (public-chain trading agent) |
| Date | 2026-09-01 |
| Supersedes | This does not supersede the ArtFi entry in D-004; it narrows that entry as described below |

**Oracle does not send transactions to any public chain.** ArtFi owns on-chain activity. This matches the layer division in PRD §5: L2 performs queries, verification, signed proofs, state synchronization, revocation, and audit. The src/ directory must contain no transaction broadcast, transaction-signing submission, or on-chain write path.

**There is no “Oracle → ArtFi integration code.”** Under ORACLE-010, Oracle provides downstream consumers only a **read-only verification library** (src/sdk/verifier.js) and proof format. ArtFi, like every other consumer, consumes facts by verifying proofs; Oracle writes no consumer-specific interface. Thus the practical constraint of PRD §0.1, “block any interface integration with ArtFi,” has a small surface in this architecture: there is no dedicated integration surface to block.

**Separate repository structure satisfies part of PRD §0.1 structurally:** the requirements not to reference, depend on, or reuse ArtFi contracts, databases, token semantics, or verification dataset are enforced for contract/database/code reuse by repository boundaries and mechanically checked by scripts/check-decision-consistency.mjs (any ArtFi coupling in src/ fails the build).

**Product semantics are decided; cross-repository implementation remains unverified.** Oracle records the following external-consumer boundary mechanically only; it adds no runtime code, chain writes, signing, broadcasting, matching, pricing, or custody capability for ArtFi:

| Tier | ArtFi behavior | Relationship to this PRD |
| --- | --- | --- |
| a | Current delivery: non-custodial trading agent; only user wallets or Safe owners sign | Allowed; ArtFi does not hold/custody private keys or sign on behalf of users |
| b | Sign on behalf of users, hold keys, or custody keys | **Prohibited** |
| c | Exchange: matching, pricing, settlement | Later iteration; NOT_IMPLEMENTED and NOT_AUTHORIZED |

Charity is a delivery subflow of the current Market Agent and must follow the same non-custodial, user-wallet/Safe-owner-only signing, and state-consistency boundaries. It is neither the overall ArtFi delivery objective nor authorization to expand into Exchange. The ArtFi consumption/indexing layer may read public-market NFT listings, settlement status, and transaction history in real time, but these observations are not Oracle authoritative state; identify their source/provider and keep them separate from Oracle evidence. config/external-consumer-state-contract.v1.json records only the contract and cross-repository status NOT_VERIFIED_EXTERNAL; it does not claim those boundaries are implemented or verified in the ArtFi repository.

## D-007 Authoritative location and citation rules for the ERC proposal

| Item | Content |
| --- | --- |
| Decision | **The authoritative ERC proposal is outside this repository**: number **ERC-8415** has been assigned; upstream submission is ethereum/ERCs#2006. The in-repository draft branch is only an archival copy |
| Current PR | **#18** (sequence #3 → #13 → #16 → #18; **PR #18 says the PR number will not rotate again** and may be cited, but the branch remains the authoritative identifier) |
| Current proposal | _Asynchronous Register Projection for NFTs_ (erc/ERCS/erc-xxxx.md) |
| Date | 2026-09-02 |

**PR numbers may change repeatedly; this does not mean the proposal was abandoned.** PR #3 closed unmerged at 2026-09-02T00:04:00Z and #13 was created 24 seconds later; #13 later closed at 05:32:17Z and #16 was created 33 seconds later. All three pointed to the same branch; each closure/new PR kept the same head and only refreshed the description. A closed PR therefore does not imply work stopped: use the branch head. The old proposal archived under docs/erc/, _Versioned RWA Certificate Settlement_, is no longer the specification source and is retained only as a historical record.

**That branch must not be merged into main.** Its destination is ethereum/ERCs. Merging would bring a draft standard and internal review records into Oracle's product history and defeat the purpose of a non-drifting reference copy.

**Citation rule:** the branch changes continuously. Any repository document or script that cites ERC content **must state the referenced commit**. A citation without a commit is invalid and cannot be used as an implementation basis. The state known at this decision was anchored at dce2163 (reviewed 2026-09-04; prior sequence: 386d6d4 → c22792a → a5270ad → bdea8e0 → 172fe3f → 23c0b71 → dce2163). The specification did not change from 23c0b71 to dce2163; it was re-anchored because the product owner designated PR #18 as the final view, so the anchor follows its head rather than advancing only when specification text changes.

**The IProjectionSettlement interface ID changed at 23c0b71 from 0xfd0f6337 to 0xf4a7d71b** (proofData was removed from cancelSettlement and isSettlementAuthority was added, changing the XOR of selectors). This was the first actual semantic change caught by this anchoring mechanism, not a mere commit movement.

**Re-anchoring is triggered by a change to the normative file erc/ERCS/erc-xxxx.md, not by every branch commit.** The branch also carries internal review ledgers (erc/review/) and a file index, both of which change often and cannot affect any Oracle dependency. For example, a5270ad → bdea8e0 changed only the ledger and index, not a word of the specification. The anchor records “the commit at which the four properties were last verified,” not an assertion about branch head; these can differ normally.

The four checked properties: both interface IDs exist; GapStatus has the five recorded values; RegisterEntry has seven fields; and the specification still says ordinary ERC-721 transfers MUST NOT be blocked.

**Known substantive disagreement—resolved by D-008 on 2026-09-03 (PRD follows ERC; raised to v0.4).** The following is retained as a record. This was a direct normative conflict, not a design preference:

| | Requirement | Source |
| --- | --- | --- |
| Current ERC | “Ordinary ERC-721 transfers MUST NOT be blocked while a projection gap is open.” | Normative section of erc/ERCS/erc-xxxx.md (a5270ad line 157; same wording in 386d6d4 and c22792a) |
| PRD v0.3 | “Block” NFT transfer and redemption; place it in protocol escrow or “non-transferable” state; premise P7 requires T+0 freeze and trading resume only after completion | §6 line 293, §7 line 427, §1 premise P7 |

That is, the ERC forbids exactly what the PRD required. src/domain/settlement-coordinator.js and src/domain/consumer-state-machine.js implemented the PRD. The superseded proposal used a freeze model (“ordinary ERC-721 transfers MUST NOT execute”), so this revision deliberately reverses that position.

**Correction:** the initial entry said the current proposal “opposes the freeze model in its Motivation,” and called it a position difference. That understated it: opposition was not only argumentative text in Motivation; the normative section itself says MUST NOT, and already did so at 386d6d4, not as a later tightening.

> **The “awaiting decision” status in this paragraph is closed.** The result is D-008: the PRD was updated to remove transfer freeze. The cited §6 line 293 was erroneous—line 293 was ORACLE-004 emergency freeze and unrelated to settlement freeze; the actual conflict was CONSUMER-004.

## D-008 Do not block transfers while registry processing is pending; classify rights as deferrable or perishable

| Item | Content |
| --- | --- |
| Decision | **Ordinary ERC-721 transfers are not blocked while registry processing is pending.** Rights are no longer determined by “who currently holds the token”; they are determined using the ERC projection: the confirmed holder at a particular moment, whether that moment is final, and whether it is disputed |
| Direction | **PRD follows ERC.** Under D-007, the ERC is not changed or merged during its PR; the conflict can only be resolved on the PRD side |
| Date | 2026-09-03 |
| Consequence | PRD raised to v0.4; D-001 anchor updated accordingly |

**Original conflicting text** (a direct normative conflict, not a wording difference):

| | Requirement | Source |
| --- | --- | --- |
| ERC | Ordinary ERC-721 transfers MUST NOT be blocked while a projection gap is open. | Normative section of erc/ERCS/erc-xxxx.md (anchor commit in D-007) |
| PRD v0.3 | Put NFT in protocol escrow or a non-transferable state; block transfer, redemption, pledge, and duplicate listing | CONSUMER-004 items 2 and 4 |

The ERC rationale is explicit: **a freeze does not resolve a gap; it only makes the gap expensive.** Blocking transfer cannot answer “who was the confirmed holder at some moment between T+0 and T+3”; it only transfers the uncertainty cost to the holder and destroys rights whose recorded moment falls within the freeze window.

### Rights classification (core mechanism of this decision)

| Category | Rule | Examples |
| --- | --- | --- |
| **Deferrable right** | May be initiated while a gap is open; settlement is deferred until the moment is final and then applied to the confirmed holder at that moment. It is neither blocked nor lost. | Distributions, notices, dividends |
| **Perishable right** | Requires that the moment is final and has no open gap. Otherwise reject that particular exercise. | Redemption, burn, voting, and any irreversible one-time exercise |

What is rejected is **that exercise**, not the token's **transferability**. This is the entire distinction from a freeze model. The effect is equivalent for irreversible actions (none occurs while ownership is unsettled), while markets remain unblocked and the former tension with CONSUMER-008 external-market compatibility is removed.

### Distinguish four meanings of “freeze”; this decision changes only the second

| # | Concept | Affected by this decision? |
| --- | --- | --- |
| 1 | **Snapshot freeze:** fix the T+0 snapshot hash; data no longer changes | No; retained. This is legitimate data fixation |
| 2 | **Transfer freeze:** prohibit ERC-721 transfers while registry processing is pending | **Yes; deleted** |
| 3 | **Emergency freeze:** ORACLE-004; revoke proof and block operations after registry withdrawal, certificate invalidation, judicial freeze, or source dispute | No; out of scope |
| 4 | **External restricted status:** encumbranceStatus, a freeze/seizure/pledge code reported by the cultural-relic chain | No; this is a source fact, not an action by this product |

Item 4 was newly discovered during execution: encumbranceStatus in §4.1 of WENBAO_INTERFACE_SPEC_ZH.md carries a restricted status reported by the cultural-relic chain. It differs from the first three and must also be distinguished in terminology reviews.

### Treatment of premise P7

Original P7 combined two different things into one external premise:

1. Registry completes owner change, prior-certificate revocation, and new-certificate issuance by T+3 at the latest: an **external fact**, still requiring an SLA and business calendar as evidence in the premise register.
2. “NFT becomes tradable only after completion”: a **design choice of this product**, exactly what this decision changes; remove it from the premise register and govern it by this decision.

Without splitting them the PRD would contradict itself: the premise says trading resumes only after completion, while CONSUMER-004 says transfer is never blocked. **P7 was not listed in the work item; this was added during execution.**

### No external mandatory basis found

Before execution, a repository-wide search under work-item §0 (PRD, WENBAO_INTERFACE_SPEC_ZH.md, PREMISE_EVIDENCE_REGISTER_ZH.md and its read-only review, and candidate public sources) found no document stating that “transfer is prohibited during settlement” is an external requirement of the cultural-relic chain, a regulator, or a compliance authority. The premise-register gap for P7 was “awaiting signed SLA/business calendar,” a service-level and calendar definition, not a regulatory decision.

**If contrary evidence is obtained later, revisit this decision before ERC submission**—in that case the ERC, not the PRD, would need to change.

## D-003 Conflict-resolution rule

When statements conflict, apply this order:

1. ERC-8415 normative semantics.
2. Latest explicit authorized compatible product ruling, with supersession recorded.
3. AGENTS.md execution policy and current implementation requirements/acceptance.
4. Historical decisions and other evidence, subject to D-009 and explicit supersession.

## D-004 Matters not resolved by this decision process

These are not document conflicts and cannot be closed by the conflict-resolution rule; handle them separately:

| Matter | Nature | Source |
| --- | --- | --- |
| ArtFi cross-repository implementation and evidence | External engineering and acceptance; product semantics fixed by D-006 | PRD §0.1, D-006 |
| Scope and schedule contract | Commercial | PRD §0.2 |
| PREMISE-P1–P8 evidence | Evidence collection | PRD §1, acceptance §4.4 |
| Legal go/no-go for mainnet/real assets/real funds | Legal gate, status PENDING-GATE | Acceptance §2.1 |
| Merge the two branches | Engineering work | GAP_AUDIT_ZH.md §6, category A |
