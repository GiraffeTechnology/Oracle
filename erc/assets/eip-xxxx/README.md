# Reference assets

These CC0 files accompany the Proof-Verified Deferred Asset Settlement submission-preparation draft.

Run the self-contained local-EVM suite with:

```sh
npm install
npm test
```

The suite requires no wallet, RPC endpoint, testnet asset, credential, or external signer. It contains 39 local-EVM protocol tests covering finalized checkpoint signatures, ledger and validator-set identity, Merkle membership, full settlement-field binding, replay and rollback protection, transfer locking, cancellation, append-only history, zero-authority rejection, non-callback contract recipients, and unknown-settlement semantics. Historical ZIPs remain immutable evidence but are not the current submission assets.
