---
eip: XXXX
title: Asynchronous Register Projection for NFTs
description: Projects an asynchronous off-chain register onto ERC-721 so any past instant resolves to one confirmed holder
author: Michael Yip (@GiraffeTechnology)
discussions-to: https://ethereum-magicians.org/t/REPLACE_WITH_DISCUSSION_SLUG
status: Draft
type: Standards Track
category: ERC
created: 2026-08-24
requires: 165, 721
---

## Abstract

An off-chain register that records who holds an asset updates asynchronously. No on-chain design can remove that lag. Each register change does, however, have a unique identity: the instant it takes effect and a commitment to its content.

This ERC uses that identity to build a verifiable, totally ordered projection of such a register onto an [ERC-721](./eip-721.md) token. Entries are append-only, their effective times strictly increase, and their commitments are unique within a token, so **any past instant resolves to exactly one confirmed holder** even while the chain lags the register.

Whether an instant's answer can still change is decidable from the same invariants, so a right whose record instant is not yet settled can be postponed by the contract that owes it and later attributed to the party the register confirms for it.

The token continues to trade throughout. `ownerOf` is the tradeable position; the projection is the confirmed record. Rights resolve against the projection, so a holder change that the register has not yet confirmed cannot silently redirect one.

A change is admitted to the projection only on proof that the corresponding record exists in a finalized state of the remote register. Proof submitters are untrusted. The register's contents stay off chain; only commitments and references reach it.

## Motivation

Applications that mirror an off-chain register on chain face a gap they cannot close. Registration completes when the registrar completes it. Meanwhile the token trades.

A register of this kind usually cannot be published. Its contents may be confidential, may identify people, or may exist only as records the registrar is not free to disclose, so what reaches the chain is a commitment and a reference rather than the register. Something must therefore attest to what the register says, and **this ERC does not remove that party**. No standard can: data that cannot go on chain has to be attested by someone who can see it.

What can be removed is the latitude that party is usually given. An assertion delivered as a bare report is a single statement at a single moment. Nothing binds it to what the same source said before, nothing prevents two statements about one instant, and nothing lets an unrelated third party ask afterwards what was claimed at a given time. The alternative taken in practice is to freeze the token until registration finishes, which stops a market to solve a bookkeeping problem and destroys any right whose record instant falls inside the freeze.

Neither the unaccountable report nor the freeze is necessary. The register's own change identity is enough. If every admitted change carries a strictly later effective time and a commitment unique to that token, the on-chain history is a total order, and a question of the form *who did the register record at this instant* has exactly one answer for every instant in the past.

That single property is what third parties need and cannot get today. A marketplace, a wallet, an indexer or a collateral system has no relationship with the registrar, yet must know whether the current holder is confirmed or merely provisional. A governance or distribution contract must know who was confirmed at a record instant that may have passed while the register was still catching up. `ownerOf` cannot answer either question, and an issuer that locks its own token cannot tell an unrelated venue why.

Illustrative uses include a title registry that reissues a record after a transfer, a licensing ledger that records a replacement permit, and a custodian ledger that supersedes a holding record. These describe technical coordination only; they do not make the token, the proof or the remote record legally effective.

## Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119 and RFC 8174.

### Definitions

A **remote register** is the external ledger that records holders of the represented asset. Its updates are asynchronous with respect to this chain.

A **register entry** is one admitted change, identified by its effective time and its record commitment.

A **record commitment** is a nonzero `bytes32` commitment to the register's content at that entry. An implementation profile MUST define its algorithm, canonicalization and domain separation.

A **confirmed holder** at an instant is the `holder` of the entry whose effective interval contains that instant. It is distinct from `ownerOf`, which is the tradeable position.

An instant is **final** when no entry admitted in the future can change the confirmed holder for it. An answer that a later admission may supersede is **provisional**.

A **projection gap** is an interval in which a change is known to be in progress and not yet admitted. A pending settlement marks such a gap.

