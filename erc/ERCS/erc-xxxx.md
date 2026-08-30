---
eip: XXXX
title: Proof-Verified Deferred Asset Settlement
description: Atomically settles ERC-721 transfers from finalized remote-ledger state proofs
author: Michael Yip (@GiraffeTechnology)
discussions-to: https://ethereum-magicians.org/t/REPLACE_WITH_DISCUSSION_SLUG
status: Draft
type: Standards Track
category: ERC
created: 2026-08-24
requires: 165, 721
---

## Abstract

This ERC defines discoverable interfaces for an [ERC-721](./eip-721.md) token to enter a pending transfer and to finalize only when a verifier proves that a finalized state of another ledger contains the exact corresponding asset-settlement record. The record is bound to the local chain, token contract, token identifier, settlement identifier, participants, initiation snapshot, prior and next commitments, version, effective time, and asset anchor. Verification and the local holder transition occur in one transaction or revert together.

Proof submitters are untrusted. No oracle account is authorized to substitute settlement facts. The proposal does not prove that a remote record is factually or legally correct; it proves inclusion in the finalized state accepted under a declared remote-ledger verification profile.

## Motivation

Applications that map a public-chain token to a permissioned or consortium ledger often rely on an oracle to report that the remote update completed. Even if the oracle signs every local field, the contract proves only what that oracle asserted. A compromised or privileged oracle can therefore substitute a remote result without demonstrating that the result exists in the finalized remote state.

General cross-chain proof systems verify remote state, while deferred-token standards coordinate delayed execution. This ERC standardizes the narrower combined invariant for ERC-721: a pending transfer can finalize only from a finalized remote-state membership proof whose leaf commits to the exact local settlement, and the proof acceptance, commitment update, holder transfer, and settlement closure are atomic.

Illustrative uses include a title registry that reissues a title record after a token transfer, a licensing ledger that records a replacement permit for the transferee, and a custodian ledger that supersedes a warehouse record when the represented holding changes hands. These examples describe technical coordination only; they do not make the token, proof, or remote record legally effective.

Certificate history remains useful evidence metadata but is not the principal contribution. One-to-one asset mapping is an implementation choice rather than the novelty claim.

## Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119 and RFC 8174.

### Definitions

A **remote ledger** is the consortium, permissioned, or other ledger whose identity and finalized state are verified by an implementation profile.

A **remote-ledger identity** is an immutable or governance-pinned identifier that distinguishes the intended ledger, including any genesis or consensus domain required by the verification profile.

A **verification profile** defines the remote finality proof, validator or light-client rules, state-root commitment, membership-proof algorithm, validator-set evolution, canonical encoding, hash functions, and security assumptions. It MUST be deterministic and domain separated.

A **proof submitter** is any account that relays proof bytes. Its identity MUST NOT confer proof validity.

A **settlement snapshot** is a nonzero commitment captured at initiation. The implementation profile MUST define its preimage, canonicalization, and domain separation.

A **remote settlement record** is the canonically encoded remote state value that binds the exact local settlement fields listed under Proof-verified finalization.

A **certificate commitment** is a nonzero `bytes32` commitment to an external record. The ABI name `certificateHash` does not prescribe a hash algorithm. Its profile MUST define canonicalization and domain separation.

An **authority reference** is a non-sensitive `bytes32` evidence or record reference. Despite the retained ABI name, it does not authorize finalization.

A **certificate authority** is nonzero metadata returned by `certificateAuthority(tokenId)`. It MAY identify an issuer and MAY equal the holder. It MUST NOT be accepted as a substitute for the remote-state proof required by this ERC.

A **settlement deadline** is the last local timestamp at which finalization may succeed. The remote process may complete at T+n; this ERC does not prescribe n.

### Certificate history

The initial version MUST be `1`, its `previousCertificateHash` MUST be zero, and its creation MUST emit `CertificateInitialized`. Each supersession MUST append exactly version `n + 1`, link the prior commitment, set the prior record's `supersededAt`, leave the new record's `supersededAt` zero, and emit `CertificateSuperseded`. Historical records MUST NOT be overwritten, deleted, reordered, skipped, or made cyclic.

`effectiveAt` is the remote record's declared effective time and need not equal `block.timestamp`. It MUST NOT decrease across versions. Queries for nonexistent tokens or versions MUST revert.

