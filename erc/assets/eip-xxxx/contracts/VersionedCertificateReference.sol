// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

// Reference proof profile - trust assumptions and non-goals.
//
// This file demonstrates the settlement invariant. It is not a production
// light client. An implementer copying it inherits the following limits,
// which the specification assigns to the implementation profile:
//
// 1. Validator equivocation is not detected. lastRemoteHeight is tracked per
//    token and usedProofs keys on (checkpoint, leaf), so a quorum that signs
//    two different state roots at the same remote height can finalize
//    different tokens from different forks without the contract noticing.
// 2. The validator set is immutable. isFinalityValidator, validatorSetHash
//    and finalityThreshold are fixed at construction, so a compromised
//    validator key remains valid for the life of the contract. The only
//    recovery path is holder cancellation after the settlement deadline.
// 3. siblings and signatures are unbounded. Oversized input costs the
//    submitter gas only; the strictly increasing signer rule caps the number
//    of accepted signatures at the validator set size.
//
// Production profiles SHOULD use the remote ledger's native light client and
// validator-set transition rules, and MUST disclose the verifier and any
// upgrade authority as part of the security boundary.

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
interface IERC721 is IERC165 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}
interface IAssetAnchorRegistryLifecycleView {
    struct AnchorBinding {
        address boundToken;
        uint256 boundTokenId;
    }
    function isActive(bytes32 anchorId) external view returns (bool);
    function isBound(bytes32 anchorId) external view returns (bool);
    function getAnchor(bytes32 anchorId) external view returns (AnchorBinding memory binding);
}
interface IAssetBoundTokenId is IERC165 {
    function anchorIdOf(uint256 tokenId) external view returns (bytes32);
    function anchorRegistry() external view returns (address);
    function isAnchorActiveFor(uint256 tokenId) external view returns (bool);
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
    function currentCertificate(
        uint256 tokenId
    ) external view returns (CertificateRecord memory record);
    function certificateAt(
        uint256 tokenId,
        uint64 version
    ) external view returns (CertificateRecord memory record);
    function certificateAuthority(uint256 tokenId) external view returns (address authority);
}

interface IDeferredCertificateSettlement is IERC165 {
    enum SettlementStatus {
        NONE,
        PENDING,
        FINALIZED,
        CANCELLED
    }
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
    function settlement(
        bytes32 settlementId
    ) external view returns (SettlementRecord memory record);
    function pendingSettlementOf(uint256 tokenId) external view returns (bytes32 settlementId);
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
        bytes calldata proofData
    ) external;
    function cancelSettlement(
        bytes32 settlementId,
        bytes32 reasonHash,
        bytes calldata proofData
    ) external;
}