An instant is **contested** when a projection gap is open on the token and that gap opened at or before the instant. A contract offering no settlement interface has no gaps and no contested instants.

An interval is **quiescent** for a token when no gap is open at its start and none is begun during it.

A **verification profile** defines the remote-finality proof, light-client or validator rules, state-root commitment, membership-proof algorithm, validator-set evolution, canonical encoding and hash functions. Verification under it MUST be deterministic and domain separated. This ERC does not constrain how an attested value is produced; a profile MAY.

A **settlement period** is the implementation-defined interval within which a change is expected to be admitted. This ERC does not prescribe its length.

### Projection invariants

These four rules are what make an instant resolve uniquely. An implementation that relaxes any of them does not conform.

1. The first entry MUST have version `1` and a zero `previousCommitment`, and MUST emit `RegisterInitialized`.
2. Each admitted change MUST append version `n + 1`, link the prior commitment, set the prior entry's `supersededAt`, leave the new entry's `supersededAt` zero, and emit `RegisterSuperseded`.
3. `effectiveAt` MUST be **strictly greater** than that of the preceding entry. Equal effective times are forbidden, because an instant shared by two entries would have two answers.
4. A record commitment MUST be unique within a token's own chain of entries. A repeated commitment is forbidden, because two entries that cannot be told apart cannot be resolved.

Entries MUST NOT be overwritten, deleted, reordered or skipped. Queries for a nonexistent token or version MUST revert.

`entryAsOf` MUST return the entry whose effective interval contains the queried instant, and MUST revert for an instant preceding the first entry. `holderAsOf` MUST return that entry's `holder`.

### Finality of a resolved instant

Invariant 3 makes finality decidable with one comparison. Every admitted entry has an `effectiveAt` strictly greater than the latest entry's, so no entry admitted in the future can ever cover an instant that already precedes the latest entry's effective time.

An instant is therefore final if and only if it is at or after the first entry's `effectiveAt` and strictly before the latest entry's `effectiveAt`. `isFinalAsOf` MUST return `true` exactly for those instants, MUST return `false` otherwise, and MUST NOT revert for an instant preceding the first entry.

An instant at or after the latest entry's `effectiveAt` still resolves, but provisionally: a later admission may carry an earlier effective time and supersede the answer. A consumer that requires a settled answer MUST check `isFinalAsOf`, because `entryAsOf` does not distinguish the two cases. An open projection gap indicates that such an admission is expected, but finality does not depend on whether a gap is open, and closing a gap does not by itself make any instant final.