`certificateAuthority(tokenId)` MUST return a nonzero address for an existing conforming token. This address is informational under the settlement protocol; consumers decide out of band whether and how to trust it.

### Certificate interface

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IVersionedCertificate is IERC165 {
    struct CertificateRecord {
        bytes32 certificateHash;
        bytes32 previousCertificateHash;
        bytes32 authorityReference;
        uint64 version;
        uint64 effectiveAt;
        uint64 supersededAt;
    }

    event CertificateInitialized(
        uint256 indexed tokenId,
        bytes32 indexed certificateHash,
        bytes32 indexed authorityReference,
        uint64 version,
        uint64 effectiveAt
    );

    event CertificateSuperseded(
        uint256 indexed tokenId,
        uint64 indexed version,
        bytes32 indexed certificateHash,
        bytes32 previousCertificateHash,
        bytes32 authorityReference,
        uint64 effectiveAt
    );

    function currentCertificate(uint256 tokenId)
        external view returns (CertificateRecord memory record);
    function certificateAt(uint256 tokenId, uint64 version)
        external view returns (CertificateRecord memory record);
    function certificateAuthority(uint256 tokenId)
        external view returns (address authority);
}
```

The [ERC-165](./eip-165.md) interface identifier is `0xebaa86a0`.

### Conformance levels

A **certificate-conforming** contract MUST implement `IVersionedCertificate`, MUST advertise `0xebaa86a0` through ERC-165, and MUST satisfy the certificate-history requirements. It MUST NOT advertise `0x2773d4c9` unless it also implements the settlement interface and its proof-verified behavior.

A **settlement-conforming** contract MUST be certificate-conforming, MUST implement `IDeferredCertificateSettlement`, MUST advertise both interface identifiers, and MUST satisfy all settlement, proof-profile, cancellation, and atomicity requirements in this ERC. Interface discovery therefore identifies the supported conformance level without forcing certificate-only deployments to implement deferred settlement.

### Settlement initiation and transfer lock

`beginSettlement` MUST require an existing token, a nonzero unused `settlementId`, a nonzero snapshot, an authorized ERC-721 caller, a recipient different from the current holder, a future deadline, and no pending settlement for the token. It MUST record the current holder as `from`, clear token approval, set status to `PENDING`, and emit `SettlementStarted`.

While pending, `transferFrom` and both `safeTransferFrom` overloads MUST revert. Approval changes MUST NOT bypass this lock.

### Proof-verified finalization

Any account MAY call `finalizeSettlement`. The implementation MUST NOT assign proof validity from `msg.sender`, a relayer allowlist, or a certificate-authority signature.

Before finalization, the verifier MUST establish all of the following:

1. the proof belongs to the pinned remote-ledger identity and accepted verification profile;
2. the proven state root has remote consensus finality under that profile;
3. a valid membership proof connects the remote settlement record to that state root;
4. the remote record binds the local `block.chainid`, token contract, `tokenId`, `settlementId`, `from`, `to`, `snapshotHash`, previous commitment, new commitment, authority reference, next version, `effectiveAt`, and asset anchor;
5. the remote height is strictly greater than the last height consumed for that token; and
6. the proof or equivalent finalized record has not already been consumed.

The implementation MUST recheck any required local asset-anchor binding and active state at finalization. It MUST reject an expired settlement, a malformed proof, a proof from another ledger or validator set, a non-final state, a non-member record, a mismatched field, insufficient or duplicate finality attestations, and stale or replayed proof material.

On success, the implementation MUST in one transaction consume the proof, record the new remote height, append the next commitment, transfer the ERC-721 token from `from` to `to`, set status to `FINALIZED`, clear the pending identifier, and emit `CertificateSuperseded`, `Transfer`, and `SettlementFinalized`. Any failure MUST revert all effects.

Implementations MAY delegate verification to a separate light-client or verifier contract. That verifier and its upgrade or validator-set rules are part of the security boundary and MUST be disclosed by the profile.

### Proof encoding profile

The core interface treats `proofData` as opaque. Each implementation profile MUST publish a canonical schema. The CC0 reference profile uses:

Its domain-separated checkpoint and leaf type names are `RemoteFinality` and `RemoteSettlement`.

```solidity
abi.encode(
    uint64 remoteHeight,
    bytes32 remoteBlockHash,
    bytes32 remoteStateRoot,
    uint256 leafIndex,
    bytes32[] merkleSiblings,
    bytes[] finalitySignatures
)
```

The reference profile pins an immutable remote-ledger identifier and sorted validator set. A quorum signs a domain-separated checkpoint containing the ledger identity, remote height, remote block hash, remote state root, and validator-set hash. The Merkle leaf is the domain-separated remote settlement record. This profile demonstrates the invariant; production profiles SHOULD use the remote ledger's native light-client and validator-set transition rules where available.

### Cancellation

The recorded `from` address MAY cancel a pending settlement using empty `proofData`. Cancellation MUST NOT change holder or certificate state. Nonempty cancellation data and cancellation by other accounts MUST revert. Profiles MAY impose an additional delay, but MUST define a bounded recovery path that does not depend on the unavailable remote proof.

### Settlement interface

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IDeferredCertificateSettlement is IERC165 {
    enum SettlementStatus { NONE, PENDING, FINALIZED, CANCELLED }

    struct SettlementRecord {
        uint256 tokenId;
        address from;
        address to;
        bytes32 snapshotHash;
        uint64 initiatedAt;
        uint64 deadline;
        SettlementStatus status;
    }

    event SettlementStarted(bytes32 indexed settlementId, uint256 indexed tokenId, address indexed from, address to, bytes32 snapshotHash, uint64 deadline);
    event SettlementFinalized(bytes32 indexed settlementId, uint256 indexed tokenId, bytes32 indexed certificateHash, uint64 certificateVersion, uint64 effectiveAt);
    event SettlementCancelled(bytes32 indexed settlementId, uint256 indexed tokenId, bytes32 indexed reasonHash);

    function settlement(bytes32 settlementId)
        external view returns (SettlementRecord memory record);
    function pendingSettlementOf(uint256 tokenId)
        external view returns (bytes32 settlementId);
    function beginSettlement(uint256 tokenId, bytes32 settlementId, address to, bytes32 snapshotHash, uint64 deadline) external;
    function finalizeSettlement(bytes32 settlementId, bytes32 newCertificateHash, bytes32 authorityReference, uint64 effectiveAt, bytes calldata proofData) external;
    function cancelSettlement(bytes32 settlementId, bytes32 reasonHash, bytes calldata proofData) external;
}
```

