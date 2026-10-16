# Production Readiness: Current Review

Review: 2026-10-17 HKT. **Not a production candidate.** Current source/CI identities are in STATUS.md; full requirements are in the revised PRD and EX_ALIGNMENT_ACCEPTANCE.md.

Main has substantial implementation, application projection APIs, and green CI at the reviewed exact commit. The older assessment below predates integration and must not be used to claim the current repository lacks source adapters, certificate history, CI jobs or a dedicated application boundary. Nor may its old post-T+0 transfer blocker override D-008.

Current production prerequisites remain NFR-004 candidate-bound availability/capacity/stability/recovery and protected-signer evidence, P1–P8 support, approved institutional profiles/original-document validation, live receipt-journal driver testing, exact authorized deployment/source bindings, independent legal/privacy/security/contract/operations reviews, commercial scope and written jurisdictional go/no-go. The separate blocked identity/security fix remains unverified. Receipt binding is draft PR48; ingress/receipt API is unpublished stage2, not commissioned main.

Retain completed synthetic temporal capabilities without treating future production work as a global blocker. For a receipt-bound production release, all applicable OX/OT assertions require their own exact-candidate evidence. No historical 23/24 count clears them. No deployment, publication or security permission is granted here.

## Historical assessment retained for provenance only

Everything below is the original 2026-08/09 assessment. Its contemporaneous counts, branch/CI deficiencies and technical integration assumptions are superseded by the current review above; valid legal/operational gates remain in effect through the current PRD.

# Production Readiness Assessment

| Item | Content |
| --- | --- |
| Basis | Delivery definition in ACCEPTANCE_RWA_ORACLE_ZH.md §7 and release blockers in PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md §14 |
| Reviewed object | Commit containing this file (candidate branch, now merged into main) |
| Date | 2026-08-25 |
| **Conclusion** | **Not a production candidate. Production release must be blocked.** |

> Under acceptance standard §2, “complete,” “delivered,” “passed,” and “production-ready” are reserved terms, usable only when all applicable acceptance items are VERIFIED on the same commit. This assessment does not meet that condition and does not use those terms as a completion claim.