contract VersionedCertificateReference is
    IERC721,
    IAssetBoundTokenId,
    IVersionedCertificate,
    IDeferredCertificateSettlement
{
    error Unauthorized();
    error InvalidAddress();
    error TokenNotFound();
    error InvalidCertificate();
    error InvalidSettlement();
    error SettlementExists();
    error SettlementPending();
    error DeadlinePassed();
    error InvalidProof();
    error ProofAlreadyUsed();
    error StaleRemoteHeight();
    error UnsafeRecipient();
    error DeadlineTooFar();
    bytes4 private constant _ERC165_ID = 0x01ffc9a7;
    bytes4 private constant _ERC721_ID = 0x80ac58cd;
    bytes4 private constant _ERC721_RECEIVED = 0x150b7a02;
    uint256 private constant _HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 public constant REMOTE_FINALITY_TYPEHASH = keccak256(
        "RemoteFinality(bytes32 remoteLedgerId,uint64 remoteHeight,bytes32 remoteBlockHash,bytes32 remoteStateRoot,bytes32 validatorSetHash)"
    );
    bytes32 public constant REMOTE_SETTLEMENT_LEAF_TYPEHASH = keccak256(
        "RemoteSettlement(uint256 localChainId,address localContract,uint256 tokenId,bytes32 settlementId,address from,address to,bytes32 snapshotHash,bytes32 previousCertificateHash,bytes32 newCertificateHash,bytes32 authorityReference,uint64 newCertificateVersion,uint64 effectiveAt,bytes32 anchorId)"
    );
    address public immutable administrator;
    address public immutable anchorRegistry;
    bytes32 public immutable remoteLedgerId;
    bytes32 public immutable validatorSetHash;
    uint8 public immutable finalityThreshold;
    uint64 public constant MAX_SETTLEMENT_DURATION = 30 days;
    mapping(address => bool) public isFinalityValidator;
    mapping(uint256 => uint64) public lastRemoteHeight;
    mapping(bytes32 => bool) public usedProofs;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approvals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => address) private _authorities;
    mapping(uint256 => bytes32) private _anchorIds;
    mapping(bytes32 => uint256) private _tokenByAnchor;
    mapping(bytes32 => bool) private _anchorAssigned;
    mapping(uint256 => uint64) private _currentVersion;
    mapping(uint256 => mapping(uint64 => CertificateRecord)) private _certificates;
    mapping(bytes32 => SettlementRecord) private _settlements;
    mapping(uint256 => bytes32) private _pending;

    constructor(
        address anchorRegistry_,
        bytes32 remoteLedgerId_,
        address[] memory validators_,
        uint8 threshold_
    ) {
        if (remoteLedgerId_ == bytes32(0) || threshold_ == 0 || threshold_ > validators_.length)
            revert InvalidProof();
        administrator = msg.sender;
        anchorRegistry = anchorRegistry_;
        remoteLedgerId = remoteLedgerId_;
        finalityThreshold = threshold_;
        address previous;
        for (uint256 i; i < validators_.length; ++i) {
            address validator = validators_[i];
            if (validator == address(0) || validator <= previous) revert InvalidProof();
            isFinalityValidator[validator] = true;
            previous = validator;
        }
        validatorSetHash = keccak256(abi.encode(validators_, threshold_));
    }
    function supportsInterface(bytes4 id) external view returns (bool) {
        return
            id == _ERC165_ID ||
            id == _ERC721_ID ||
            (anchorRegistry != address(0) && id == type(IAssetBoundTokenId).interfaceId) ||
            id == type(IVersionedCertificate).interfaceId ||
            id == type(IDeferredCertificateSettlement).interfaceId;
    }
    function mint(
        address to,
        uint256 tokenId,
        bytes32 cert,
        bytes32 ref,
        uint64 effectiveAt,
        address authority,
        bytes32 anchorId
    ) external {
        if (msg.sender != administrator) revert Unauthorized();
        if (to == address(0) || authority == address(0)) revert InvalidAddress();
        if (
            _owners[tokenId] != address(0) ||
            cert == bytes32(0) ||
            anchorId == bytes32(0) ||
            _anchorAssigned[anchorId]
        ) revert InvalidCertificate();
        _owners[tokenId] = to;
        _balances[to]++;
        _authorities[tokenId] = authority;
        _anchorIds[tokenId] = anchorId;
        _tokenByAnchor[anchorId] = tokenId;
        _anchorAssigned[anchorId] = true;
        _currentVersion[tokenId] = 1;
        _certificates[tokenId][1] = CertificateRecord(cert, bytes32(0), ref, 1, effectiveAt, 0);
        emit Transfer(address(0), to, tokenId);
        emit CertificateInitialized(tokenId, cert, ref, 1, effectiveAt);
    }
    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert InvalidAddress();
        return _balances[owner];
    }
    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert TokenNotFound();
    }
    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operatorApprovals[owner][msg.sender]) revert Unauthorized();
        _approvals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }
    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert InvalidAddress();
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }
    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _approvals[tokenId];
    }
    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApprovals[owner][operator];
    }
    function transferFrom(address from, address to, uint256 tokenId) public {
        if (_pending[tokenId] != bytes32(0)) revert SettlementPending();
        if (!_isAuthorized(msg.sender, tokenId)) revert Unauthorized();
        _transfer(from, to, tokenId);
    }
    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (
                bytes4 result
            ) {
                if (result != _ERC721_RECEIVED) revert UnsafeRecipient();
            } catch {
                revert UnsafeRecipient();
            }
        }
    }
    function currentCertificate(uint256 tokenId) external view returns (CertificateRecord memory) {
        ownerOf(tokenId);
        return _certificates[tokenId][_currentVersion[tokenId]];
    }
    function certificateAt(
        uint256 tokenId,
        uint64 version
    ) external view returns (CertificateRecord memory record) {
        ownerOf(tokenId);
        record = _certificates[tokenId][version];
        if (record.version == 0) revert InvalidCertificate();
    }
    function certificateAuthority(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _authorities[tokenId];
    }
    function anchorIdOf(uint256 tokenId) external view returns (bytes32 anchorId) {
        ownerOf(tokenId);
        anchorId = _anchorIds[tokenId];
        if (anchorId == bytes32(0)) revert InvalidCertificate();
    }
    function isAnchorActiveFor(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        bytes32 a = _anchorIds[tokenId];
        if (a == bytes32(0)) revert InvalidCertificate();
        return
            anchorRegistry == address(0) ||
            IAssetAnchorRegistryLifecycleView(anchorRegistry).isActive(a);
    }
    function settlement(bytes32 id) external view returns (SettlementRecord memory record) {
        record = _settlements[id];
        if (record.status == SettlementStatus.NONE) revert InvalidSettlement();
    }
    function pendingSettlementOf(uint256 tokenId) external view returns (bytes32) {
        ownerOf(tokenId);
        return _pending[tokenId];
    }

    function beginSettlement(
        uint256 tokenId,
        bytes32 id,
        address to,
        bytes32 snapshot,
        uint64 deadline
    ) external {
        address from = ownerOf(tokenId);
        if (!_isAuthorized(msg.sender, tokenId)) revert Unauthorized();
        if (to == address(0) || to == from) revert InvalidAddress();
        if (id == bytes32(0) || snapshot == bytes32(0)) revert InvalidSettlement();
        if (_settlements[id].status != SettlementStatus.NONE) revert SettlementExists();
        if (_pending[tokenId] != bytes32(0)) revert SettlementPending();
        if (deadline <= block.timestamp) revert DeadlinePassed();
        if (uint256(deadline) - block.timestamp > MAX_SETTLEMENT_DURATION) revert DeadlineTooFar();
        _assertAnchorBinding(tokenId);
        delete _approvals[tokenId];
        _settlements[id] = SettlementRecord(
            tokenId,
            from,
            to,
            snapshot,
            uint64(block.timestamp),
            deadline,
            SettlementStatus.PENDING
        );
        _pending[tokenId] = id;
        emit SettlementStarted(id, tokenId, from, to, snapshot, deadline);
    }

    function finalizeSettlement(
        bytes32 id,
        bytes32 newCert,
        bytes32 ref,
        uint64 effectiveAt,
        bytes calldata proofData
    ) external {
        SettlementRecord storage item = _settlements[id];
        if (item.status != SettlementStatus.PENDING) revert InvalidSettlement();
        if (block.timestamp > item.deadline) revert DeadlinePassed();
        if (newCert == bytes32(0)) revert InvalidCertificate();
        _assertAnchorBinding(item.tokenId);
        uint64 oldVersion = _currentVersion[item.tokenId];
        CertificateRecord storage oldRecord = _certificates[item.tokenId][oldVersion];
        if (effectiveAt < oldRecord.effectiveAt) revert InvalidCertificate();
        uint64 newVersion = oldVersion + 1;
        (
            uint64 height,
            bytes32 blockHash,
            bytes32 root,
            uint256 leafIndex,
            bytes32[] memory siblings,
            bytes[] memory signatures
        ) = abi.decode(proofData, (uint64, bytes32, bytes32, uint256, bytes32[], bytes[]));
        if (height <= lastRemoteHeight[item.tokenId]) revert StaleRemoteHeight();
        bytes32 leaf = _remoteLeaf(
            item,
            id,
            oldRecord.certificateHash,
            newCert,
            ref,
            newVersion,
            effectiveAt
        );
        if (!_verifyMembership(leaf, leafIndex, siblings, root)) revert InvalidProof();
        bytes32 finality = keccak256(
            abi.encode(
                REMOTE_FINALITY_TYPEHASH,
                remoteLedgerId,
                height,
                blockHash,
                root,
                validatorSetHash
            )
        );
        _verifyFinality(finality, signatures);
        bytes32 proofId = keccak256(abi.encode(finality, leaf));
        if (usedProofs[proofId]) revert ProofAlreadyUsed();
        usedProofs[proofId] = true;
        lastRemoteHeight[item.tokenId] = height;
        oldRecord.supersededAt = uint64(block.timestamp);
        _certificates[item.tokenId][newVersion] = CertificateRecord(
            newCert,
            oldRecord.certificateHash,
            ref,
            newVersion,
            effectiveAt,
            0
        );
        _currentVersion[item.tokenId] = newVersion;
        item.status = SettlementStatus.FINALIZED;
        delete _pending[item.tokenId];
        emit CertificateSuperseded(
            item.tokenId,
            newVersion,
            newCert,
            oldRecord.certificateHash,
            ref,
            effectiveAt
        );
        _transfer(item.from, item.to, item.tokenId);
        emit SettlementFinalized(id, item.tokenId, newCert, newVersion, effectiveAt);
    }
    function cancelSettlement(bytes32 id, bytes32 reason, bytes calldata proofData) external {
        SettlementRecord storage item = _settlements[id];
        if (item.status != SettlementStatus.PENDING) revert InvalidSettlement();
        if (msg.sender != item.from || proofData.length != 0) revert Unauthorized();
        item.status = SettlementStatus.CANCELLED;
        delete _pending[item.tokenId];
        emit SettlementCancelled(id, item.tokenId, reason);
    }

    function _remoteLeaf(
        SettlementRecord storage item,
        bytes32 id,
        bytes32 previous,
        bytes32 next,
        bytes32 ref,
        uint64 version,
        uint64 effectiveAt
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    REMOTE_SETTLEMENT_LEAF_TYPEHASH,
                    block.chainid,
                    address(this),
                    item.tokenId,
                    id,
                    item.from,
                    item.to,
                    item.snapshotHash,
                    previous,
                    next,
                    ref,
                    version,
                    effectiveAt,
                    _anchorIds[item.tokenId]
                )
            );
    }
    function _verifyMembership(
        bytes32 leaf,
        uint256 index,
        bytes32[] memory siblings,
        bytes32 root
    ) private pure returns (bool) {
        bytes32 value = leaf;
        for (uint256 i; i < siblings.length; ++i) {
            value =
                index & 1 == 0
                    ? keccak256(abi.encodePacked(value, siblings[i]))
                    : keccak256(abi.encodePacked(siblings[i], value));
            index >>= 1;
        }
        return value == root;
    }
    function _verifyFinality(bytes32 digest, bytes[] memory signatures) private view {
        if (signatures.length < finalityThreshold) revert InvalidProof();
        address previous;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = _recover(digest, signatures[i]);
            if (!isFinalityValidator[signer] || signer <= previous) revert InvalidProof();
            previous = signer;
        }
    }
    function _recover(
        bytes32 digest,
        bytes memory signature
    ) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidProof();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (uint256(s) > _HALF_ORDER) revert InvalidProof();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidProof();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidProof();
    }
    function _isAuthorized(address caller, uint256 tokenId) private view returns (bool) {
        address owner = ownerOf(tokenId);
        return
            caller == owner || caller == _approvals[tokenId] || _operatorApprovals[owner][caller];
    }
    function _transfer(address from, address to, uint256 tokenId) private {
        if (to == address(0)) revert InvalidAddress();
        if (ownerOf(tokenId) != from) revert Unauthorized();
        delete _approvals[tokenId];
        _owners[tokenId] = to;
        _balances[from]--;
        _balances[to]++;
        emit Transfer(from, to, tokenId);
    }
    function _assertAnchorBinding(uint256 tokenId) private view {
        bytes32 a = _anchorIds[tokenId];
        if (a == bytes32(0) || !_anchorAssigned[a] || _tokenByAnchor[a] != tokenId)
            revert InvalidSettlement();
        if (anchorRegistry == address(0)) return;
        IAssetAnchorRegistryLifecycleView registry = IAssetAnchorRegistryLifecycleView(
            anchorRegistry
        );
        if (!registry.isActive(a) || !registry.isBound(a)) revert InvalidSettlement();
        IAssetAnchorRegistryLifecycleView.AnchorBinding memory binding = registry.getAnchor(a);
        if (binding.boundToken != address(this) || binding.boundTokenId != tokenId)
            revert InvalidSettlement();
    }
}

contract AssetAnchorRegistryLifecycleMock is IAssetAnchorRegistryLifecycleView {
    mapping(bytes32 => bool) private _active;
    mapping(bytes32 => AnchorBinding) private _bindings;
    function setBinding(bytes32 id, address token, uint256 tokenId, bool active) external {
        _bindings[id] = AnchorBinding(token, tokenId);
        _active[id] = active;
    }
    function setActive(bytes32 id, bool active) external {
        _active[id] = active;
    }
    function isActive(bytes32 id) external view returns (bool) {
        return _active[id];
    }
    function isBound(bytes32 id) external view returns (bool) {
        return _bindings[id].boundToken != address(0);
    }
    function getAnchor(bytes32 id) external view returns (AnchorBinding memory) {
        return _bindings[id];
    }
}
contract NonReceiverContract {}
