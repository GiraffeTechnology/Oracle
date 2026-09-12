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
    error Unauthorized();
    error InvalidAddress();
    error TokenNotFound();
    error InvalidEntry();
    error EffectiveAtNotIncreasing();
    error CommitmentReused();
    error NoEntryAsOf();
    error UnsafeRecipient();

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
    ) external onlySourceAuthority {
        if (tokenOwner == address(0) || registerHolder == address(0)) revert InvalidAddress();
        if (_owners[tokenId] != address(0) || recordCommitment == bytes32(0)) revert InvalidEntry();

        _owners[tokenId] = tokenOwner;
        _balances[tokenOwner] += 1;
        _commitmentUsed[tokenId][recordCommitment] = true;
        _entries[tokenId].push(
            RegisterEntry(recordCommitment, bytes32(0), registryReference, registerHolder, 1, effectiveAt, 0)
        );

        emit Transfer(address(0), tokenOwner, tokenId);
        emit RegisterInitialized(tokenId, recordCommitment, registerHolder, 1, effectiveAt);
    }

    function appendFromSource(
        uint256 tokenId,
        bytes32 recordCommitment,
        bytes32 registryReference,
        address registerHolder,
        uint64 effectiveAt
    ) external onlySourceAuthority {
        ownerOf(tokenId);
        if (recordCommitment == bytes32(0)) revert InvalidEntry();
        if (registerHolder == address(0)) revert InvalidAddress();
        if (_commitmentUsed[tokenId][recordCommitment]) revert CommitmentReused();

        RegisterEntry[] storage list = _entries[tokenId];
        RegisterEntry storage previous = list[list.length - 1];
        if (effectiveAt <= previous.effectiveAt) revert EffectiveAtNotIncreasing();

        uint64 version = previous.version + 1;
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
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && msg.sender != _approvals[tokenId]
            && !_operatorApprovals[owner][msg.sender]) revert Unauthorized();
        if (owner != from || to == address(0)) revert InvalidAddress();

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

