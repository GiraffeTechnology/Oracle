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

The token continues to trade throughout. `ownerOf` is the tradeable position; the projection is the confirmed record. Entitlements resolve against the projection, so a holder change that the register has not yet confirmed cannot silently redirect a right.

A change is admitted to the projection only on proof that the corresponding record exists in a finalized state of the remote register. Proof submitters are untrusted.

## Motivation

Applications that mirror an off-chain register on chain face a gap they cannot close. Registration completes when the registrar completes it. Meanwhile the token trades.

Existing approaches take one of two unsatisfactory paths. They trust an oracle to assert that registration finished, in which case the contract proves only what the oracle said. Or they freeze the token until registration finishes, which stops a market to solve a bookkeeping problem and destroys any entitlement whose record instant falls inside the freeze.

Neither is necessary. The register's own change identity is enough. If every admitted change carries a strictly later effective time and a commitment unique to that token, the on-chain history is a total order, and a question of the form *who did the register record at this instant* has exactly one answer for every instant in the past.

That single property is what third parties need and cannot get today. A marketplace, a wallet, an indexer or a collateral system has no relationship with the registrar, yet must know whether the current holder is confirmed or merely provisional. A governance or distribution contract must know who was confirmed at a record instant that may have passed while the register was still catching up. `ownerOf` cannot answer either question, and an issuer that locks its own token cannot tell an unrelated venue why.

Illustrative uses include a title registry that reissues a record after a transfer, a licensing ledger that records a replacement permit, and a custodian ledger that supersedes a holding record. These describe technical coordination only; they do not make the token, the proof or the remote record legally effective.

## Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119 and RFC 8174.

### Definitions

A **remote register** is the external ledger that records holders of the represented asset. Its updates are asynchronous with respect to this chain.

A **register entry** is one admitted change, identified by its effective time and its record commitment.

A **record commitment** is a nonzero `bytes32` commitment to the register's content at that entry. An implementation profile MUST define its algorithm, canonicalization and domain separation.

A **confirmed holder** at an instant is the `holder` of the entry whose effective interval contains that instant. It is distinct from `ownerOf`, which is the tradeable position.

A **projection gap** is an interval in which a change is known to be in progress and not yet admitted. A pending settlement marks such a gap.

A **verification profile** defines the remote-finality proof, light-client or validator rules, state-root commitment, membership-proof algorithm, validator-set evolution, canonical encoding and hash functions. It MUST be deterministic and domain separated.

A **settlement period** is the implementation-defined interval within which a change is expected to be admitted. This ERC does not prescribe its length.

### Projection invariants

These four rules are what make an instant resolve uniquely. An implementation that relaxes any of them does not conform.

1. The first entry MUST have version `1` and a zero `previousCommitment`, and MUST emit `RegisterInitialized`.
2. Each admitted change MUST append version `n + 1`, link the prior commitment, set the prior entry's `supersededAt`, leave the new entry's `supersededAt` zero, and emit `RegisterSuperseded`.
3. `effectiveAt` MUST be **strictly greater** than that of the preceding entry. Equal effective times are forbidden, because an instant shared by two entries would have two answers.
4. A record commitment MUST be unique within a token's own chain of entries. A repeated commitment is forbidden, because two entries that cannot be told apart cannot be resolved.

Entries MUST NOT be overwritten, deleted, reordered or skipped. Queries for a nonexistent token or version MUST revert.

