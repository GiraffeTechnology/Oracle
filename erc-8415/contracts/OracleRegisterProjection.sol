// Project license: see ../../LICENSE, subject to its prior-rights exceptions.
// Historical licensing provenance: see ../../THIRD_PARTY_NOTICES.md.
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

    function currentEntry(uint256 tokenId) external view returns (RegisterEntry memory entry);
    function entryAt(uint256 tokenId, uint64 version) external view returns (RegisterEntry memory entry);
    function entryAsOf(uint256 tokenId, uint64 instant) external view returns (RegisterEntry memory entry);
    function holderAsOf(uint256 tokenId, uint64 instant) external view returns (address holder);
    function isFinalAsOf(uint256 tokenId, uint64 instant) external view returns (bool settled);
    function entryCount(uint256 tokenId) external view returns (uint64 count);
    function registerId() external view returns (bytes32 identifier);
}

/// @notice Minimal ERC-8415 projection with an immutable implementation-specific source authority.
/// @dev Source proof verification remains outside this projection-only slice. Only that verified
/// authority may admit entries; ordinary ERC-721 trading remains independent of projection state.
contract OracleRegisterProjection is IERC721, IRegisterProjection {
    /// @dev Optional implementation-specific source receipt, not an ERC-8415 interface.
    /// The document hash commits to the authoritative registration document itself.
    struct ReceiptBinding {
        bytes32 schemaId;
        bytes32 mintPolicyHash;
        bytes32 segmentDigest;
        bytes32 requestHash;
        bytes32 receiptDocumentHash;
    }

    error Unauthorized();
    error InvalidAddress();
    error TokenNotFound();
    error InvalidEntry();
    error EffectiveAtNotIncreasing();
    error CommitmentReused();
    error NoEntryAsOf();
    error UnsafeRecipient();
    error InvalidReceiptBinding();
    error ReceiptBindingRequired();
    error ReceiptSegmentReused();

    bytes32 public constant RECEIPT_BINDING_SCHEMA_V1 = keccak256("oracle.receipt-binding.v1");

    event MintPolicyCommitted(uint256 indexed tokenId, bytes32 indexed mintPolicyHash);
    event ReceiptBound(
        uint256 indexed tokenId,
        uint64 indexed version,
        bytes32 indexed segmentDigest,
        bytes32 schemaId,
        bytes32 mintPolicyHash,
        bytes32 requestHash,
        bytes32 receiptDocumentHash
    );

    bytes4 private constant _ERC165_ID = 0x01ffc9a7;
    bytes4 private constant _ERC721_ID = 0x80ac58cd;
    bytes4 private constant _ERC721_RECEIVED = 0x150b7a02;

    address public immutable sourceAuthority;
    bytes32 private immutable _registerIdentifier;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approvals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => RegisterEntry[]) private _entries;
    mapping(uint256 => mapping(bytes32 => bool)) private _commitmentUsed;
    mapping(uint256 => bytes32) private _mintPolicyHashes;
    mapping(uint256 => mapping(uint64 => ReceiptBinding)) private _receiptBindings;
    mapping(bytes32 => bool) private _receiptSegmentUsed;

    modifier onlySourceAuthority() {
        if (msg.sender != sourceAuthority) revert Unauthorized();
        _;
    }

    constructor(bytes32 registerIdentifier, address sourceAuthority_) {
        if (registerIdentifier == bytes32(0)) revert InvalidEntry();
        if (sourceAuthority_ == address(0)) revert InvalidAddress();
        _registerIdentifier = registerIdentifier;
        sourceAuthority = sourceAuthority_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == _ERC165_ID || interfaceId == _ERC721_ID
            || interfaceId == type(IRegisterProjection).interfaceId;
    }

    function registerId() external view returns (bytes32) {
        return _registerIdentifier;
    }

    function mintFromSource(
        address tokenOwner,
        uint256 tokenId,
        bytes32 recordCommitment,
        bytes32 registryReference,
        address registerHolder,
        uint64 effectiveAt
    ) external virtual onlySourceAuthority {
        _mintFromSource(
            tokenOwner, tokenId, recordCommitment, registryReference, registerHolder, effectiveAt, bytes32(0)
        );
    }

    /// @notice Commit an opaque application policy atomically with the original NFT mint.
    /// @dev Policy contents and canonical encoding belong to the application. No post-mint setter exists.
    function mintReceiptFromSource(
        address tokenOwner,
        uint256 tokenId,
        bytes32 recordCommitment,
        bytes32 registryReference,
        address registerHolder,
        uint64 effectiveAt,
        bytes32 policyHash
    ) external virtual onlySourceAuthority {
        if (policyHash == bytes32(0)) revert InvalidReceiptBinding();
        _mintFromSource(
            tokenOwner, tokenId, recordCommitment, registryReference, registerHolder, effectiveAt, policyHash
        );
    }

    function _mintFromSource(
        address tokenOwner,
        uint256 tokenId,
        bytes32 recordCommitment,
        bytes32 registryReference,
        address registerHolder,
        uint64 effectiveAt,
        bytes32 policyHash
    ) internal {
        if (tokenOwner == address(0) || registerHolder == address(0)) revert InvalidAddress();
        if (_owners[tokenId] != address(0) || recordCommitment == bytes32(0)) revert InvalidEntry();

        _owners[tokenId] = tokenOwner;
        _balances[tokenOwner] += 1;
        _mintPolicyHashes[tokenId] = policyHash;
        _commitmentUsed[tokenId][recordCommitment] = true;
        _entries[tokenId].push(
            RegisterEntry(recordCommitment, bytes32(0), registryReference, registerHolder, 1, effectiveAt, 0)
        );

        emit Transfer(address(0), tokenOwner, tokenId);
        emit RegisterInitialized(tokenId, recordCommitment, registerHolder, 1, effectiveAt);
        if (policyHash != bytes32(0)) emit MintPolicyCommitted(tokenId, policyHash);
    }

    function appendFromSource(
        uint256 tokenId,
        bytes32 recordCommitment,
        bytes32 registryReference,
        address registerHolder,
        uint64 effectiveAt
    ) external onlySourceAuthority {
        if (_mintPolicyHashes[tokenId] != bytes32(0)) revert ReceiptBindingRequired();
        _appendFromSource(tokenId, recordCommitment, registryReference, registerHolder, effectiveAt);
    }

    /// @notice Admit the source's registration and its receipt binding in the same transaction.
    /// @dev Admission does not transfer the ERC-721 owner or execute any payment. The configured
    /// source authenticates the document and segment correspondence under the committed policy.
    function appendReceiptFromSource(
        uint256 tokenId,
        bytes32 recordCommitment,
        bytes32 registryReference,
        address registerHolder,
        uint64 effectiveAt,
        ReceiptBinding calldata binding
    ) external onlySourceAuthority {
        ownerOf(tokenId);
        if (
            binding.schemaId != RECEIPT_BINDING_SCHEMA_V1
            || binding.mintPolicyHash == bytes32(0)
            || binding.mintPolicyHash != _mintPolicyHashes[tokenId]
            || binding.segmentDigest == bytes32(0)
            || binding.requestHash == bytes32(0)
            || binding.receiptDocumentHash == bytes32(0)
        ) revert InvalidReceiptBinding();
        if (_receiptSegmentUsed[binding.segmentDigest]) revert ReceiptSegmentReused();
        _validateReceiptAdmission(tokenId, registerHolder, effectiveAt, binding);

        uint64 version = _appendFromSource(
            tokenId, recordCommitment, registryReference, registerHolder, effectiveAt
        );
        _receiptBindings[tokenId][version] = binding;
        _receiptSegmentUsed[binding.segmentDigest] = true;
        emit ReceiptBound(
            tokenId, version, binding.segmentDigest, binding.schemaId, binding.mintPolicyHash,
            binding.requestHash, binding.receiptDocumentHash
        );
    }

    /// @dev Applications may validate their own policy without changing the base projection's semantics.
    function _validateReceiptAdmission(
        uint256 tokenId,
        address registerHolder,
        uint64 effectiveAt,
        ReceiptBinding memory binding
    ) internal view virtual {}

    function mintPolicyHash(uint256 tokenId) public view returns (bytes32) {
        ownerOf(tokenId);
        return _mintPolicyHashes[tokenId];
    }

    /// @dev An all-zero tuple means the existing entry has no source receipt binding.
    /// Missing tokens or versions revert; callers must not treat an absent binding as proof.
    function receiptBinding(uint256 tokenId, uint64 version) external view returns (ReceiptBinding memory) {
        ownerOf(tokenId);
        if (version == 0 || version > _entries[tokenId].length) revert InvalidEntry();
        return _receiptBindings[tokenId][version];
    }

    function _appendFromSource(
        uint256 tokenId,
        bytes32 recordCommitment,
        bytes32 registryReference,
        address registerHolder,
        uint64 effectiveAt
    ) internal returns (uint64 version) {
        ownerOf(tokenId);
        if (recordCommitment == bytes32(0)) revert InvalidEntry();
        if (registerHolder == address(0)) revert InvalidAddress();
        if (_commitmentUsed[tokenId][recordCommitment]) revert CommitmentReused();

        RegisterEntry[] storage list = _entries[tokenId];
        RegisterEntry storage previous = list[list.length - 1];
        if (effectiveAt <= previous.effectiveAt) revert EffectiveAtNotIncreasing();

        version = previous.version + 1;
        bytes32 previousCommitment = previous.recordCommitment;
        previous.supersededAt = effectiveAt;
        _commitmentUsed[tokenId][recordCommitment] = true;
        list.push(
            RegisterEntry(
                recordCommitment,
                previousCommitment,
                registryReference,
                registerHolder,
                version,
                effectiveAt,
                0
            )
        );

        emit RegisterSuperseded(
            tokenId, version, recordCommitment, previousCommitment, registerHolder, effectiveAt
        );
    }

    function entryCount(uint256 tokenId) external view returns (uint64) {
        ownerOf(tokenId);
        return uint64(_entries[tokenId].length);
    }

    function currentEntry(uint256 tokenId) external view returns (RegisterEntry memory) {
        ownerOf(tokenId);
        RegisterEntry[] storage list = _entries[tokenId];
        return list[list.length - 1];
    }

    function entryAt(uint256 tokenId, uint64 version) external view returns (RegisterEntry memory) {
        ownerOf(tokenId);
        if (version == 0 || version > _entries[tokenId].length) revert InvalidEntry();
        return _entries[tokenId][version - 1];
    }

    function entryAsOf(uint256 tokenId, uint64 instant) public view returns (RegisterEntry memory) {
        ownerOf(tokenId);
        RegisterEntry[] storage list = _entries[tokenId];
        if (instant < list[0].effectiveAt) revert NoEntryAsOf();
        uint256 low;
        uint256 high = list.length - 1;
        while (low < high) {
            uint256 middle = (low + high + 1) / 2;
            if (list[middle].effectiveAt <= instant) low = middle;
            else high = middle - 1;
        }
        return list[low];
    }

    function holderAsOf(uint256 tokenId, uint64 instant) external view returns (address) {
        return entryAsOf(tokenId, instant).holder;
    }

    /// @dev Final if and only if the instant is at or after the first entry's effectiveAt and
    /// strictly before the latest entry's. The lower bound matters: an instant preceding the
    /// first entry is not covered by the projection, so it is not final, and this MUST NOT
    /// revert there.
    function isFinalAsOf(uint256 tokenId, uint64 instant) external view returns (bool) {
        ownerOf(tokenId);
        RegisterEntry[] storage list = _entries[tokenId];
        return instant >= list[0].effectiveAt && instant < list[list.length - 1].effectiveAt;
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
        if (to == owner) revert InvalidAddress();
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

    function transferFrom(address from, address to, uint256 tokenId) public virtual {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && msg.sender != _approvals[tokenId]
            && !_operatorApprovals[owner][msg.sender]) revert Unauthorized();
        _transferOwner(from, to, tokenId);
    }

    /// @dev Authorization remains with the calling entrypoint; this helper grants no external authority.
    function _transferOwner(address from, address to, uint256 tokenId) internal {
        if (ownerOf(tokenId) != from || to == address(0)) revert InvalidAddress();

        delete _approvals[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 result) {
                if (result != _ERC721_RECEIVED) revert UnsafeRecipient();
            } catch {
                revert UnsafeRecipient();
            }
        }
    }
}


