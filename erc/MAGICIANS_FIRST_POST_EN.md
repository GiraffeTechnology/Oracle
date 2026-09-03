# Ethereum Magicians opening post — draft

Category: EIPs / ERCs. Post this first, then put its URL into `discussions-to`.

---

**Title:** Asynchronous Register Projection for NFTs — make every past instant resolve to exactly one confirmed holder

---

A token that stands for something recorded on an off-chain register lives with a gap it cannot close. Registration completes when the registrar completes it. Meanwhile the token trades. Nothing on chain says which of the two records is the confirmed one at any given moment.

**This does not replace an oracle, and I want to be exact about that up front.** A register of this kind usually cannot be published — confidential, personal, or simply not the registrar's to disclose — so what reaches the chain is a commitment and a reference, never the record. Something has to attest to what the register says, and no standard can remove that party: data that cannot go on chain has to be attested by someone who can see it.

What can be removed is the latitude that party normally gets. A bare oracle report is one statement at one moment: nothing binds it to what the same source said before, nothing stops two statements about one instant, and nothing lets an unrelated third party ask afterwards what was claimed at a given time. The alternative in practice is to freeze the token until registration finishes, which stops a market to solve a bookkeeping problem and destroys any right whose record instant fell inside the freeze.

Neither is necessary, because the register already supplies what is missing. Every change it makes has a unique identity: the instant it takes effect, and a commitment to its content. That is enough to build an ordered, verifiable projection of the register onto the token.

**The property being standardized**

Four invariants, and one consequence:

1. The first entry is version 1 with a zero previous commitment.
2. Each admitted change appends version `n+1` and links the prior commitment.
3. `effectiveAt` is **strictly** greater than the preceding entry's.
4. A record commitment is **unique within a token's own chain of entries**.

Consequence: **any past instant resolves to exactly one confirmed holder.** Strict monotonicity is not tidiness — an instant shared by two entries would have two answers. Commitment uniqueness is not tidiness — two entries that cannot be told apart cannot be resolved.

`ownerOf` is left alone. It is the tradeable position and it moves the moment the market moves. The projection is the confirmed record and it moves only when the register is proven to have moved. Ordinary transfers are explicitly **not** blocked while a gap is open.

**Finality falls out of the same invariants.** Resolving an instant and knowing the answer cannot change are different questions, and the second one is what a distribution actually needs. Because `effectiveAt` strictly increases and entries only append, no entry admitted in the future can ever cover an instant that already precedes the latest entry's effective time. So:

> An instant is final if and only if it is at or after the first entry's `effectiveAt` and strictly before the latest entry's.

One comparison, exposed as `isFinalAsOf`. Instants at or after the latest entry still resolve, but provisionally — a later admission may carry an earlier effective time and supersede the answer. Leaving each integrator to derive this is how a provisional answer gets treated as settled, which is exactly the mistake an asynchronous register makes easy.

Two consequences worth stating plainly. Cancelling a settlement settles nothing: the provisional answer reverts to the prior entry, but a change the register already made can still arrive later, so nothing becomes final. And an entry that confirms the *same* holder is permitted rather than rejected as a no-op — on a token whose holder never changes it is the only thing that ever makes an instant final, so a profile needs a way to produce one.

**What this gives rights — and what it deliberately does not**

Because any instant resolves, the gap stops being a black hole. A right resolves against the projection at the record instant its own terms specify, and three separate facts are available to it:

- `holderAsOf` — the confirmed holder at that instant.
- `isFinalAsOf` — whether a later admission can still change that answer.
- **contested** — whether a gap is open that opened at or before the instant.

**The ERC stops there.** Whether a right may be exercised at a non-final or contested instant, whether a blocked exercise is postponed or forfeited, and who bears a forfeiture, are decisions for the right's own terms. A dividend and a ballot should answer them differently, and an issuer and a DAO may answer them differently again. Fixing those answers in a standard would be legislating well past the point where interoperability needs agreement. What the ERC removes is the excuse for deciding blindly: the three facts are available at the moment of exercise and stay checkable afterwards.

As guidance rather than a rule: a distribution can be postponed at a cost of time alone, so finality suits it — defer, then credit the party the register confirms for the instant, even if that party no longer holds the token. A vote cannot be postponed, so finality is the wrong condition; the present moment is never final, and waiting for it would forbid voting at almost every moment rather than occasionally. Contestedness is the condition that fits a vote: bounded, visible in advance, avoidable.

There is deliberately **no registry here** for the postponed case. `holderAsOf` and `isFinalAsOf` already let the contract that owes a distribution bind its beneficiary itself, once the instant settles, and a standard that shipped its own registry would be supplying convenience rather than capability — and quietly picking one policy for everyone.

**Who may open a gap is not `ownerOf`**

