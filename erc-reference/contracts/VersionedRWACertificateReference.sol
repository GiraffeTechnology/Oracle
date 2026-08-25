// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC721 is IERC165 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external returns (bytes4);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external view returns (bytes4 magicValue);
}

interface IAssetAnchorRegistryLifecycleView {
    function isActive(bytes32 anchorId) external view returns (bool);
}

interface IAssetBoundTokenId is IERC165 {
    function anchorIdOf(uint256 tokenId) external view returns (bytes32);
    function anchorRegistry() external view returns (address);
    function isAnchorActiveFor(uint256 tokenId) external view returns (bool);
}

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

contract VersionedRWACertificateReference is
    IERC721,
    IAssetBoundTokenId,
    IVersionedRWACertificate,
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
    error DeadlineNotPassed();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error NonceUsed();
    error UnsafeRecipient();

    bytes4 private constant _ERC165_ID = 0x01ffc9a7;
    bytes4 private constant _ERC721_ID = 0x80ac58cd;
    bytes4 private constant _ERC721_RECEIVED = 0x150b7a02;
    bytes4 private constant _ERC1271_MAGIC_VALUE = 0x1626ba7e;
    uint256 private constant _SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant _NAME_HASH = keccak256("Versioned RWA Certificate Settlement");
    bytes32 private constant _VERSION_HASH = keccak256("1");
    bytes32 public constant SETTLEMENT_AUTHORIZATION_TYPEHASH = keccak256(
        "SettlementAuthorization(uint256 tokenId,bytes32 settlementId,address from,address to,bytes32 previousCertificateHash,bytes32 newCertificateHash,uint64 newCertificateVersion,uint64 effectiveAt,uint64 validUntil,uint256 nonce)"
    );
    bytes32 public constant CANCELLATION_AUTHORIZATION_TYPEHASH = keccak256(
        "CancellationAuthorization(bytes32 settlementId,uint256 tokenId,bytes32 reasonHash,uint64 validUntil,uint256 nonce)"
    );

    address public immutable administrator;
    address public immutable anchorRegistry;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approvals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => address) private _authorities;
    mapping(uint256 => bytes32) private _anchorIds;
    mapping(uint256 => uint64) private _currentVersion;
    mapping(uint256 => mapping(uint64 => CertificateRecord)) private _certificates;
    mapping(bytes32 => SettlementRecord) private _settlements;
    mapping(uint256 => bytes32) private _pending;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    constructor(address anchorRegistry_) {
        if (anchorRegistry_ == address(0)) revert InvalidAddress();
        administrator = msg.sender;
        anchorRegistry = anchorRegistry_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == _ERC165_ID
            || interfaceId == _ERC721_ID
            || interfaceId == type(IAssetBoundTokenId).interfaceId
            || interfaceId == type(IVersionedRWACertificate).interfaceId
            || interfaceId == type(IDeferredCertificateSettlement).interfaceId;
    }

    function mint(
        address to,
        uint256 tokenId,
        bytes32 certificateHash,
        bytes32 authorityReference,
        uint64 effectiveAt,
        address authority,
        bytes32 anchorId
    ) external {
        if (msg.sender != administrator) revert Unauthorized();
        if (to == address(0) || authority == address(0)) revert InvalidAddress();
        if (
            _owners[tokenId] != address(0)
                || certificateHash == bytes32(0)
                || anchorId == bytes32(0)
        ) {
            revert InvalidCertificate();
        }
        _owners[tokenId] = to;
        _balances[to] += 1;
        _authorities[tokenId] = authority;
        _anchorIds[tokenId] = anchorId;
        _currentVersion[tokenId] = 1;
        _certificates[tokenId][1] = CertificateRecord({
            certificateHash: certificateHash,
            previousCertificateHash: bytes32(0),
            authorityReference: authorityReference,
            version: 1,
            effectiveAt: effectiveAt,
            supersededAt: 0
        });
        emit Transfer(address(0), to, tokenId);
        emit CertificateInitialized(
            tokenId, certificateHash, authorityReference, 1, effectiveAt
        );
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
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data)
                returns (bytes4 result)
            {
                if (result != _ERC721_RECEIVED) revert UnsafeRecipient();
            } catch {
                revert UnsafeRecipient();
            }
        }
    }

    function currentCertificate(uint256 tokenId)
        external view returns (CertificateRecord memory record)
    {
        ownerOf(tokenId);
        return _certificates[tokenId][_currentVersion[tokenId]];
    }

    function certificateAt(uint256 tokenId, uint64 version)
        external view returns (CertificateRecord memory record)
    {
        ownerOf(tokenId);
        record = _certificates[tokenId][version];
        if (record.version == 0) revert InvalidCertificate();
    }

    function certificateAuthority(uint256 tokenId) external view returns (address authority) {
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
        bytes32 anchorId = _anchorIds[tokenId];
        if (anchorId == bytes32(0)) revert InvalidCertificate();
        return IAssetAnchorRegistryLifecycleView(anchorRegistry).isActive(anchorId);
    }

    function settlement(bytes32 settlementId)
        external view returns (SettlementRecord memory record)
    {
        record = _settlements[settlementId];
        if (record.status == SettlementStatus.NONE) revert InvalidSettlement();
    }

    function pendingSettlementOf(uint256 tokenId) external view returns (bytes32 settlementId) {
        ownerOf(tokenId);
        return _pending[tokenId];
    }

    function beginSettlement(
        uint256 tokenId,
        bytes32 settlementId,
        address to,
        bytes32 snapshotHash,
        uint64 deadline
    ) external {
        address from = ownerOf(tokenId);
        if (!_isAuthorized(msg.sender, tokenId)) revert Unauthorized();
        if (to == address(0) || to == from) revert InvalidAddress();
        if (settlementId == bytes32(0) || snapshotHash == bytes32(0)) {
            revert InvalidSettlement();
        }
        if (_settlements[settlementId].status != SettlementStatus.NONE) {
            revert SettlementExists();
        }
        if (_pending[tokenId] != bytes32(0)) revert SettlementPending();
        if (deadline <= block.timestamp) revert DeadlinePassed();
        bytes32 anchorId = _anchorIds[tokenId];
        if (
            anchorId == bytes32(0)
                || !IAssetAnchorRegistryLifecycleView(anchorRegistry).isActive(anchorId)
        ) revert InvalidSettlement();

        delete _approvals[tokenId];
        _settlements[settlementId] = SettlementRecord({
            tokenId: tokenId,
            from: from,
            to: to,
            snapshotHash: snapshotHash,
            initiatedAt: uint64(block.timestamp),
            deadline: deadline,
            status: SettlementStatus.PENDING
        });
        _pending[tokenId] = settlementId;
        emit SettlementStarted(settlementId, tokenId, from, to, snapshotHash, deadline);
    }

    function finalizeSettlement(
        bytes32 settlementId,
        bytes32 newCertificateHash,
        bytes32 authorityReference,
        uint64 effectiveAt,
        bytes calldata authorityData
    ) external {
        SettlementRecord storage item = _settlements[settlementId];
        if (item.status != SettlementStatus.PENDING) revert InvalidSettlement();
        if (block.timestamp > item.deadline) revert DeadlinePassed();
        if (newCertificateHash == bytes32(0)) revert InvalidCertificate();

        (uint64 validUntil, uint256 nonce, bytes memory signature) =
            abi.decode(authorityData, (uint64, uint256, bytes));
        if (block.timestamp > validUntil) revert AuthorizationExpired();

        uint64 oldVersion = _currentVersion[item.tokenId];
        CertificateRecord storage oldRecord = _certificates[item.tokenId][oldVersion];
        uint64 newVersion = oldVersion + 1;
        address authority = _authorities[item.tokenId];
        if (usedNonces[authority][nonce]) revert NonceUsed();
        bytes32 digest = _settlementAuthorizationDigest(
            item,
            settlementId,
            oldRecord.certificateHash,
            newCertificateHash,
            newVersion,
            effectiveAt,
            validUntil,
            nonce
        );
        if (!_isValidAuthoritySignature(authority, digest, signature)) {
            revert InvalidAuthorization();
        }

        usedNonces[authority][nonce] = true;
        oldRecord.supersededAt = uint64(block.timestamp);
        _certificates[item.tokenId][newVersion] = CertificateRecord({
            certificateHash: newCertificateHash,
            previousCertificateHash: oldRecord.certificateHash,
            authorityReference: authorityReference,
            version: newVersion,
            effectiveAt: effectiveAt,
            supersededAt: 0
        });
        _currentVersion[item.tokenId] = newVersion;

        item.status = SettlementStatus.FINALIZED;
        delete _pending[item.tokenId];
        emit CertificateSuperseded(
            item.tokenId,
            newVersion,
            newCertificateHash,
            oldRecord.certificateHash,
            authorityReference,
            effectiveAt
        );
        _transfer(item.from, item.to, item.tokenId);
        emit SettlementFinalized(
            settlementId, item.tokenId, newCertificateHash, newVersion, effectiveAt
        );
    }

    function cancelSettlement(
        bytes32 settlementId,
        bytes32 reasonHash,
        bytes calldata authorityData
    ) external {
        SettlementRecord storage item = _settlements[settlementId];
        if (item.status != SettlementStatus.PENDING) revert InvalidSettlement();
        bool timedOutHolder =
            block.timestamp > item.deadline && msg.sender == item.from && authorityData.length == 0;
        if (!timedOutHolder) {
            if (authorityData.length == 0) {
                if (block.timestamp <= item.deadline) revert DeadlineNotPassed();
                revert Unauthorized();
            }
            (uint64 validUntil, uint256 nonce, bytes memory signature) =
                abi.decode(authorityData, (uint64, uint256, bytes));
            if (block.timestamp > validUntil) revert AuthorizationExpired();
            address authority = _authorities[item.tokenId];
            if (usedNonces[authority][nonce]) revert NonceUsed();
            bytes32 digest = _cancellationAuthorizationDigest(
                settlementId, item.tokenId, reasonHash, validUntil, nonce
            );
            if (!_isValidAuthoritySignature(authority, digest, signature)) {
                revert InvalidAuthorization();
            }
            usedNonces[authority][nonce] = true;
        }
        item.status = SettlementStatus.CANCELLED;
        delete _pending[item.tokenId];
        emit SettlementCancelled(settlementId, item.tokenId, reasonHash);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _isAuthorized(address caller, uint256 tokenId) private view returns (bool) {
        address owner = ownerOf(tokenId);
        return caller == owner
            || caller == _approvals[tokenId]
            || _operatorApprovals[owner][caller];
    }

    function _transfer(address from, address to, uint256 tokenId) private {
        if (to == address(0)) revert InvalidAddress();
        if (ownerOf(tokenId) != from) revert Unauthorized();
        delete _approvals[tokenId];
        _owners[tokenId] = to;
        _balances[from] -= 1;
        _balances[to] += 1;
        emit Transfer(from, to, tokenId);
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(
            _DOMAIN_TYPEHASH,
            _NAME_HASH,
            _VERSION_HASH,
            block.chainid,
            address(this)
        ));
    }

    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _settlementAuthorizationDigest(
        SettlementRecord storage item,
        bytes32 settlementId,
        bytes32 previousCertificateHash,
        bytes32 newCertificateHash,
        uint64 newCertificateVersion,
        uint64 effectiveAt,
        uint64 validUntil,
        uint256 nonce
    ) private view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            SETTLEMENT_AUTHORIZATION_TYPEHASH,
            item.tokenId,
            settlementId,
            item.from,
            item.to,
            previousCertificateHash,
            newCertificateHash,
            newCertificateVersion,
            effectiveAt,
            validUntil,
            nonce
        ));
        return _hashTypedData(structHash);
    }

    function _cancellationAuthorizationDigest(
        bytes32 settlementId,
        uint256 tokenId,
        bytes32 reasonHash,
        uint64 validUntil,
        uint256 nonce
    ) private view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            CANCELLATION_AUTHORIZATION_TYPEHASH,
            settlementId,
            tokenId,
            reasonHash,
            validUntil,
            nonce
        ));
        return _hashTypedData(structHash);
    }

    function _recover(bytes32 digest, bytes memory signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidAuthorization();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (uint256(s) > _SECP256K1_HALF_ORDER) revert InvalidAuthorization();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidAuthorization();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidAuthorization();
    }

    function _isValidAuthoritySignature(
        address authority,
        bytes32 digest,
        bytes memory signature
    ) private view returns (bool) {
        if (authority.code.length == 0) {
            return _recover(digest, signature) == authority;
        }
        try IERC1271(authority).isValidSignature(digest, signature)
            returns (bytes4 result)
        {
            return result == _ERC1271_MAGIC_VALUE;
        } catch {
            return false;
        }
    }
}

contract AssetAnchorRegistryLifecycleMock is IAssetAnchorRegistryLifecycleView {
    mapping(bytes32 => bool) private _active;

    function setActive(bytes32 anchorId, bool active) external {
        _active[anchorId] = active;
    }

    function isActive(bytes32 anchorId) external view returns (bool) {
        return _active[anchorId];
    }
}

contract ERC1271AuthorityMock is IERC1271 {
    bytes4 private constant _MAGIC_VALUE = 0x1626ba7e;
    uint256 private constant _SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature)
        external view returns (bytes4)
    {
        if (signature.length != 65) return bytes4(0xffffffff);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        if (uint256(s) > _SECP256K1_HALF_ORDER) return bytes4(0xffffffff);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return bytes4(0xffffffff);
        return ecrecover(digest, v, r, s) == signer
            ? _MAGIC_VALUE
            : bytes4(0xffffffff);
    }
}