The ERC-165 interface identifier is `0x2773d4c9`. Renaming the final bytes parameter from `authorityData` to `proofData` does not change the ABI selector.

### State queries

`settlement(unknownSettlementId)` MUST revert. `pendingSettlementOf` MUST return zero when no settlement is pending. `NONE` is the zero-value internal status and MUST NOT be returned by a successful `settlement` query for an unknown identifier.

## Rationale

The proof binds both ledgers through the remote leaf rather than trusting a bridge message or oracle assertion. Binding every mutable field prevents a valid checkpoint from being replayed for another chain, contract, token, recipient, snapshot, version, or commitment. Strictly increasing per-token remote height prevents rollback to an older finalized record. Atomic local execution removes the interval in which proof acceptance and token transfer could diverge.

The existing settlement selectors are retained to ease migration from the earlier working draft. The final bytes argument becomes an opaque proof container. Certificate history remains because it supplies a stable commitment transition for the remote record, but implementations may treat the external record generically.

`certificateAuthority` remains in the mandatory certificate interface as discoverable metadata, not as an authorization input. A certificate-conforming implementation that never performs settlement still needs a stable accessor for the issuer or record keeper that a consumer evaluates out of band, and removing the function would change the frozen `0xebaa86a0` identifier without removing that need. Finalization ignores the returned address; no proof is accepted because of it.

### Prior art

[ERC-2018](./eip-2018.md) defines delayed clearing controlled by a clearing agent. [ERC-6997](./eip-6997.md) defines a validation stage for ERC-721 transfers. Neither requires finalized remote-state membership or binds such proof to the complete local settlement.

[ERC-6358](./eip-6358.md) synchronizes global token operations across chains through signed omniverse transactions and delayed execution. This proposal does not create a multi-chain global token; it consumes proof of a particular remote asset record to gate one local ERC-721 settlement.