### Register interface

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IRegisterProjection is IERC165 {
    struct RegisterEntry {
        bytes32 recordCommitment;
        bytes32 previousCommitment;
        bytes32 registryReference;
        address holder;
        uint64 version;
        uint64 effectiveAt;
        uint64 supersededAt;
    }

    event RegisterInitialized(
        uint256 indexed tokenId,
        bytes32 indexed recordCommitment,
        address indexed holder,
        uint64 version,
        uint64 effectiveAt
    );

    event RegisterSuperseded(
        uint256 indexed tokenId,
        uint64 indexed version,
        bytes32 indexed recordCommitment,
        bytes32 previousCommitment,
        address holder,
        uint64 effectiveAt
    );

    function currentEntry(uint256 tokenId)
        external view returns (RegisterEntry memory entry);

    function entryAt(uint256 tokenId, uint64 version)
        external view returns (RegisterEntry memory entry);

    function entryAsOf(uint256 tokenId, uint64 instant)
        external view returns (RegisterEntry memory entry);

    function holderAsOf(uint256 tokenId, uint64 instant)
        external view returns (address holder);

    function isFinalAsOf(uint256 tokenId, uint64 instant)
        external view returns (bool settled);

    function entryCount(uint256 tokenId)
        external view returns (uint64 count);

    function registerId() external view returns (bytes32 identifier);
}
```

The [ERC-165](./eip-165.md) identifier for `IRegisterProjection` is `0x6309e170`.

`registerId` MUST be a nonzero identifier of the remote register being projected and MUST NOT change. A party with no relationship to the registrar otherwise cannot tell what a projection is a projection of, which is the position every third-party venue is in. Resolving that identifier to a description of the register and its profile is left to the profile, since a document reference cannot be verified on chain and each deployment publishes one differently.

### Trading is not blocked

Ordinary ERC-721 transfers MUST NOT be blocked while a projection gap is open. The token continues to trade and `ownerOf` moves immediately.

An implementation MUST NOT infer the confirmed holder from `ownerOf`, and MUST NOT update the projection on an ordinary transfer. The projection changes only through proof-verified admission.

### Rights and the projection

A right determined by registration time MUST be resolved against the projection at the record instant its own terms specify, not against `ownerOf`.

This ERC does not decide what a right does with that answer. It establishes what can be known about the answer, and separates the three things a right's own terms need in order to decide for themselves:

- `holderAsOf` gives the confirmed holder at an instant.
- `isFinalAsOf` says whether a later admission can still change that answer.
- `openGapOf` and the gap's `openedAt` say whether the instant is contested.

Whether a right may be exercised at a non-final or contested instant, whether an exercise that cannot proceed is postponed or forfeited, who bears a forfeiture, and where a postponed claim is recorded, are decisions for the right's own terms. This ERC does not constrain them and supplies no registry of its own for them. What it removes is the excuse for deciding them blindly: the three facts above are available at the moment of exercise and remain checkable afterwards, so a contract that postpones a claim can bind its beneficiary to `holderAsOf` once `isFinalAsOf` is true, without this ERC prescribing how.

An entry admitted after an exercise has completed carries no authority over that exercise. This ERC defines when the register's answer changes; it does not give a later answer power to undo an act already performed under an earlier one.

In a settlement-conforming implementation an entry can be admitted only into an open gap, so the projection cannot change during a quiescent interval: every instant in it resolves to the same confirmed holder throughout and no instant in it is contested. Whoever is authorized to call `beginSettlement` can therefore make an interval quiescent by declining to open a gap in it. An implementation whose projection can advance by other means MUST suspend those means as well for the interval to be quiescent.

Cancelling a settlement ends the contest but settles nothing. The preceding entry remains in force, so the provisional answer reverts to the holder confirmed before the gap opened, but the instant does not thereby become final. A change the register already made, and this chain has not yet seen, can still be admitted afterwards.

### Settlement and proof-verified admission

`beginSettlement` MUST require an existing token, a nonzero unused `settlementId`, a nonzero snapshot, an authorized ERC-721 caller, and a future deadline whose distance from the current block timestamp MUST NOT exceed an implementation-defined maximum. It MUST emit `SettlementStarted`.

An `expectedHolder` equal to the current confirmed holder MUST be permitted. It admits a **confirming entry**: an entry asserting that the register still records the same holder at a later effective time. Confirming entries are how instants become final on a token whose holder is not changing, so a profile SHOULD provide a way to produce them. Without them, instants at or after the latest entry's effective time never become final, and anything that waits on finality at those instants waits indefinitely.

A token MAY have at most one open gap. Beginning a settlement while one is open MUST supersede the earlier one, emit `SettlementSuperseded`, and leave the projection unchanged. A profile MAY forbid supersession where its register cannot absorb it.

Any account MAY call `finalizeSettlement`. The implementation MUST NOT derive proof validity from `msg.sender`, from a relayer allowlist, or from any account's signature.

Before admission the verifier MUST establish that the proof belongs to the pinned remote register and accepted profile; that the proven state root has remote finality under that profile; that a membership proof connects the remote record to that root; that the remote record binds `block.chainid`, the token contract, `tokenId`, `settlementId`, the confirmed holder it asserts, the snapshot, the previous and next commitments, the next version and the effective time; that the remote height strictly exceeds the last height consumed for that token; and that the proof has not already been consumed.

On success the implementation MUST, in one transaction, consume the proof, record the new remote height, append the entry under the invariants above, close the gap, and emit `RegisterSuperseded` and `SettlementFinalized`. Any failure MUST revert every effect.

The recorded initiator MAY cancel an open gap using empty `proofData`, but only after the deadline has passed. Cancellation before the deadline MUST revert, so that a record already finalized remotely cannot be stranded by unilateral abandonment. Cancellation MUST NOT change the projection.

### Settlement interface

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IProjectionSettlement is IERC165 {
    enum GapStatus { NONE, OPEN, ADMITTED, CANCELLED, SUPERSEDED }

    struct Settlement {
        uint256 tokenId;
        address initiator;
        address expectedHolder;
        bytes32 snapshotHash;
        uint64 openedAt;
        uint64 deadline;
        GapStatus status;
    }

    event SettlementStarted(bytes32 indexed settlementId, uint256 indexed tokenId, address indexed initiator, address expectedHolder, bytes32 snapshotHash, uint64 deadline);
    event SettlementFinalized(bytes32 indexed settlementId, uint256 indexed tokenId, bytes32 indexed recordCommitment, uint64 version, uint64 effectiveAt);
    event SettlementCancelled(bytes32 indexed settlementId, uint256 indexed tokenId, bytes32 indexed reasonHash);
    event SettlementSuperseded(bytes32 indexed supersededId, bytes32 indexed replacementId, uint256 indexed tokenId);

    function settlement(bytes32 settlementId)
        external view returns (Settlement memory record);

    function openGapOf(uint256 tokenId)
        external view returns (bytes32 settlementId);

    function settlementPeriod()
        external view returns (uint64 maximumInterval);

    function verificationProfile()
        external view returns (bytes32 identifier);

    function beginSettlement(uint256 tokenId, bytes32 settlementId, address expectedHolder, bytes32 snapshotHash, uint64 deadline) external;

    function finalizeSettlement(bytes32 settlementId, bytes32 recordCommitment, bytes32 registryReference, uint64 effectiveAt, bytes calldata proofData) external;

    function cancelSettlement(bytes32 settlementId, bytes32 reasonHash, bytes calldata proofData) external;
}
```