The authority to begin a settlement is defined by the profile and readable through `isSettlementAuthority`. It is deliberately not ERC-721 authorization. Reusing that would be the smaller spec and the wrong one twice: the registrar — whose register this projects — could not record a change it had already made, and whoever last bought the token would acquire the ability to hold a gap open, which leaves every recent instant non-final and contested. Neither follows from holding a tradeable position. The spec does not fix who the authority is, since that differs by deployment; it requires that an unrelated third party be able to ask.

**Admission is proof-verified, and submitters are untrusted**

A change enters the projection only on proof that the corresponding record exists in a finalized state of the remote register — which is a proof about what the attesting party committed to, not about the world behind it. The proven leaf binds eleven fields: `block.chainid`, the token contract, token id, settlement id, the asserted holder, the initiation snapshot, the prior and next commitments, the registry reference, the version and the effective time. Leaves and internal nodes are tagged so they cannot share a preimage shape, and the finality checkpoint is signed under a full EIP-712 domain bound to this chain and this contract. Verification and admission are atomic: no interval exists in which a proof has been accepted but the projection has not advanced. `msg.sender` plays no part in whether a proof is valid.

**Relationship to existing work**

The closest work on the projection side is [ERC-5805](https://eips.ethereum.org/EIPS/eip-5805) with the contract clock of [ERC-6372](https://eips.ethereum.org/EIPS/eip-6372), and the first question to get out of the way is why this is not `getPastVotes`. ERC-5805 checkpoints voting weight and answers for a past timepoint, and it requires that answer to hold still — for any timepoint below the current clock the value SHOULD be constant, and past checkpoints SHOULD be immutable. It can require that because the chain writes those checkpoints and is itself the source of truth, so no later write can land behind an earlier one. Here the chain does not control the register, and entries arrive *after* the instants they take effect at, so a past instant's answer is provisional until a later entry closes it. **Finality is vacuous there and decidable here** — that difference is the proposal, not an implementation detail. ERC-6372 standardizes how a contract declares its own clock; the instants here are the register's, stated on the same scale so the two can be compared.

[ERC-7965](https://eips.ethereum.org/EIPS/eip-7965) is the closest work on the proof side, and this is not a competitor to it. It standardizes proof-based verification of source-chain messages inside [ERC-7786](https://eips.ethereum.org/EIPS/eip-7786) gateways; its broadcast semantics require one proof to serve many recipients, so it deliberately does not bind a proof to a destination field set. It proves a message. It does not build an ordered register whose past instants resolve. An implementation here may draw proof material from an ERC-7965 route.

This is not a bridge. ICS-721 and xERC721-style designs escrow, burn or mint a representation so a token moves between chains. Here the ERC-721 never leaves its chain and nothing is minted; a proof admits a record.

[ERC-6997](https://eips.ethereum.org/EIPS/eip-6997) adds a validation stage to transfers, and notary-cleared holds are long established — all of them gate a transfer on an authorized party's word, and none maintains a time-resolvable record of who was confirmed when. [ERC-7765](https://eips.ethereum.org/EIPS/eip-7765) and [ERC-5496](https://eips.ethereum.org/EIPS/eip-5496) express whether a right may be exercised and let rights separate from ownership, but neither ties exercisability to an external register's state, nor lets a contract ask who was confirmed at a past instant and whether that answer is settled. [ERC-7943](https://eips.ethereum.org/EIPS/eip-7943) composes with this for transfer eligibility.

**What I expect to be challenged on**

*Is one narrow invariant enough for a standard?* The test I would apply is whether independent parties must agree on it. They must: a marketplace, wallet, indexer or collateral system has no relationship with the registrar, yet has to know whether the current holder is confirmed or provisional, and a governance or distribution contract has to know who was confirmed at a record instant that may have passed while the register was catching up. `ownerOf` answers neither, and an issuer locking its own token cannot tell an unrelated venue why.

*Why not just freeze?* Because freezing does not make the gap resolvable — it only makes it expensive. The register is asynchronous either way; what changes is whether the answer exists.

**Status**

Draft. A CC0 reference implementation and a local-EVM test suite accompany the proposal. The reference proof profile is deliberately minimal — a fixed validator set signing an EIP-712 checkpoint, plus a tagged Merkle membership proof — and its limits are stated in the file header: validator equivocation is not detected, the validator set is immutable, and the settlement authority is a single immutable registrar address. Where the remote register is itself a ledger with consensus, production profiles should use its native light client. Many registers are not — a share registrar or a title office has no consensus and no state root — and there the validator set is an attestation quorum rather than a consensus, which the profile has to disclose.

Interface identifiers are `0x6309e170` (`IRegisterProjection`) and `0xf4a7d71b` (`IProjectionSettlement`).

Feedback welcome, particularly on the finality rule, on whether contestedness is the right condition for perishable exercises, on how tightly a profile should bound supersession by the settlement authority, and on the proof encoding profile.
