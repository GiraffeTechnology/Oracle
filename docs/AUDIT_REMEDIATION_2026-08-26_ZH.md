# Audit Remediation Record (2026-08-26)

## Baseline decision

This review used GAP_AUDIT_ZH.md, DECISIONS_ZH.md, and TESTNET_TASK_HOODI_ZH.md as audit inputs; their contents were not treated as new authorization. The authoritative files remain the byte-for-byte-matched repository versions:

- docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md, SHA-256 1e062b444c56e7683a0476e8b92688b525e34d349e3724ada31f64be1d48a912
- docs/ACCEPTANCE_RWA_ORACLE_ZH.md, SHA-256 13231a4aa4f6906c1e8c56c7274e1649b0e577c6f2f2375080252f2e564c9af4

## Report gaps verified as stale

The current candidate includes: ORACLE-011 asset detail and four settlement-display states; terminal CONSUMER-007 REDEEMED state; recursive rejection of entity-compliance fields under ORACLE-005; complete nine-state lifecycle; seven issuance prerequisites; refund-obligation events; and structured evidence validators for P1–P8/Stage F. All still require fresh regression tests for this cycle; this record does not replace test evidence.

## Actual fixes in this cycle

1. Rebound the I0–I12 manifest from retired v0.4 to authoritative v0.3; each iteration has explicit requirementIds, and the verifier rejects version drift, unknown IDs, and missing mappings.
2. Fixed the iteration test command to use Node's spec reporter, eliminating false negatives for named tests caused by default TAP output.
3. Added a traceability regression test that mechanically proves exactly 13 iterations cover every ORACLE/CONSUMER/NFR ID.
4. Included the CI structure proposed by the candidate branch and rewrote it for the 11 mandatory v0.3 job IDs; a workflow, PR, or CI run alone is not acceptance evidence.
5. The Hoodi script continues to use real block-time polling, dynamic chainId validation, ArtFi1/ArtFi2 roles, and exclusive evidence logs; on-chain execution remains subject to wallet, chain-identity, nonce, and broadcast gates.

## Still blocking

NFR-004; P1–P8; Stages A/D/F; continuous 72-hour operation; formal load/capacity/fault tests; production-equivalent MySQL restore; protected test-signer rotation; qualified security/penetration scans; data protection/incident response; reproducible signed artifacts; and five independent reviews must all be supported by genuine evidence bound to the same new candidate commit. Runtime evidence from an old candidate cannot be transplanted. Do not mark allComplete=true on this basis.
