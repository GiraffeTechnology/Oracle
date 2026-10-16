# Optional source receipt binding

This is an Oracle implementation extension, not an ERC-8415 requirement or a
settlement interface. It preserves the ERC-165, ERC-721, and IRegisterProjection
interfaces, existing events, temporal history, finality, and independent NFT
ownership. The projection interface ID remains `0x6309e170`.

## Mint-time commitment

The configured, immutable `sourceAuthority` can call:

```solidity
mintReceiptFromSource(
    address tokenOwner,
    uint256 tokenId,
    bytes32 recordCommitment,
    bytes32 registryReference,
    address registerHolder,
    uint64 effectiveAt,
    bytes32 policyHash
)
```

A nonzero `policyHash` is stored in the transaction that creates the original NFT
and its first register entry. `mintPolicyHash(tokenId)` reads it. There is no
post-mint setter, upgrade path for legacy tokens, or second NFT. A failed mint
creates neither the token nor its policy commitment. `MintPolicyCommitted` is
emitted in the same transaction as `Transfer` and `RegisterInitialized`.

The application owns the policy contents, canonical hash encoding, receipt
format and metadata commitments, absolute trading and registration deadlines,
and product transfer rules. Oracle stores only the opaque hash. In particular,
Oracle does not create durations, reset deadlines, or infer an institutional
fact from a market action. A derived application token can override both public
mint methods and use `_mintFromSource` after storing and validating its complete
policy in that same transaction. The application must ensure its policy hash
includes the intended chain, contract, register, token, and complete policy.

## Same-entry source receipt

The source admits a registration and its binding in one transaction:

```solidity
struct ReceiptBinding {
    bytes32 schemaId;
    bytes32 mintPolicyHash;
    bytes32 segmentDigest;
    bytes32 requestHash;
    bytes32 receiptDocumentHash;
}

appendReceiptFromSource(
    uint256 tokenId,
    bytes32 recordCommitment,
    bytes32 registryReference,
    address registerHolder,
    uint64 effectiveAt,
    ReceiptBinding binding
)
```

The tuple order above is the shared ABI. The schema constant is:

```solidity
RECEIPT_BINDING_SCHEMA_V1 = keccak256("oracle.receipt-binding.v1")
```

`receiptBinding(tokenId, version)` returns that exact five-word tuple. Oracle
checks the supported schema, nonzero fields, equality to the mint commitment,
and that the segment digest has not already been admitted by this contract.
A segment can bind to only one token/version; changing the record commitment,
request hash, token, or effective instant cannot replay its digest. Failed
admission does not consume the digest.

The binding is stored under the version created by the existing append logic.
The holder, record commitment, previous commitment, effective instant, preceding
interval closure, and binding either all commit or all revert. `ReceiptBound`
and the existing `RegisterSuperseded` event occur in that same transaction.
There is no independent receipt-update or backfill method.

`receiptDocumentHash` identifies the authoritative registration-change document
itself. It is not a second, later offline receipt. The existing source authority
is responsible for authenticating that document and verifying its holder,
record commitment, request, and segment correspondence under the committed
application policy. The base contract does not independently parse documents or
recompute an application EIP-712 digest. Source-only admission is an authority
boundary, not proof that arbitrary supplied content is true. A consumer must
validate its expected policy, schema, request, document, segment, token/version,
and register entry, including the existing domain-separated segment digest
that binds chain, escrow, sale, asset, participants, and transaction references.

## Compatibility and fail-closed reads

- Original `mintFromSource` and `appendFromSource` selectors and semantics remain
  available for legacy, unbound tokens.
- A policy-bound token rejects `appendFromSource` with `ReceiptBindingRequired`;
  its source must use atomic receipt admission. This prevents a binding bypass.
- An existing legacy entry, and version one of a policy mint, return an all-zero
  binding. These are not registration receipts and cannot satisfy the new
  application's receipt requirement.
- A legacy token has a zero mint commitment and cannot acquire a policy later.
  Receipt admission for that token fails closed.
- Missing tokens or invalid versions revert. A missing optional receipt surface
  in an older deployment must likewise be treated as unavailable, never as a
  successful receipt.
- The legacy read-only consumer ABI and its pinned historical fixture remain
  unchanged. Application API exposure of this optional surface is a separate
  integration step; the old API must not claim it already supplies this proof.

## Application hooks and authority

`transferFrom` is virtual, and `_transferOwner` contains the existing balance,
approval-clear, owner-change, and event mutation. The helper is internal only;
the base exposes no new transfer authority to the source. Both safe-transfer
entrypoints dispatch through the virtual transfer method.

`_validateReceiptAdmission(tokenId, registerHolder, effectiveAt, binding)` is an
internal, view, default-no-op hook invoked before append. A derived product can
validate its own admitted workflow without placing product deadlines, rollback,
wallet execution, payments, custody, release, or refund logic in Oracle. Any
application override remains responsible for preserving the authoritative
registration facts and the distinction between register holder and NFT owner.

## Verification

Run the unchanged ERC test entrypoint, `node scripts/run-erc-tests.mjs` (or
`pnpm test:erc`). The extension suite compiles Solidity with the installed
Hardhat compiler and exercises an ephemeral local Hardhat network only.

The existing 13 conformance/consumer tests remain, including the shared Kit
projection vectors and finality boundaries. Twelve additional tests cover
mint atomicity and immutability, authorization, exact tuple storage/events,
schema/policy/missing-field rejection, append failure atomicity and retry,
replay across versions/tokens, immutable history, legacy compatibility and
no backfill, binding-bypass rejection, source versus NFT-owner authority, and
derived admission/safe-transfer hooks. These tests do not assert live-chain
execution, production source authentication, or completed ArtFi integration.
