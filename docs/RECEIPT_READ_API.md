# Receipt version read contract

This is an Oracle application extension, not an ERC-8415 normative interface.
It reuses the original stage-2 receipt field order and read selectors from the
private reviewed source tree `2fda94c7701fdb17e625f9617fbd17249d415c9f`.
The current increment is based on Oracle main
`27217e65a6e71baaeff5d7c53a2c8de126e5b69d` / tree
`bf5945d4ec261d3abc06de401f4134c126c99b48`. It is source work, not a served URL.

## Caller, target and source authority

An application calls Oracle, never a caller-selected RPC or Kit endpoint:

```
GET /v1/oracle/projection/:tokenId/receipt/current
GET /v1/oracle/projection/:tokenId/receipt/version/:version
```

IDs and versions are canonical decimal strings. An explicit version is at least
one. The target is fixed by the existing hash-pinned deployment module: chain ID,
projection contract, register ID and sourceAuthority. The read adapter verifies
actual `eth_chainId`, exact runtime bytecode and the contract's register/authority
at the pinned block. Token `ownerOf` proves existence only, never institutional
authority. Wallet Ethereum-default behavior does not change this explicit binding.
The surface discloses only the existing public-chain projection fields.

`current` means the latest entry at the selected confirmed observation block,
which may lag the live chain tip. `version/N` always resolves that historical
version, even when the current holder has advanced. There is no receipt/as-of
route: temporal entry/finality accessors remain separate. Registration, receipt
availability, transaction confirmation, temporal finality and funds release are
different facts.

## Schema, full read ABI and proof boundary

The complete human-readable read ABI is exported as `RECEIPT_READ_ABI` from
`src/adapters/evm-receipt-read-source.js`. It contains registerId, sourceAuthority,
ownerOf, entryCount, mintPolicyHash, entryAt and receiptBinding. Existing tuple
orders are:

```
entryAt: (recordCommitment, previousCommitment, registryReference, holder,
          version, effectiveAt, supersededAt)
receiptBinding: (schemaId, mintPolicyHash, segmentDigest, requestHash,
                 receiptDocumentHash)
```

The schema commitment is
`0xee5bd417e3dddcc2dfb85f45260f817dc32e4c1945000d5bb7a738c142a4f9e3`,
the existing `keccak256("oracle.receipt-binding.v1")` identifier.
The response contains `tokenId`, `source`, `block`, `entry`, `mintPolicyHash`,
`receiptBinding`, `receiptAvailable` and `evidence`. Evidence is explicitly
`canonical-contract-state`, not a ZK proof, transaction/log inclusion proof or
proof that original institution documents were correctly parsed. All eth_call
and code reads use the same EIP-1898 block hash with `requireCanonical: true`;
canonical block, confirmation depth and provider chain are checked before return.
All-zero receipt tuples return `receiptAvailable: false` and cannot authorize an
application action. Partial/foreign-schema/mismatched-policy tuples are refused.

The prior internal ingress contract's separate approved capability remains:

```js
{ profileId, async verifyOriginalRegistration({ profileId, intent }) {
  // Return only after original bytes, mint-policy preimage, approved format,
  // declared time rules and every normalized correspondence field are checked.
  return { verified: true, profileId, intentHash, receiptDocumentHash,
    mintPolicyHash, receiptFormatHash };
} }
```

This is an interface requirement, not an installed institution verifier. No
implementation or approved profile is supplied by this read-only increment.

The consumer must bind asset, funded segment, request and journal to the complete
mint policy and its existing domain-separated preimages. The API cannot derive
those preimages from hashes. A sourceAuthority address, fixed RPC, signature or
the returned tuple does not independently verify original-document authenticity.
The approved institution parser/profile and trusted asset/segment/journal mapping
remain missing deployment dependencies. Do not install this read client alone as
a complete `NFTReceiptAuthority`, fabricate mapping inputs or clear the
application's refusal merely because receipt fields are present.

## Errors, unknown outcomes and retry

| HTTP | Error / meaning | Consumer action |
| --- | --- | --- |
| 400 | TOKEN_ID_INVALID / VERSION_INVALID | Correct the request; no numeric coercion |
| 404 | EMPTY_PROJECTION / UNKNOWN_VERSION | No evidence at this confirmed snapshot; never infer non-execution or roll back a registered prefix |
| 405 | PROJECTION_READ_ONLY | No write or original-document upload route exists |
| 409 | RECEIPT_DOMAIN_MISMATCH / RECEIPT_RUNTIME_IDENTITY_MISMATCH / RECEIPT_SOURCE_REORGED | Stop using the observation; reconcile the exact source/version |
| 502 | RECEIPT_SOURCE_MALFORMED | Refuse evidence; investigate the source |
| 503 | RECEIPT_SOURCE_NOT_CONFIGURED / RECEIPT_SOURCE_BINDING_INVALID / RECEIPT_RUNTIME_CODE_PIN_REQUIRED / RECEIPT_POLICY_UNAVAILABLE / RECEIPT_CONFIRMATIONS_UNAVAILABLE / RECEIPT_SOURCE_UNAVAILABLE | Unavailable, never success |

A timeout, failed RPC, unconfirmed append or missing version is not authoritative
business rejection and does not resolve a prior UNKNOWN broadcast. There is no
automatic retry, submission, signature, nonce or reservation mutation here. A
consumer may perform a separately authorized read again with the same explicit
version. Reconcile existing journals/receipts before any independently authorized
write; never use this endpoint as permission to repeat an unknown write.

## Existing deployment entry and remaining bindings

`loadPinnedDeploymentModule` accepts an optional `receiptReadConfiguration` export:

```
{
  profileId: "oracle-receipt-read.v1",
  rpcRef: "deployment://<existing-project>/<existing-read-capability>",
  target: { chainId, contract, registerId, sourceAuthority },
  expectedRuntimeCode,
  minConfirmations
}
```

No production values are supplied by this change. `rpcRef` resolves only the
existing `receipt-rpc` read capability; it is not a URL, signer or execution
client. Exact runtime bytecode must come from the approved deployed artifact,
not from accepting whatever code the provider returns. Confirmation depth must
be explicit, 1 through 256. The existing production assembly, repository
lifecycle scope, compromised-state guard, main and HTTP dispatch carry this
capability. Missing configuration keeps only these optional receipt routes
unavailable; it does not disable unrelated projection APIs or establish a
prerequisite for wallet operations. This read-only capability creates no server,
credential, deployment, migration or signer and grants no transaction authority.
Internal operator instructions and project-specific execution notices are kept
outside this product API contract.

The assembly snapshots target, expected runtime bytes and confirmation depth
before awaiting capability resolution. Mutating the deployment export during
that await cannot silently change the admitted read identity or depth.

Source definitions and regression definitions are authored here. Author tests,
approved Linux validation, CI, deployment, served identity, approved original
format verification and ArtFi constructor wiring are separate evidence layers;
none is implied by this document or a successful metadata hash check.

The observation deadline also fences the callback passed into the repository
read guard. If a guard defers that callback until after the deadline, invoking
it fails unavailable before transport starts. Already-started provider requests
cannot be assumed cancelled; their late responses cannot produce a successful
snapshot or initiate subsequent reads. No automatic retry is performed.
