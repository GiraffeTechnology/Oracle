# Ethereum Magicians opening post — draft

Category: EIPs / ERCs. Post this first, then put its URL into `discussions-to`.

---

**Title:** Asynchronous Register Projection for NFTs — make every past instant resolve to exactly one confirmed holder

---

A token that stands for something recorded on an off-chain register lives with a gap it cannot close. Registration completes when the registrar completes it. Meanwhile the token trades. Nothing on chain says which of the two records is the confirmed one at any given moment.

The usual responses are both bad. Trust an oracle to say "registration finished", and the contract proves only what the oracle said. Freeze the token until registration finishes, and you have stopped a market to solve a bookkeeping problem — and destroyed any entitlement whose record instant fell inside the freeze.

Neither is necessary, because the register already supplies what is missing. Every change it makes has a unique identity: the instant it takes effect, and a commitment to its content. That is enough to build an ordered, verifiable projection of the register onto the token.

**The property being standardized**

Four invariants, and one consequence:

1. The first entry is version 1 with a zero previous commitment.
2. Each admitted change appends version `n+1` and links the prior commitment.
3. `effectiveAt` is **strictly** greater than the preceding entry's.
4. A record commitment is **unique within a token's own chain of entries**.

Consequence: **any past instant resolves to exactly one confirmed holder.** Strict monotonicity is not tidiness — an instant shared by two entries would have two answers. Commitment uniqueness is not tidiness — two entries that cannot be told apart cannot be resolved.

`ownerOf` is left alone. It is the tradeable position and it moves the moment the market moves. The projection is the confirmed record and it moves only when the register is proven to have moved. Ordinary transfers are explicitly **not** blocked while a gap is open.

**What this gives entitlements**

Because any instant resolves, the gap stops being a black hole. An entitlement resolves against the projection at the record instant its own terms specify:

- An exercise that **cannot** be performed later with equivalent effect — voting in a ballot that closes — is unavailable to both the outgoing and incoming party, and is extinguished. When you cannot determine the rightful party, abstention is the only outcome that cannot be wrong, and later resolution must not reopen a decided ballot.
- An exercise that **can** be performed later with equivalent effect — a distribution — is deferred, not destroyed. Once the projection admits the covering entry, it is credited to the party confirmed for that instant, even if that party no longer holds the token.

A deferred entitlement is recorded against the token, the entitlement id and the record instant, and deliberately does **not** bind a beneficiary address when deferred — that address is not yet determinable. It binds when the projection resolves.

Traditional infrastructure gets to the same place by centralising the arithmetic into an ex-date. This exposes the state instead and lets the parties do it themselves.

**Admission is proof-verified, and submitters are untrusted**

A change enters the projection only on proof that the corresponding record exists in a finalized state of the remote register. The proven leaf binds `block.chainid`, the token contract, token id, settlement id, the asserted holder, the initiation snapshot, the prior and next commitments, the version and the effective time. Verification and admission are atomic: no interval exists in which a proof has been accepted but the projection has not advanced. `msg.sender` plays no part in whether a proof is valid.

**Relationship to existing work**

[ERC-7965](https://eips.ethereum.org/EIPS/eip-7965) is the closest work on the proof side, and this is not a competitor to it. It standardizes proof-based verification of source-chain messages inside [ERC-7786](https://eips.ethereum.org/EIPS/eip-7786) gateways; its broadcast semantics require one proof to serve many recipients, so it deliberately does not bind a proof to a destination field set. It proves a message. It does not build an ordered register whose past instants resolve. An implementation here may draw proof material from an ERC-7965 route.

This is not a bridge. ICS-721 and xERC721-style designs escrow, burn or mint a representation so a token moves between chains. Here the ERC-721 never leaves its chain and nothing is minted; a proof admits a record.

[ERC-6997](https://eips.ethereum.org/EIPS/eip-6997) adds a validation stage to transfers, and notary-cleared holds are long established — all of them gate a transfer on an authorized party's word, and none maintains a time-resolvable record of who was confirmed when. [ERC-7765](https://eips.ethereum.org/EIPS/eip-7765) and [ERC-5496](https://eips.ethereum.org/EIPS/eip-5496) express whether a right may be exercised and let rights separate from ownership, but neither ties exercisability to an external register's state, nor defines deferral and later attribution. [ERC-7943](https://eips.ethereum.org/EIPS/eip-7943) composes with this for transfer eligibility.

**What I expect to be challenged on**

*Is one narrow invariant enough for a standard?* The test I would apply is whether independent parties must agree on it. They must: a marketplace, wallet, indexer or collateral system has no relationship with the registrar, yet has to know whether the current holder is confirmed or provisional, and a governance or distribution contract has to know who was confirmed at a record instant that may have passed while the register was catching up. `ownerOf` answers neither, and an issuer locking its own token cannot tell an unrelated venue why.

*Why not just freeze?* Because freezing does not make the gap resolvable — it only makes it expensive. The register is asynchronous either way; what changes is whether the answer exists.

**Status**

Draft. A CC0 reference implementation and 22 local-EVM tests accompany the proposal. The reference proof profile is deliberately minimal — a fixed validator set signing a domain-separated checkpoint, plus a Merkle membership proof — and its two limits are stated in the file header: validator equivocation is not detected and the validator set is immutable. Production profiles should use the remote register's native light client.

Interface identifiers are `0x3e925bdc` (`IRegisterProjection`) and `0xbe360d3d` (`IProjectionSettlement`).

Feedback welcome, particularly on: whether the deferred-entitlement registry belongs in this standard or in the entitlement contracts that consume it; whether the projection/settlement conformance split is the right one; and on the proof encoding profile.
