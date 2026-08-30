# Ethereum Magicians opening post — draft

Category: EIPs / ERCs. Post this first, then put its URL into `discussions-to`.

---

**Title:** Proof-Verified Deferred Asset Settlement — finalize an ERC-721 transfer only from a proven remote-ledger record

---

Tokens that stand for something recorded on another ledger have a window in which the two records disagree. The external record is being reassigned — a handover, a re-registration — and until that finishes, the on-chain holder is provisional. Nothing on chain says so today.

The parties who have to act on that window are not the issuer. Marketplaces, wallets, indexers and collateral systems have no relationship with whoever keeps the remote record, yet they are the ones that must stop listing, quoting or accepting the token while it is mid-reassignment. They read `ownerOf` plus a transferability check and conclude the token is current, because nothing distinguishes a final holder from a provisional one. An issuer can lock transfers inside its own contract, but it cannot tell an unrelated venue why the token is locked or when the lock lifts.

So this proposal does not claim the two records agree. It makes their divergence explicit and machine readable. While a settlement is pending, the holder is provisional and every ordinary transfer reverts. When the remote record has been updated and proven, the commitment and the holder advance in the same transaction, so re-convergence is one event any observer can verify.

**What is actually being standardized**

Two things, and they are consequences of one decision — that a proven remote record is the *sole* authorization for one specific local state transition:

1. The proven remote leaf must commit to **every field** of one identified local settlement: local chain id, token contract, token id, settlement id, both parties, the initiation snapshot, the prior and next commitments, the version, the effective time, and the asset anchor.
2. Proof acceptance, commitment supersession and the ERC-721 holder transition **succeed or revert together in one transaction**.

Proof submitters are untrusted. No account is authorized to substitute settlement facts; `msg.sender` plays no part in whether a proof is valid.

**Relationship to existing work**

[ERC-7965](https://eips.ethereum.org/EIPS/eip-7965) is the nearest neighbour and this proposal is not a competitor to it. It standardizes proof-based verification of source-chain messages inside [ERC-7786](https://eips.ethereum.org/EIPS/eip-7786) gateways. Two properties it deliberately leaves open are the two above: broadcast semantics require one proof to serve many recipients, so it does not bind a proof to a destination chain, contract or field set; and it does not constrain the relationship between verification and execution. An implementation here may take its proof material from an ERC-7965 route — that does not remove the binding and atomicity obligations.

This is also not a bridge. ICS-721 and the xERC721-style designs escrow, burn or mint a representation so a token moves between chains. Here the ERC-721 never leaves the chain it was issued on; the remote proof authorizes a change of local holder.

Deferred-transfer precedent exists — [ERC-6997](https://eips.ethereum.org/EIPS/eip-6997) adds a validation stage, [ERC-1996](https://eips.ethereum.org/EIPS/eip-1996) and [ERC-2018](https://eips.ethereum.org/EIPS/eip-2018) define holds cleared by a notary. None of them requires a finalized remote-state membership proof, and all of them accept an authorized party's word.

**What I expect to be challenged on, and my answer**

*Is this not just ERC-7965 composed with ERC-6997?* The invariant is not composable. A transport standard's responsibility ends at delivery; it cannot require the destination's state transition to be atomic with verification. That requirement has to live in the token contract, which is why it belongs in an interface other contracts can discover through ERC-165.

*Is one narrow invariant enough for a standard?* The test I would apply is whether independent parties must agree on it. Here they must: a venue cannot infer "provisional holder" from ERC-721 alone, and every issuer inventing its own signal defeats the purpose.

**Status**

Draft. A CC0 reference implementation and 39 local-EVM tests accompany the proposal. The reference proof profile is deliberately minimal — a fixed validator set signing a domain-separated checkpoint, plus a Merkle membership proof — and its two limits are stated in the file header: validator equivocation is not detected and the validator set is immutable. Production profiles should use the remote ledger's native light client.

Interface identifiers are `0xebaa86a0` and `0x2773d4c9`.

Feedback welcome, particularly on the proof encoding profile and on whether the conformance split between certificate-only and settlement conformance is the right one.