`entryAsOf` MUST return the entry whose effective interval contains the queried instant, and MUST revert for an instant preceding the first entry. `holderAsOf` MUST return that entry's `holder`.

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

    function entryCount(uint256 tokenId)
        external view returns (uint64 count);
}
```

The [ERC-165](./eip-165.md) identifier for `IRegisterProjection` is `0x3e925bdc`.

### Trading is not blocked

Ordinary ERC-721 transfers MUST NOT be blocked while a projection gap is open. The token continues to trade and `ownerOf` moves immediately.

An implementation MUST NOT infer the confirmed holder from `ownerOf`, and MUST NOT update the projection on an ordinary transfer. The projection changes only through proof-verified admission.

### Entitlements during a projection gap

An entitlement determined by registration time MUST be resolved against the projection at the record instant its own terms specify, not against `ownerOf`. This ERC does not decide how any entitlement determines its holder; it guarantees only that the question is answerable.

When a record instant falls inside a projection gap, the confirmed holder for that instant is not yet known. Two cases follow, and they differ:

**An exercise that cannot be performed later with equivalent effect**, such as voting in a ballot that closes, MUST be treated as unavailable to both the outgoing and the incoming party for that instant. When the rightful party cannot be determined, allowing either to act may be wrong, and abstention is the only outcome that cannot be wrong. Such an exercise is extinguished permanently. Later resolution of the projection settles attribution; it MUST NOT revive an exercise opportunity that has passed.

**An exercise that can be performed later with equivalent effect**, such as a distribution, MUST NOT be treated as extinguished. It is deferred. Once the projection admits the entry covering that instant, the entitlement is claimable by the confirmed holder for that instant, and MUST be credited to that party even if it no longer holds the token.

A deferred entitlement MUST be recorded against the token, the entitlement identifier and the record instant, and MUST NOT bind a beneficiary address at the time it is deferred, because that address is not yet determinable. It binds when the projection resolves.

If a gap closes by cancellation rather than admission, the preceding entry remains in force, so entitlements inside the gap resolve to the holder confirmed before it opened.

### Settlement and proof-verified admission

`beginSettlement` MUST require an existing token, a nonzero unused `settlementId`, a nonzero snapshot, an authorized ERC-721 caller, a recipient different from the current confirmed holder, and a future deadline whose distance from the current block timestamp MUST NOT exceed an implementation-defined maximum. It MUST emit `SettlementStarted`.

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

    function beginSettlement(uint256 tokenId, bytes32 settlementId, address expectedHolder, bytes32 snapshotHash, uint64 deadline) external;

    function finalizeSettlement(bytes32 settlementId, bytes32 recordCommitment, bytes32 registryReference, uint64 effectiveAt, bytes calldata proofData) external;

    function cancelSettlement(bytes32 settlementId, bytes32 reasonHash, bytes calldata proofData) external;
}
```

The ERC-165 identifier for `IProjectionSettlement` is `0xbe360d3d`.

`settlement(unknownId)` MUST revert. `openGapOf` MUST return zero when no gap is open. `NONE` is the zero-value internal status and MUST NOT be returned by a successful query for an unknown identifier.

### Conformance levels

A contract has **projection conformance** if it implements `IRegisterProjection`, advertises `0x3e925bdc`, and satisfies the projection invariants and the entitlement rules. It MUST NOT advertise `0xbe360d3d` unless it also implements proof-verified admission.

A contract has **settlement conformance** if it has projection conformance, implements `IProjectionSettlement`, advertises both identifiers, and satisfies every settlement and proof requirement here.

A projection may be maintained by means other than the settlement interface, provided the invariants hold. Interface discovery therefore reports which is offered.

## Rationale

The contribution is the projection, not the proof. Off-chain registration is asynchronous and no design removes that. What a register does provide is a unique identity per change, and this ERC turns that into a total order in which every past instant resolves to one confirmed holder. Strict monotonicity and commitment uniqueness are not tidiness rules; they are the minimum conditions for that property to hold, which is why they are stated as invariants rather than as guidance.

Two ownership notions are kept apart deliberately. `ownerOf` is the tradeable position and moves when the market moves. The confirmed holder moves only when the register is proven to have moved. Collapsing them forces a choice between freezing the market and lying about the record; keeping them apart makes the divergence explicit and, more importantly, resolvable.

Entitlement rules follow from the projection rather than being added to it. Because any instant resolves, a distribution can be deferred and later credited to the party the register confirms for that instant, which is also why buying inside a gap cannot capture distributions that fall in it. A vote is different in kind: reopening a closed ballot to admit a later-confirmed party would change a decided outcome, so the exercise is extinguished. That loss is foreseeable, since the settlement period is bounded and record instants are published in advance, so the parties can decline to incur it. Traditional infrastructure reaches the same result by centralising the arithmetic in an ex-date; here the state is exposed and the parties do it themselves.

Proof submitters are untrusted so that admission depends on the remote consensus rather than on a privileged reporter. Verification and admission are atomic so that no interval exists in which a proof has been accepted but the projection has not advanced.

### Prior art

[ERC-7965](./eip-7965.md) is the closest work on the proof side. It standardizes proof-based verification of source-chain messages inside [ERC-7786](./eip-7786.md) gateways. Its broadcast semantics require one proof to serve many recipients, so it deliberately does not bind a proof to a destination field set, and it does not constrain the relationship between verification and execution. It proves a message; it does not build an ordered register whose past instants resolve. [ERC-5164](./eip-5164.md) and [ERC-6358](./eip-6358.md) likewise address execution and multi-chain token state rather than register history.