The ERC-165 identifier for `IProjectionSettlement` is `0xfd0f6337`.

`settlement(unknownId)` MUST revert. `openGapOf` MUST return zero when no gap is open. `NONE` is the zero-value internal status and MUST NOT be returned by a successful query for an unknown identifier.

`verificationProfile` MUST return a nonzero identifier of the profile under which proofs are accepted and MUST NOT change, so that a party can tell whether it knows how to check what this contract accepts.

### Conformance levels

A contract has **projection conformance** if it implements `IRegisterProjection`, advertises `0x6309e170`, and satisfies the projection invariants and the finality rule.

A contract has **settlement conformance** if it has projection conformance, implements `IProjectionSettlement`, advertises `0xfd0f6337`, and satisfies every settlement and proof requirement here.

A contract MUST NOT advertise an identifier whose requirements it does not satisfy. A projection may be maintained by means other than the settlement interface, so the two are discovered separately.

## Rationale

The contribution is the projection, not the proof. Off-chain registration is asynchronous and no design removes that. What a register does provide is a unique identity per change, and this ERC turns that into a total order in which every past instant resolves to one confirmed holder. Strict monotonicity and commitment uniqueness are not tidiness rules; they are the minimum conditions for that property to hold, which is why they are stated as invariants rather than as guidance.

Two ownership notions are kept apart deliberately. `ownerOf` is the tradeable position and moves when the market moves. The confirmed holder moves only when the register is proven to have moved. Collapsing them forces a choice between freezing the market and lying about the record; keeping them apart makes the divergence explicit and, more importantly, resolvable.