[ERC-5164](./eip-5164.md) and [ERC-7786](./eip-7786.md) standardize cross-chain execution and message passing. A message delivered through such a gateway is authorized by the gateway and its own trust assumptions, and its acceptance is a transaction separate from any local effect. This proposal does not consume an endorsed message. It verifies a membership proof against finalized remote state and requires that verification, certificate supersession, and the ERC-721 holder transition succeed or revert together in one transaction. A profile MAY transport proof material through such a gateway, but a messaging layer does not supply this settlement invariant.

[ERC-6956](./eip-6956.md) binds NFTs to physical assets and uses oracle attestations for proof of control. This proposal neither defines physical proof of control nor authorizes an oracle; the remote finalized state and membership proof are verified on chain.

[ERC-8320](./eip-8320.md), [ERC-8325](./eip-8325.md), and [ERC-8326](./eip-8326.md) define claims, asset anchors, and document-bundle commitments. They can supply fields or anchors referenced by a remote record but do not define proof-gated atomic ERC-721 settlement.

IBC light clients and membership proofs, and Hyperledger Cacti/Weaver interoperability, establish general remote-state verification patterns. This ERC does not claim those primitives. Its contribution is the ERC-721 settlement interface and the mandatory full-field binding and atomicity invariant applied to a deferred holder change.

W3C Verifiable Credentials and attestation registries such as Ethereum Attestation Service can express issuer statements and revocation state. By themselves, those systems do not require a finalized remote-ledger membership proof to be bound to every field of a pending ERC-721 settlement, nor do they require certificate supersession and the ERC-721 holder transition to execute atomically. They can provide evidence referenced by a profile without replacing this ERC's settlement invariant.

## Backwards Compatibility

This ERC is additive to ERC-721 and discoverable through ERC-165. Implementations of the earlier oracle-authorized working draft have the same settlement selectors but are not behaviorally conforming: an authority signature is not a remote-state proof. Integrators MUST check the declared profile and verifier configuration rather than infer V8 conformance from selectors alone.

Contracts that receive the token during finalization are not called through `onERC721Received`; implementations and initiators MUST account for non-receiver or operationally inaccessible contract recipients before initiation.

## Test Cases

Conforming implementations SHOULD test successful proof submission by an untrusted relayer and rejection after independent mutation of every bound field. Tests MUST cover incorrect ledger identity or validator set, non-final or insufficiently attested checkpoints, malformed signatures, duplicate validators, invalid membership paths, stale heights, proof replay, deadline expiry, inactive anchor rechecks, holder cancellation, append-only history, transfer locking, and atomic rollback.

The reference suite contains deterministic positive and negative vectors and independently derives both ERC-165 interface identifiers, the finality type hash, the remote-settlement leaf type hash, the validator-set hash, the Merkle root, and proof identifiers.

## Reference Implementation

A CC0 Solidity reference implementation and test suite accompany this draft. The implementation uses an immutable sorted validator set and threshold checkpoint signatures as a compact demonstration profile. It is not a claim that a fixed committee is appropriate for every deployment. Profiles for production consortium ledgers SHOULD verify native consensus finality and validator-set transitions.

## Security Considerations

This ERC removes trust in the proof submitter, not all trust. Security depends on the remote consensus, light client or validator quorum, validator-set update rules, cryptography, canonical encoding, verifier implementation, and any upgrade authority. A colluding remote consensus can finalize a false remote record, and a faulty verifier can accept an invalid proof.

The proof establishes that bytes were included in accepted finalized remote state. It does not establish that an asset exists, that a custodian told the truth, that a record is legally effective, or that the remote system complied with any law.

Profiles MUST address validator equivocation, quorum uniqueness, signature malleability, replay, remote forks, validator-set rotation, proof-size and gas denial of service, hash collisions, integer bounds, malformed encodings, and verifier upgrades. Fixed validator sets are suitable only where their lifecycle and recovery assumptions are acceptable.

Asset-anchor checks at both initiation and finalization prevent settlement after a local binding is revoked. Cancellation remains available to the recorded holder so a missing proof cannot permanently lock the token.

### Privacy

Settlement participants, timing, commitments, remote heights, and proof material are public on Ethereum. Commitments may still leak information through low-entropy inputs or correlation. Profiles SHOULD use domain-separated commitments, avoid personal or confidential plaintext, and publish only proof material necessary for verification. Deletion of off-chain data does not delete commitments, logs, calldata, or historical chain state.

## Copyright

Copyright and related rights waived via [CC0](../LICENSE.md).