This is not a bridge. ICS-721 and similar designs escrow, burn or mint a representation so that a token moves between chains. Here the token never leaves its chain and nothing is minted; a proof admits a record.

[ERC-6997](./eip-6997.md) adds a validation stage to transfers, and holds cleared by a notary are long-established. All of them gate a transfer on an authorized party's word, and none maintains a time-resolvable record of who was confirmed when.

[ERC-7765](./eip-7765.md) and [ERC-5496](./eip-5496.md) express whether a right may be exercised and allow rights to be separated from ownership. Neither ties the availability of an exercise to the state of an external register, nor defines deferral and later attribution when a record instant falls in a gap. [ERC-7943](./eip-7943.md) supplies transfer eligibility and freezing controls that compose with this ERC; [ERC-8325](./eip-8325.md) supplies asset anchoring that an implementation MAY use.

Off-chain credential and attestation systems can express issuance and revocation, but do not make a past instant resolve to one holder under an on-chain invariant.

## Backwards Compatibility

This ERC is additive to ERC-721 and discoverable through ERC-165. It does not alter transfer semantics, and existing marketplaces and wallets continue to work unchanged; they simply do not read the projection. A contract that cannot enforce the projection invariants across every path that writes entries MUST NOT claim conformance.

## Test Cases

Conforming implementations MUST satisfy at least the following.

1. `IRegisterProjection` interface identifier is `0x3e925bdc` and `IProjectionSettlement` is `0xbe360d3d`.
2. An entry whose `effectiveAt` equals the preceding entry's is rejected.
3. A repeated record commitment within a token is rejected.
4. `entryAsOf` returns the covering entry for instants inside, at the start of, and after each interval, and reverts before the first entry.
5. `holderAsOf` agrees with `entryAsOf` for the same instant.
6. Ordinary transfers succeed while a gap is open, and do not change the projection.
7. Beginning a settlement while a gap is open supersedes it and leaves the projection unchanged.
8. Admission is rejected after independent mutation of every bound field, for an incorrect register identity, for a non-final state, for a non-member record, for a stale height and for a replayed proof.
9. A successful admission appends the entry and closes the gap atomically; a failure changes nothing.
10. Cancellation before the deadline is rejected; after the deadline it succeeds and leaves the projection unchanged.
11. A proof finalized within the deadline succeeds after a rejected cancellation attempt.

## Reference Implementation

A CC0 Solidity reference implementation and self-contained local-EVM tests accompany this draft under `assets/eip-xxxx/`, where `xxxx` MUST be replaced only after an editor assigns a number.

## Security Considerations

This ERC removes trust in the proof submitter, not all trust. Security depends on the remote consensus, the light client or validator quorum, validator-set update rules, cryptography, canonical encoding, the verifier implementation and any upgrade authority. A colluding remote consensus can finalize a false record and a faulty verifier can accept an invalid proof.

A proof establishes that bytes were included in accepted finalized remote state. It does not establish that an asset exists, that a registrar told the truth, or that a record is legally effective.

Profiles MUST address validator equivocation, quorum uniqueness, signature malleability, replay, remote forks, validator-set rotation, proof-size and gas denial of service, hash collisions, integer bounds, malformed encodings and verifier upgrades. Fixed validator sets are suitable only where their lifecycle and recovery assumptions are acceptable.

The deadline bounds how long a gap may stay open; an unbounded gap would make the projection permanently unresolvable for that interval, so the maximum interval MUST be enforced. Cancellation after the deadline preserves a bounded recovery path, while the interval before it belongs to the proof.

Because trading is not blocked, integrators MUST NOT treat `ownerOf` as the confirmed holder. An integrator that needs the confirmed record MUST read the projection, and one that needs to know whether the current position is confirmed MUST check `openGapOf`.

Entries, commitments, participants, instants and proof material are public. Commitments may leak information through low-entropy inputs or correlation. Profiles SHOULD use domain-separated commitments, avoid confidential plaintext, and publish only proof material necessary for verification. Deleting off-chain data does not delete commitments, logs, calldata or historical chain state.

## Copyright

Copyright and related rights waived via [CC0](../LICENSE.md).