Finality is stated separately from resolution because they are different questions and only one of them is answered by reading an entry. An instant always resolves; whether it can still change is what a distribution needs to know, and invariant 3 reduces that to a single comparison against the latest entry's effective time. Exposing it as `isFinalAsOf` rather than leaving each integrator to derive it prevents the common error of treating a provisional answer as settled, which is exactly the error the asynchronous register makes easy. Finality deliberately does not depend on whether a gap is open, because a gap is a statement about what is expected, not about what can still arrive.

Register and profile identifiers are exposed for the same reason the projection is exposed at all. The parties who need this are third parties with no relationship to the registrar; a projection they cannot attribute to a register, under a proof profile they cannot name, tells them very little.

What a right does at a non-final or contested instant is left to the right's own terms, and that restraint is deliberate. This ERC settles who may move the register's answer and what that answer is at any instant; it does not also settle what a dividend or a ballot should do about it. Those are decisions the issuer, the DAO or the entitlement's own contract are entitled to make differently from one another, and a standard that fixed them would be legislating past the point where interoperability requires agreement.

The following is guidance, not a requirement. Rights divide usefully by whether an exercise can be repeated. A distribution can be postponed at a cost of time alone, so finality is a natural condition for it: defer, and credit the party the register confirms for the instant, even if that party no longer holds the token. A vote cannot be repeated, so finality is the wrong condition for it — the present moment is at or after the latest entry's effective time and is therefore never final, and a design that waited for finality would forbid voting at almost every moment rather than occasionally. Contestedness is the condition that fits: it is bounded, visible before a ballot is scheduled into it, and avoidable. A right that declines to act while contested gives up an exercise it could not have attributed correctly; one that acts anyway should record the entry version it relied on, so the basis stays checkable if the register later disagrees.

A registered market does not face this, and the reason is worth stating because it does not carry over. There, the body that fixes the record is constituted outside the register: a board resolves to close the register, and its membership is known ahead of time and does not depend on what the register says about any holding. On-chain governance has no such body. The right to open a proposal and the right to vote both derive from holding, which is the very thing the projection exists to resolve, so there is no roll that can be consulted before the projection has answered. The only thing that can be checked is whether the power existed at the instant it was used, which is why this ERC exposes that instant's answer and whether it is settled, rather than attempting to fix an electorate in advance.

Governance can nonetheless reach the registered market's arrangement, and needs no mechanism from this ERC to do it. A decision not to begin settlements for a stated window makes that window quiescent, which is what closing a register accomplishes: the record is immobile across the decision, so the record instant is determined before anyone votes. The authority is constituted by a vote instead of by a board, but the effect on the projection is the same.

What that construction cannot do is protect the act that constitutes it. The vote establishing a closure is itself held with no closure in force, and so is the vote that would establish *that* one. The regress has no bottom, so some exercise must always be evaluated against the projection as it stands, under the contested rule. That rule is therefore not a fallback for registers too unsophisticated to close their books; it is the floor that any arrangement built on this projection ultimately rests on.

Traditional infrastructure does not need this rule, because it compensates for the lag instead of recording it. Where settlement takes a fixed number of days, a market can mark trades from an ex-entitlement date onward as not carrying the entitlement, so that the register at the record date matches the intended attribution. That arithmetic exists only because the question that can actually be asked is *who is on the register at the record date*, never *who was on the register at instant t* for a trade still in flight. This ERC answers the second question directly, so no ex-entitlement arithmetic is required: a party who buys after a record instant is simply not the confirmed holder at it.

An entry that confirms the same holder is permitted rather than rejected as a no-op, because under these rules it is not one. A register that says nothing produces no entries, and a token whose holder never changes would then have no instant that ever becomes final, which would leave anything waiting on finality there waiting forever. A confirming entry is the register saying *still this holder, as of here*, and that statement is what closes the interval.

Proof submitters are untrusted so that admission depends on the remote consensus rather than on a privileged reporter. Verification and admission are atomic so that no interval exists in which a proof has been accepted but the projection has not advanced.

