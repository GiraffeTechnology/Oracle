# Reference assets

These CC0 files accompany the Asynchronous Register Projection for NFTs submission-preparation draft.

Run the self-contained local-EVM suite with:

```sh
npm install
npm test
```

The suite requires no wallet, RPC endpoint, testnet asset, credential, or external signer. It contains 31 local-EVM protocol tests covering the three ERC-165 identifiers, the register and verification-profile accessors, the EIP-170 size limit, the projection invariants (strictly increasing `effectiveAt`, commitment uniqueness within a token, append-only versioning), `entryAsOf` and `holderAsOf` interval resolution, unblocked transfers during an open gap, gap supersession, atomic proof-verified admission, independent mutation of every bound leaf field, register and validator-set identity, signature rules, replay and stale-height rejection, Merkle membership, deadline-gated cancellation, unknown-settlement semantics, the finality rule, confirming entries, and the deferred entitlement registry.
