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

**Finality falls out of the same invariants.** Resolving an instant and knowing the answer cannot change are different questions, and the second one is what a distribution actually needs. Because `effectiveAt` strictly increases and entries only append, no entry admitted in the future can ever cover an instant that already precedes the latest entry's effective time. So:

> An instant is final if and only if it is strictly before the latest entry's `effectiveAt`.

One comparison, exposed as `isFinalAsOf`. Instants at or after the latest entry still resolve, but provisionally — a later admission may carry an earlier effective time and supersede the answer. Leaving each integrator to derive this is how a provisional answer gets treated as settled, which is exactly the mistake an asynchronous register makes easy.

Two consequences worth stating plainly. Cancelling a settlement settles nothing: the provisional answer reverts to the prior entry, but a change the register already made can still arrive later, so nothing becomes final. And an entry that confirms the *same* holder is permitted rather than rejected as a no-op — on a token whose holder never changes it is the only thing that ever makes an instant final, so a profile needs a way to produce one.

**What this gives rights — and what it deliberately does not**

Because any instant resolves, the gap stops being a black hole. A right resolves against the projection at the record instant its own terms specify, and three separate facts are available to it:

- `holderAsOf` — the confirmed holder at that instant.
- `isFinalAsOf` — whether a later admission can still change that answer.
- **contested** — whether a gap is open that opened at or before the instant.

**The ERC stops there.** Whether a right may be exercised at a non-final or contested instant, whether a blocked exercise is postponed or forfeited, and who bears a forfeiture, are decisions for the right's own terms. A dividend and a ballot should answer them differently, and an issuer and a DAO may answer them differently again. Fixing those answers in a standard would be legislating well past the point where interoperability needs agreement. What the ERC removes is the excuse for deciding blindly: the three facts are available at the moment of exercise and stay checkable afterwards.

As guidance rather than a rule: a distribution can be postponed at a cost of time alone, so finality suits it — defer, then credit the party the register confirms for the instant, even if that party no longer holds the token. A vote cannot be postponed, so finality is the wrong condition; the present moment is never final, and waiting for it would forbid voting at almost every moment rather than occasionally. Contestedness is the condition that fits a vote: bounded, visible in advance, avoidable.

There is a registry for the postponed case, and it is a place to record an attribution, not a mandate to postpone. A deferral is keyed on the token, the entitlement id and the record instant, and binds **no** beneficiary address when recorded — that address is not yet determinable. `resolveDeferral` reverts until `isFinalAsOf` is true, then binds the beneficiary to `holderAsOf` at that instant. Anyone may call it, because the projection fixes the outcome, not the caller. It records who the register confirms; it does not decide whether a right should be postponed, what it is worth, or who owes it.

Gating perishable exercises on finality would be a design error worth naming, because it is tempting: the present moment is at or after the latest entry's effective time and is therefore never final, so a finality gate forbids voting at almost every moment rather than occasionally. Contestedness is bounded, published in advance, and avoidable.

A registered market avoids the question differently: a board resolves to close the register, so the record date is fixed before anyone votes. The board is constituted *outside* the register — its membership does not depend on what the register says about any holding. On-chain governance has no such body: the right to open a proposal and the right to vote both derive from holding, which is exactly what the projection is resolving, so there is no roll to consult before the projection has answered.

**Governance can still reach the same arrangement, and needs nothing from this ERC to do it.** An entry is admitted only into an open gap, and opening one requires ERC-721 authorization. So an interval with no gap open at its start and none begun during it — the spec calls it *quiescent* — is an interval in which the projection cannot move at all. That is precisely what closing a register buys. A DAO can vote to keep a window quiescent and get a record instant fixed in advance, with no new primitive.

**What it cannot do is protect the act that constitutes it.** The vote establishing a closure is held with no closure in force, and so is the vote that would establish that one. The regress has no bottom. So some exercise must always be evaluated against the projection as it stands, and its basis recorded. The contested rule is not a fallback for unsophisticated registers — it is the floor everything else is built on.

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

Draft. A CC0 reference implementation and 32 local-EVM tests accompany the proposal. The reference proof profile is deliberately minimal — a fixed validator set signing a domain-separated checkpoint, plus a Merkle membership proof — and its two limits are stated in the file header: validator equivocation is not detected and the validator set is immutable. Production profiles should use the remote register's native light client.

Interface identifiers are `0x3ce71a8d` (`IRegisterProjection`), `0xfd0f6337` (`IProjectionSettlement`) and `0x6d39b0a8` (`IDeferredEntitlement`).

Feedback welcome, particularly on the finality rule, on whether the deferral registry earns its place at all given that `holderAsOf` and `isFinalAsOf` already let a consuming contract do the same binding itself, and on the proof encoding profile.