This does not replace an oracle, and the distinction is worth being exact about. A register that is not itself a ledger with consensus needs some party to commit to its contents on its behalf, and the proof path verifies that party's committed statements, not the world behind them. Some data is unsuited to the chain in the first place — confidential, personal, or simply not the registrar's to publish — which is why entries carry a commitment and a reference and never the record. What changes is not who is trusted but what that trust permits. Statements enter one append-only order per token, two cannot share an effective instant, none can be reused, and any past instant can be re-examined long afterwards. A source that contradicts itself leaves the contradiction on the record rather than overwriting it, and a third party with no relationship to the registrar can see that it did.

This ERC therefore constrains verification and leaves attestation to the profile. An attesting party may be a light client, a quorum of signers, a registrar's own key, or a fixed procedure run over the register, and the profile names which; what this ERC requires is that checking a commitment be deterministic, not that arriving at the value was.

A profile is free to require more of its attesters, and the useful thing to require is that the procedure itself be deterministic and pinned. An attestation then stands as a claim that a named procedure over named inputs yields a named output, which anyone holding those inputs can re-execute; a discrepancy becomes evidence rather than an accusation. A human attester cannot offer that, whatever controls surround the act, because a reading cannot be re-run. Dual authorization lowers the chance of an incorrect assertion; it does not make the assertion reproducible, and the two are different properties.

Determinism also makes a quorum say something precise. Where a profile uses one, attesters that read the register differently commit to different roots, their signatures do not aggregate, and no entry is admitted. If each attester runs the same pinned procedure, disagreement can only mean their inputs diverged — an unambiguous signal, rather than variation between readers. The gap stays open and the instant stays contested, which is the correct outcome when the register's own readers do not agree.

### Prior art

[ERC-7965](./eip-7965.md) is the closest work on the proof side. It standardizes proof-based verification of source-chain messages inside [ERC-7786](./eip-7786.md) gateways. Its broadcast semantics require one proof to serve many recipients, so it deliberately does not bind a proof to a destination field set, and it does not constrain the relationship between verification and execution. It proves a message; it does not build an ordered register whose past instants resolve. [ERC-5164](./eip-5164.md) and [ERC-6358](./eip-6358.md) likewise address execution and multi-chain token state rather than register history.

This is not a bridge. ICS-721 and similar designs escrow, burn or mint a representation so that a token moves between chains. Here the token never leaves its chain and nothing is minted; a proof admits a record.

[ERC-6997](./eip-6997.md) adds a validation stage to transfers, and holds cleared by a notary are long-established. All of them gate a transfer on an authorized party's word, and none maintains a time-resolvable record of who was confirmed when.

[ERC-7765](./eip-7765.md) and [ERC-5496](./eip-5496.md) express whether a right may be exercised and allow rights to be separated from ownership. Neither ties the availability of an exercise to the state of an external register, nor lets a contract ask who was confirmed at a past instant and whether that answer is settled. [ERC-7943](./eip-7943.md) supplies transfer eligibility and freezing controls that compose with this ERC; [ERC-8325](./eip-8325.md) supplies asset anchoring that an implementation MAY use.

Off-chain credential and attestation systems can express issuance and revocation, but do not make a past instant resolve to one holder under an on-chain invariant.

## Backwards Compatibility

This ERC is additive to ERC-721 and discoverable through ERC-165. It does not alter transfer semantics, and existing marketplaces and wallets continue to work unchanged; they simply do not read the projection. A contract that cannot enforce the projection invariants across every path that writes entries MUST NOT claim conformance.

## Test Cases

Conforming implementations MUST satisfy at least the following.

