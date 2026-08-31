---
eip: XXXX
title: Versioned RWA Certificate Settlement
description: Atomically supersedes certificate commitments when deferred ERC-721 settlements finalize
author: Giraffe Technology Holding Limited (@REPLACE_WITH_GITHUB_USERNAME)
discussions-to: https://ethereum-magicians.org/t/REPLACE_WITH_DISCUSSION_SLUG
status: Draft
type: Standards Track
category: ERC
created: 2026-08-24
requires: 165, 721, 712, 1271, 8325
---

## Abstract

This ERC defines discoverable interfaces for ERC-721 tokens to expose a current authoritative certificate commitment, its version, and append-only supersession history. It also defines deferred settlement in which ordinary transfers are blocked while an off-chain authority updates its records. Finalization atomically supersedes the certificate commitment, transfers the ERC-721 token, and closes the settlement. The external process may complete at an implementation-defined T+n; this ERC does not prescribe n.

This ERC does not determine legal ownership, prescribe an authority or jurisdiction, or standardize financial activity.

## Motivation

ERC-721 does not express whether an authoritative off-chain certificate is current, how it supersedes prior certificates, or whether a proposed holder change remains pending while an external registry updates its records. Transferring before that process completes can create false finality and inconsistent certificate and holder state.

This ERC provides minimum interoperable semantics for certificate supersession, transfer blocking, authority authorization, and atomic finalization.

## Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119 and RFC 8174.

### Definitions

A **certificate commitment** is a nonzero `bytes32` commitment to an external authoritative certificate. An implementation profile MUST define the commitment algorithm, domain separation, and deterministic canonicalization. The ABI name `certificateHash` carries that commitment and does not require Keccak-256.

An **ordinary transfer** is `transferFrom` or either `safeTransferFrom` overload from ERC-721.

### Certificate history

The initial certificate version MUST be `1`, with `previousCertificateHash == bytes32(0)`. Each supersession MUST append version `n + 1`, set its `previousCertificateHash` to the prior commitment, set `supersededAt` on the prior record, leave the new record's `supersededAt` as zero, and emit `CertificateSuperseded`. Historical records MUST NOT be deleted, overwritten, reordered, skipped, or made cyclic.

Queries for nonexistent tokens or versions MUST revert.

### Certificate interface

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IERC165} from
    "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IVersionedRWACertificate is IERC165 {
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

The ERC-165 interface ID is `0xebaa86a0`.

### Asset binding

Every conforming token MUST implement ERC-8325 `IAssetBoundTokenId`. Each `tokenId` MUST return exactly one nonzero, immutable anchor from `anchorIdOf`, MUST use an immutable `anchorRegistry`, and MUST accurately report lifecycle state through `isAnchorActiveFor`. The registry and token declarations MUST form the mutual token-ID binding required by ERC-8325.

A conforming `tokenId` MUST represent one off-chain asset claim and MUST NOT represent a fraction, co-ownership share, or collection of assets. This ERC does not define another general asset-anchor interface.

### Settlement states and initiation

Settlement status values are `0 NONE`, `1 PENDING`, `2 FINALIZED`, and `3 CANCELLED`. A `settlementId` MUST be globally unique. A settlement may transition only from `PENDING` to `FINALIZED` or `CANCELLED`, and a token MUST have at most one pending settlement.

Before `beginSettlement` succeeds, the implementation MUST verify that the token exists, implements ERC-8325, has a nonzero immutable anchor, reports that anchor active, has no pending settlement, and that the caller is the holder or an ERC-721 approved operator. It MUST also verify a nonzero unused `settlementId`, a nonzero `snapshotHash`, a nonzero recipient different from the holder, a future deadline, and any additional implementation-defined checks.

While pending, `ownerOf(tokenId)` MUST continue to return `from`, the current certificate MUST remain unchanged, and every ordinary transfer MUST revert.

### Finalization and cancellation

Finalization before the deadline MUST atomically append the next certificate, transfer the token from `from` to `to`, mark the settlement `FINALIZED`, consume the authorization nonce, and emit `CertificateSuperseded`, `Transfer`, and `SettlementFinalized`. Implementations SHOULD emit those events in that order. Consumers MUST NOT use event order alone as evidence of validity. Any failure MUST revert the entire transaction.

A pending settlement MAY be cancelled using the authority authorization below. After the deadline, the recorded `from` address MAY cancel with empty `authorityData`. Cancellation MUST NOT change holder or certificate state.

