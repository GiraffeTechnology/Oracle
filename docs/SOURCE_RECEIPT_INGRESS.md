# Authenticated source-receipt ingestion

This optional Oracle application extension builds on `RECEIPT_BINDING_EXTENSION.md`. It does not change ERC-8415, authorize a deployment, create a signer, accept ArtFi uploads, or execute payments.

## Fixed source and original-document verification

The existing fixed source transport is reused. Its source ID, TLS connection, `authenticated` flag and record hash are **not** cryptographic source authentication by themselves. Admission verifies an Ed25519 signature over the existing canonical-JSON encoding of the **complete** envelope:

- `sourceId`, `schemaVersion` (`registration-receipt.v1`), `recordReference`, canonical ISO `issuedAt`, `nonce`, `idempotencyKey`, `payload`.
- Payload: `registrationSource`, fixed `target` (`chainId`, `contract`, `registerId`, `sourceAuthority`), `tokenId`, `expectedPreviousVersion`, `previousCommitment`, `recordCommitment`, `registryReference`, `holder`, `effectiveAt`, and `binding`.
- Binding order remains `schemaId`, `mintPolicyHash`, `segmentDigest`, `requestHash`, `receiptDocumentHash`. Schema is `keccak256("oracle.receipt-binding.v1")`.

The transport response must include that envelope, its unpadded base64url Ed25519 signature, matching `sourceId`/`schemaVersion`, `authenticated: true`, `record: envelope.payload`, and `recordHash: evidenceHash(envelope.payload)`. Decimal integers are canonical strings. Fresh admission permits at most five minutes of clock skew. Source and key must be active and valid both at issuance and at admission. No document URL, caller-selected holder, endpoint, route or signer is accepted as ingress input.

`REG_DIRECT`, `REG_ELECTRONIC`, and `REG_INTERMEDIARY` are explicit product routes. Each route maps to an existing registered source in pinned server configuration. They are not inferred from generic source kinds. The source-signed route must match. ArtFi's full mint policy maps these strings to codes 1, 2 and 3 respectively; Oracle's base contract keeps only the opaque immutable policy commitment.

Source authentication proves a signed normalized field commitment. It does **not**, by itself, prove that the original document bytes were hashed or that a mint-declared format was parsed correctly. Accordingly receipt assembly also requires a pinned `receipt-format-verifier` capability and an exact `formatProfileId`. An absent or mismatched profile/capability refuses startup/admission. The verifier interface is:

```js
{
  profileId, // exact server-configured approved profile
  async verifyOriginalRegistration({ profileId, intent }) {
    // Return only after all original-document and mint-policy checks succeed.
    return {
      verified: true,
      profileId,
      intentHash, // evidenceHash of the complete immutable intent supplied
      receiptDocumentHash,
      mintPolicyHash,
      receiptFormatHash,
    };
  },
}
```

The deployment-owned verifier must retrieve the **original existing registration-change document** through its fixed authenticated source reference, recompute its digest under the approved format's rules, verify the full product-policy preimage against the on-chain immutable mint commitment, select its mint-declared `receiptFormatHash`, parse that approved format, and compare all normalized registration/correspondence fields with the signed intent. It must reject unknown formats, mismatched metadata/routes, unbound policy preimages, incomplete documents, and any mismatch. The capability's result is checked against the exact profile, intent, document hash and policy hash. No original bytes or signature are put into the journal or read API. This is an internal source process, not a second receipt or an ArtFi upload route.

No approved institution-specific original-document parser/profile was found in the repository's existing fixed-source adapters/configuration. This change therefore provides the strict integration interface and fail-closed assembly, **not** an institution parser or a claim that production originals have been verified. The integration test uses an explicitly synthetic JSON profile, hashes its original bytes, compares parsed fields, and checks its synthetic policy preimage against the local mint anchor. That fixture is not a production-approved format. Deployment remains disabled until the existing approved institution adapter/profile is supplied and tested.

## Pinned deployment assembly

An optional `receiptConfiguration` export on the existing hash-pinned deployment module contains exactly:

- `profileId: "oracle-source-receipt.v1"`
- `sourceRoutes`: one to three `{ registrationSource, sourceId }` pairs with unique routes
- `schemaVersion: "registration-receipt.v1"`
- `target`: fixed chain/contract/register/source-authority identity
- `rpcRef`, `executionClientRef`, `signerReference`, `formatVerifierRef`: existing `deployment://.../...` references, never secrets or request input
- `formatProfileId`: the exact approved original-document profile
- `minConfirmations`: an explicit integer from 1 to 256

The mapped source must already authorize this schema in its L2 source definition. Its existing `keySetRef` resolves a source-key registry whose key-set ID matches the runtime source registration. `rpcRef` resolves an EIP-1193 request capability supporting EIP-1898 hash-pinned reads. `executionClientRef` resolves `submit` and `lookup` methods. `formatVerifierRef` resolves the capability above. No production profile, credentials, permissions or deployment environment variables are changed here.

The assembled internal capabilities are `assembly.sourceReceiptIngress.REG_DIRECT` (and only other explicitly configured routes), each exposing `ingest({ recordRef })` and `reconcile({ intentHash })`. There is no HTTP ingress route. They enter the existing repository lifecycle scope when enabled. Compromise, disabled external writes, inactive sources/keys and signer recovery block admission; source/key admission is checked again synchronously immediately before execution dispatch.

The broker accepts only:

```js
submit({ executionReference, signerReference, chainId, from, to, data, value: '0x0' });
lookup({ executionReference, signerReference });
```

