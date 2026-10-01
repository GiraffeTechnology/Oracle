# I12 Synthetic Signer Rotation Drill

## Boundary

This drill validates software behavior for Oracle I12 rotation controls. It is not evidence of a production HSM, protected signing service, or formal rotation ceremony. Output must remain acceptanceEligible=false; do not copy it to evidence/acceptance/i12-signer-rotation.json or use it to mark I12 complete.

The drill uses only in-process, ephemeral synthetic Ed25519 keys. Do not use ArtFi1/ArtFi2, production wallets, real private keys, seed phrases, or key paths. RPC, network access, broadcast, business transactions, and nonce operations are prohibited.

## Acceptance steps

1. Generate one-time old/new Ed25519 KeyObjects in process memory; do not export private keys.
2. Verify that the old signer can issue and verify a synthetic attestation before rotation.
3. Write three public-hash events to AuditJournal, in order: requested, new-activated, prior-retired.
4. Verify that the new signer can issue and verify after rotation.
5. Verify that an old signature under the new signer set returns SIGNATURE_INVALID.
6. Verify that validation and new issuance by the retired old signer both return SIGNER_SET_NOT_ACTIVE.
7. Verify audit-hash-chain integrity and confirm that modifying a middle event causes chain verification to fail.
8. The public report may contain only signer-set identifiers, public-key fingerprints, event hashes, and Boolean results. Scan to prohibit private keys, seed phrases, seed values, and raw-transaction fields.

## Execution

Output only to stdout:

    node scripts/run-i12-synthetic-signer-rotation.mjs

Write once to the fixed local result file (exclusive-create; refuse to overwrite an existing file):

    node scripts/run-i12-synthetic-signer-rotation.mjs --write-fixed-output

The fixed result is output/i12-synthetic-signer-rotation.json. A reviewer should separately compute SHA-256 for the script and result file and confirm:

- newSignerAccepted=true;
- oldSignerRejected=true;
- rotationAudited=true;
- auditChainVerified=true;
- tamperedAuditChainRejected=true;
- privateMaterialObserved=false;
- networkUsed=false, rpcUsed=false, transactionSigned=false, nonceConsumed=false;
- acceptanceEligible=false.

Formal I12 still requires an independent rotation ceremony in a protected, production-equivalent signing facility and an external evidence chain proving that auditors did not observe private-key material.