1. Interface identifiers are `0x6309e170` for `IRegisterProjection` and `0xfd0f6337` for `IProjectionSettlement`.
2. An entry whose `effectiveAt` equals the preceding entry's is rejected.
3. A repeated record commitment within a token is rejected.
4. `entryAsOf` returns the covering entry for instants inside, at the start of, and after each interval, and reverts before the first entry.
5. `holderAsOf` agrees with `entryAsOf` for the same instant.
6. Ordinary transfers succeed while a gap is open, and do not change the projection.
7. Beginning a settlement while a gap is open supersedes it and leaves the projection unchanged.
8. Admission is rejected after independent mutation of every bound field, for an incorrect register identity, for remote state not final under the profile, for a non-member record, for a stale height and for a replayed proof.
9. A successful admission appends the entry and closes the gap atomically; a failure changes nothing.
10. Cancellation before the deadline is rejected; after the deadline it succeeds and leaves the projection unchanged.
11. A proof finalized within the deadline succeeds after a rejected cancellation attempt.
12. `isFinalAsOf` is false at and after the latest entry's `effectiveAt`, true for earlier instants covered by an entry, false before the first entry, and does not revert.
13. An instant that is final does not change its confirmed holder after any further admission.
14. A confirming entry naming the current confirmed holder is admitted and makes the preceding instants final.
15. `registerId` and `verificationProfile` are nonzero and unchanged across admissions.
16. A contested instant and a merely non-final instant are distinguishable: while a gap is open, `openGapOf` identifies it and its `openedAt` bounds the contested interval; once the gap closes by admission or cancellation, no instant is contested even though instants at or after the latest entry remain non-final.
17. No entry can be admitted while no gap is open, so a quiescent interval cannot be interrupted: an otherwise valid proof is rejected when its settlement is absent, already admitted, cancelled or superseded.

## Reference Implementation

A CC0 Solidity reference implementation and self-contained local-EVM tests accompany this draft under `assets/eip-xxxx/`, where `xxxx` MUST be replaced only after an editor assigns a number.

## Security Considerations

This ERC removes trust in the proof submitter, not all trust. Security depends on the remote consensus, the light client or validator quorum, validator-set update rules, cryptography, canonical encoding, the verifier implementation and any upgrade authority. A colluding remote consensus can finalize a false record and a faulty verifier can accept an invalid proof.

A proof establishes that bytes were included in accepted finalized remote state. It does not establish that an asset exists, that a registrar told the truth, or that a record is legally effective. Where the remote register is not itself a ledger with consensus, some party commits to its contents on its behalf. That party is an oracle in the ordinary sense, its honesty is assumed rather than proven, and identifying it is part of the verification profile a consumer must accept before relying on the projection.

Profiles MUST address validator equivocation, quorum uniqueness, signature malleability, replay, remote forks, validator-set rotation, proof-size and gas denial of service, hash collisions, integer bounds, malformed encodings and verifier upgrades. Fixed validator sets are suitable only where their lifecycle and recovery assumptions are acceptable.

The deadline bounds how long a gap may stay open; an unbounded gap would make the projection permanently unresolvable for that interval, so the maximum interval MUST be enforced. Cancellation after the deadline preserves a bounded recovery path, while the interval before it belongs to the proof.

Because trading is not blocked, integrators MUST NOT treat `ownerOf` as the confirmed holder. An integrator that needs the confirmed record MUST read the projection, one that needs to know whether a change is expected MUST check `openGapOf`, and one that needs a settled answer MUST check `isFinalAsOf`. Treating a provisional answer as final is the most likely integration error here, because `entryAsOf` returns an answer either way.

Finality depends on a later entry existing, so a register that stops producing entries leaves recent instants permanently non-final, and anything a consumer holds back until they settle permanently unsettled. This is a liveness dependency on the register and its profile, not a safety defect, but a profile that offers no way to admit a confirming entry inherits it. Conversely, an authority that can produce entries at will can make instants final at will, so the ability to begin settlements is itself a privilege and MUST be scoped accordingly.

Entries, commitments, participants, instants and proof material are public. Commitments may leak information through low-entropy inputs or correlation. Profiles SHOULD use domain-separated commitments, avoid confidential plaintext, and publish only proof material necessary for verification. Deleting off-chain data does not delete commitments, logs, calldata or historical chain state.

## Copyright

Copyright and related rights waived via [CC0](../LICENSE.md).