> **Update (2026-08-28):** This assessment predates branch integration; the reviewed commit then contained almost no implementation. After integration (issue #5), the bases for §2 items 1 and 3 and §3 items 1 and 4 changed: implementation and tests now share one commit, and local verify-prd-v0.4 reported 23/24 engineering-side items verified. **However, under acceptance standard §3, none of these items may be marked cleared until CI is restored (issue #4) and produces a green run on this commit.** Items 4, 12, 13, and 15 (premise evidence, independent audits, mainnet approval, and contract signing) are unaffected by integration and remain outstanding.

## 1. Conclusion

PRD §14 lists 15 release blockers, of which **at least six currently apply**; any one requires blocking production release. **None** of the eight delivery conditions in acceptance standard §7 is satisfied.

The repository is currently at **G-A in progress**, with four stage gates, G-B through G-E, remaining before the G-F production candidate.

## 2. PRD §14 release blockers, item by item

| # | Blocker | Assessment | Basis |
| --- | --- | --- | --- |
| 1 | Cannot prove one asset, one certificate, one NFT | Applies | This commit had no token-binding implementation; CONSUMER-001 was NOT-IMPLEMENTED |
| 2 | Cultural-relic-chain, certificate, or warehouse-receipt hash mismatch | Cannot assess | No ingestion path or data; insufficient basis |
| 3 | Zhongchuang Wenmao or warehouse-provider status cannot be verified | Applies | No source adapter integration; ORACLE-001 only had an identifier registry |
| 4 | Any P1–P4 regulatory premise lacks evidence | Applies | PREMISE-P1–P8 all lacked written basis and collection dates |
| 5 | Valid transfer-allowing proof is issued after T+0 | Cannot assess | No proof issuance capability (ORACLE-003 unimplemented) |
| 6 | Buyer completion proof issued before authoritative registry completion | Cannot assess | Same as above |
| 7 | Prior certificate not revoked or certificate history overwritten | Cannot assess | No certificate version store |
| 8 | Oracle can determine ownership itself or bypass authoritative sources | Does not apply | No such path; but this is not positive evidence because implementation was also absent |
| 9 | API/UI/contract contains valuation, returns, collateral ratio, or investment advice | Does not apply | CI gate check-no-financial-output.mjs passed bidirectional checks |
| 10 | Giraffe handles financial signing, funds, credit, or transaction-volume fees | Does not apply in code | All write methods return 405; contract clauses were not checked |
| 11 | Personal data, original certificates, or identity mappings enter a public chain | Does not apply | CI gate check-repository-hygiene.mjs; no public-chain writes existed at the time |
| 12 | Missing independent legal, security, privacy, or adapter audit | Applies | None of the four independent audits had occurred |
| 13 | Missing separate written approval for mainnet, real assets, or real funds | Applies | Not obtained; status PENDING-GATE |
| 14 | ArtFi decision in §0.1 not made before interface integration | Does not apply in code; token semantics unconfirmed | Separate repositories; no ArtFi coupling in src/ and CI guard exists; fractionalization semantics awaited product confirmation. See §7 and D-006 |
| 15 | §0.2 scope and schedule contract unsigned | Applies | Unsigned |

**Six apply** (1, 3, 4, 12, 13, 15); **one partially does not apply** (14: no code coupling, token semantics awaiting confirmation; see §7); **four cannot be assessed**; four do not apply.

Note the difference between item 8 and items 2, 5, 6, and 7: “does not apply” or “cannot assess” is due to **capability not yet implemented**, not proven safety. Reassess after implementation; do not carry these conclusions forward.

## 3. Acceptance-standard §7 delivery conditions, item by item

| # | Condition | Satisfied | Explanation |
| --- | --- | --- | --- |
| 1 | Every in-scope §4 requirement is VERIFIED | No | Only 3 of 24 were VERIFIED (see STATUS.md) |
| 2 | G-A through G-F exit conditions all met on one commit | No | G-A in progress |
| 3 | CI fully green on that commit; PR approved and merged | Partial | CI green, but PR #2 unmerged and three required §6 job types missing |
| 4 | Tests, deployment, and documents point to the same commit | No | Implementation on feature/oracle-all-iterations; documents and CI on this branch |
| 5 | Independent audit reports and remediation/retest evidence archived | No | Not performed |
| 6 | All PRD §14 blockers resolved | No | Six apply |
| 7 | Release checklist, contract addresses, signer set, rollback, and incident-response plan | No | None available |
| 8 | Operations manual and procedures handed over | No | None available |

## 4. Relationship to testnets

DECISIONS_ZH.md D-002 selects Hoodi as the preferred testnet. **Hoodi is a test chain, not a production chain.** Passing tests there does not clear blocker 13 in §2 or change any finding in §3. Under acceptance standard §2.1, written go/no-go for mainnet and real assets is a legal gate; technical results cannot clear it.

## 5. Work required to reach production-candidate status

In dependency order, not by effort:

1. **Integrate branches** (category A in GAP_AUDIT_ZH.md §6)—before this, no auditable commit exists.
2. Complete category-B functional gaps: ORACLE-011 asset-detail UI, CONSUMER-007 REDEEMED semantics, and ORACLE-005 eligibility proof.
3. Complete category-C named tests so ORACLE-001–010 and NFR-001–003 become VERIFIED (G-B, G-C).
4. Add the three CI job types missing from acceptance §6: contract tests, synthetic-consumer integration tests, and database-migration cycle.
5. Execute NFR-004 load tests and five drills (G-D).
6. Collect PREMISE-P1–P8 evidence.
7. Complete independent legal, privacy, security, and operations audits plus remediation/retest.
8. Decide PRD §0.1 ArtFi scope and sign §0.2 contract.
9. Obtain written go/no-go for mainnet, real assets, real funds, and every jurisdiction (legal gate; last and not resolvable by engineering).

Item 1 is a prerequisite for all the others.

## 6. Limits of this assessment

This assesses only this commit and publicly visible branch state. No security audit, penetration test, load test, or contract-clause review was performed. External organizations must complete the contract-side portion of item 10 and all four independent audits in item 12.

## 7. Retrospective note: clarification of the ArtFi relationship (2026-09-01)

This section records two same-day revisions. The first assessment overreached; the second corrects it after clarification from the product owner. Both are retained so readers can understand how the conclusion changed.

### 7.1 Initial assessment (narrowed by §7.2)

The original item 14 assessment said “does not apply” on the basis that “no decision was made, but no integration occurred.” After the product owner explained that public-chain trading is handled by the ArtFi module, this document temporarily upgraded the assessment to “requires review,” because integration had become a design premise while the §0.1 decision remained open.

### 7.2 Clarified assessment

The product owner further explained: **ArtFi is the public-chain trading agent for the cultural-relic-chain registration product; Oracle and ArtFi are separate GitHub repositories and are developed as separate subprojects.** This makes the §7.1 assessment too broad in two ways:

1. **There is no dedicated integration surface to block.** Under ORACLE-010, Oracle provides downstream only a read-only verifier library (src/sdk/verifier.js) and proof format; it writes no specialized interface for any particular consumer. ArtFi, like any other consumer, consumes facts by verifying proofs. There is no dedicated interface contract with Oracle. Therefore, the PRD §0.1 “block any ArtFi interface integration” constraint has a small practical surface in this architecture: no dedicated integration surface exists to block.
2. **Separate repository structure provides the code-side boundary required by PRD §0.1.** The requirement not to reference, depend on, or reuse ArtFi contracts or database is structurally enforced by repository boundaries and mechanically checked by scripts/check-decision-consistency.mjs: any ArtFi coupling or public-chain write call in the 62 files under src/ causes a build failure (validated in both directions).

Therefore, item 14 does not apply on the **code side**.

### 7.3 Remaining unresolved portion

Repository boundaries do not resolve the mutually exclusive **token semantics**. If NFTs in this product line enter an ArtFi vault and ERC-20 fractions are issued, downstream behavior violates CONSUMER-001 “one asset, one certificate, one NFT,” which Oracle cannot prevent through its proof. The same applies to matching: CONSUMER-008 constrains Oracle not to build an order book, not downstream consumers.

What remained to be confirmed was ArtFi's behavior for **this product line** (criteria in D-006: broadcast user-signed transactions only / sign-and-submit on behalf of users / matching, pricing, and settlement). ORACLE-009 constrains Giraffe itself, and the PRD identifies the product entity as Giraffe ArtFi Corp. in line 11—the same entity as ArtFi—so the third-party liability path in premise P8 does not apply.

**This section is not a compliance conclusion**; it records only criteria and current evidence state.