### Settlement interface

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IERC165} from
    "@openzeppelin/contracts/utils/introspection/IERC165.sol";

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

    event SettlementStarted(
        bytes32 indexed settlementId,
        uint256 indexed tokenId,
        address indexed from,
        address to,
        bytes32 snapshotHash,
        uint64 deadline
    );

    event SettlementFinalized(
        bytes32 indexed settlementId,
        uint256 indexed tokenId,
        bytes32 indexed certificateHash,
        uint64 certificateVersion,
        uint64 effectiveAt
    );

    event SettlementCancelled(
        bytes32 indexed settlementId,
        uint256 indexed tokenId,
        bytes32 indexed reasonHash
    );

    function settlement(bytes32 settlementId)
        external view returns (SettlementRecord memory record);

    function pendingSettlementOf(uint256 tokenId)
        external view returns (bytes32 settlementId);

    function beginSettlement(
        uint256 tokenId,
        bytes32 settlementId,
        address to,
        bytes32 snapshotHash,
        uint64 deadline
    ) external;

    function finalizeSettlement(
        bytes32 settlementId,
        bytes32 newCertificateHash,
        bytes32 authorityReference,
        uint64 effectiveAt,
        bytes calldata authorityData
    ) external;

    function cancelSettlement(
        bytes32 settlementId,
        bytes32 reasonHash,
        bytes calldata authorityData
    ) external;
}
```

The ERC-165 interface ID is `0x2773d4c9`. A conforming implementation MUST implement and advertise both interfaces in this ERC, in addition to ERC-8325. A contract implementing only the read interface MUST NOT claim conformance.

### Authority authorization

Implementations MUST use EIP-712 with domain name `Versioned RWA Certificate Settlement`, version `1`, the current `chainId`, and the implementing contract as `verifyingContract`.

Finalization MUST use this exact canonical type:

```text
SettlementAuthorization(uint256 tokenId,bytes32 settlementId,address from,address to,bytes32 previousCertificateHash,bytes32 newCertificateHash,uint64 newCertificateVersion,uint64 effectiveAt,uint64 validUntil,uint256 nonce)
```

Authority cancellation MUST use this exact canonical type:

```text
CancellationAuthorization(bytes32 settlementId,uint256 tokenId,bytes32 reasonHash,uint64 validUntil,uint256 nonce)
```

For both types, `authorityData` MUST be:

```solidity
abi.encode(uint64 validUntil, uint256 nonce, bytes signature)
```

Encoded values MUST equal the signed fields. A successfully used nonce MUST be permanently consumed across both authorization types for that authority. Reverted calls MUST NOT consume a nonce. EOA signatures MUST use canonical low-s ECDSA. Contract authorities MUST be verified through ERC-1271. Authorizations from a prior authority MUST be rejected after rotation.

### ERC-721 transfer semantics

While pending, all ordinary transfers MUST revert for holders and operators. Entering pending state SHOULD clear or suspend token-specific approval. Finalization is a protocol operation and MUST NOT be implementable by calling a public ordinary transfer entry point that would permit bypass.

## Rationale

Two interfaces separate certificate queries from settlement workflow while full conformance requires both, avoiding the ambiguity of an optional state-changing extension. Keeping `ownerOf` unchanged until finalization prevents false finality. A profile-defined commitment supports different certificate formats without hard-coding a hashing algorithm. ERC-8325 supplies the canonical one-token/one-anchor relationship instead of introducing a competing identifier.

### Relationship to existing ERCs

ERC-7943 supplies generic transfer eligibility, freeze, and forced-transfer controls but does not define certificate versions or atomic certificate supersession during deferred settlement. Implementations SHOULD compose with its compliance queries when applicable.

ERC-6997 adds a validation step to ERC-721 transfer and approval calls as an anti-theft mechanism. It does not define certificate commitments, certificate-version history, an external asset-registry binding, settlement deadlines, cancellation, or certificate-bound EIP-712 authorization; it also permits an approved account to transfer directly. This ERC permits an approved account to initiate settlement, but no holder or operator can bypass a pending settlement. Combining ERC-8325, ERC-6997, and ERC-7943 still lacks the shared settlement record, canonical authority payload, consecutive certificate supersession, and certificate/holder atomicity defined here.

ERC-3643 addresses permissioned fungible security tokens and identity/compliance registries. ERC-8106 addresses compliance-event audit trails and delayed execution. ERC-8048 standardizes token-registry metadata. ERC-7578 and ERC-7765 address redemption and physical-asset rights. ERC-7891 addresses splitting and merging. None supplies this ERC's combined certificate history and deferred ERC-721 settlement semantics.

## Backwards Compatibility

This ERC does not alter ERC-721. Existing tokens may add these interfaces only if they can enforce transfer blocking and atomic finalization across every transfer path. Existing generic compliance, metadata, redemption, and asset-anchor mechanisms remain usable through composition.

## Reference Implementation

A CC0 Solidity reference implementation and executable tests accompany this working draft in `erc-reference/contracts/VersionedRWACertificateReference.sol` and `erc-reference/test/protocol.cjs`. Before an ERC pull request, these files SHOULD be copied under the number assigned by the editors according to repository policy.

## Test Cases

Conforming implementations MUST satisfy at least these vectors:

1. `IVersionedRWACertificate` interface ID is `0xebaa86a0`.
2. `IDeferredCertificateSettlement` interface ID is `0x2773d4c9`.
3. ERC-8325 `IAssetBoundTokenId` interface ID is `0x4a967b01`.
4. The EIP-712 type hashes equal `keccak256` of the exact canonical strings above.
5. `authorityData` decodes as `(uint64 validUntil, uint256 nonce, bytes signature)` and matches signed values.
6. A pending token rejects holder and operator ordinary transfers.
7. A valid finalization changes certificate and holder atomically; invalid, expired, replayed, or wrong-authority data changes neither.
8. An inactive ERC-8325 anchor rejects settlement initiation.
9. Repeated settlements preserve consecutive append-only history.

## Security Considerations

Implementations MUST prevent signature replay across chains, contracts, tokens, settlements, purposes, and authority epochs. They MUST reject expired authorizations, reused nonces, invalid ERC-1271 responses, and high-s ECDSA signatures. Authority rotation and compromise handling MUST be auditable.

All state changes in finalization MUST be atomic and reentrancy-safe. External signature or registry calls MUST NOT expose an inconsistent intermediate state. Pending-state restrictions MUST cover both `safeTransferFrom` overloads, `transferFrom`, approvals, and custom transfer paths. `deadline`, `effectiveAt`, and profile-specific T+n expectations MUST account for timestamp manipulation and external delays. Certificate commitments MUST use deterministic profile rules and domain separation appropriate to their algorithm.

This ERC does not prove the truth, validity, or legal effect of external evidence.

## Copyright

Copyright and related rights waived via [CC0](/LICENSE).