`executionReference` is `oracle-receipt:` plus the immutable intent's SHA-256 evidence hash. The existing deployment broker must durably associate this reference with its transaction identity and must not silently create a second execution for it. A missing lookup result means unknown, never permission to retry. The source authority is an existing authorized signing capability injected by reference; the Ed25519 attestation signer is not reinterpreted as an EVM signer.

## Atomic checked append

Production writer calldata uses only the additive entrypoint:

```solidity
appendReceiptFromSourceChecked(
    uint256 tokenId, bytes32 recordCommitment, bytes32 registryReference,
    address registerHolder, uint64 effectiveAt,
    uint64 expectedPreviousVersion, bytes32 expectedPreviousCommitment,
    ReceiptBinding binding
)
```

Selector: `0x75f1e78f`. The current entry's version **and** commitment are compared inside the same transaction before the existing admission hook, holder projection and binding mutation. A source-authorized competing append between RPC preflight and mining cannot make this receipt register against the wrong predecessor. Failure does not consume a commitment/segment or change the holder/entry/binding. All older entrypoints, hooks and standard interfaces remain available with their established semantics; this writer never falls back to an unchecked entrypoint.

## Durable state and recovery

Apply the additive `002_source_receipt_journal.sql` through the existing deployment migration process. Fresh installations include the same guarded DDL in `001_initial.sql`. This repository change does not run a migration against production.

The journal uses InnoDB transaction-scoped row locks, binary uniqueness, and an immutable canonical intent. Sorted lock keys cover source/idempotency, source/nonce, chain/contract/segment, and the domain/token lane. Do not delete lock rows while any writer can run.

- `PREPARED`: authenticated and persisted, never claimed. Only a committed transition to `SUBMITTING` grants one submission attempt.
- `SUBMITTING`, `SUBMITTED`, `UNKNOWN`: never automatically resubmitted. Restart uses the same execution reference and read-only reconciliation, including lost broker responses or uncertain commits.
- `CONFIRMED`: exact transaction sender/target/chain/calldata, both source events, historical entry and binding at its canonical block, plus configured confirmation depth. Later entries do not erase historical proof.
- `FAILED`: exact intended transaction has a canonical `status = 0` receipt with enough confirmations. Its block identity is retained; it releases the lane for a separately authenticated new intent. The original intent is never resubmitted. A later reorg clears this evidence and blocks the lane again until reconciled.
- `REORGED`: previous canonical evidence is unavailable or changed. No confirmation coordinates are retained. Reconciliation continues without resubmission.
- `REJECTED`: transaction/receipt identity, events or state did not match. It remains quarantined and read-only recheckable; it does not release the lane.
- `OBSOLETE`: only an unclaimed `PREPARED` intent can enter this state, under its exact revision, after preflight proves its predecessor changed. It has no transaction and releases the lane. Already claimed/unknown intents cannot use this escape.

Every external observation is bound to the revision read before RPC work. A stale observation is rejected without applying it, so delayed success cannot overwrite newer reorg evidence. Expected domain conflicts are returned from successful read/lock transactions and raised outside them: a normal pending lane or replay conflict does not globally block lifecycle admission. Actual SQL, commit, rollback and cleanup uncertainty preserves the existing repository's fail-closed behavior and exact error object; it is not retried or unwrapped.

For a crash between prepare and claim, internal `reconcile({ intentHash })` retrieves the same original signed envelope again. Only an envelope whose hash exactly matches the previously admitted record may pass beyond the initial freshness window. Its original signature, full fields, current source/key authorization, original-document format verification and current chain predecessor are all checked again. Re-signing a different envelope does not bypass the durable identity. Revoked sources or keys still refuse. A changed predecessor can obsolete only the never-claimed record.

## Read-only API

Optional routes:

- `GET /v1/oracle/projection/:tokenId/receipt/current`
- `GET /v1/oracle/projection/:tokenId/receipt/version/:version`

Identity, token existence, entry, mint anchor and receipt tuple are read using the same EIP-1898 `{ blockHash, requireCanonical: true }`; the block is rechecked before returning. The response includes fixed source identity and that block's number/hash. An all-zero binding is `receiptAvailable: false`; a legacy zero mint anchor is unavailable. Missing/malformed/domain-mismatched source reads never become proof. These reads describe a canonical snapshot, not settlement or finality. Applications retain their own confirmation/finality, policy-deadline and funds/NFT correspondence checks. Legacy API routes and ERC-8415 semantics are unchanged.

## Test boundary

Dependency-free Node tests cover signature tampering, fixed source/route/schema/key/time failures, strict format proof, journal conflicts, restart, lost outcomes, stale observations, expired PREPARED recovery, obsolete PREPARED recovery, reorg and actual lifecycle-coordinator behavior. The journal uses production adapter/repository code with an explicit **SQL-capture test driver**, not a live MySQL server.

The existing contract test job also runs `test/receipt-chain/*.test.mjs` through `erc-8415/test/source-receipt-pipeline.cjs`. It validates static ABI against ethers and executes ephemeral Hardhat mint/checked append, full signed fixed-source assembly, synthetic original-format verification, historical confirmation, predecessor races, reverted-transaction recovery, and reorg. No public chain or real signing credentials are used. Existing CI's MySQL job can validate the fresh DDL and backup/restore against MySQL 8.4; that is not live journal-transaction integration coverage. A production MySQL driver/server integration run and approved source-format/broker deployment checks remain required before enablement.
