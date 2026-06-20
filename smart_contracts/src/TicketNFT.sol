// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract TicketNFT is ERC721URIStorage, ERC2981, AccessControl {
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 private _nextTokenId;
    string  private _baseTokenURI;

    struct TicketMetadata {
        uint256 eventId;
        string  eventName;
        uint256 ticketNumber;
        uint256 totalTickets;
        string  seat;
        uint256 eventTimestamp;
        address organizer;
        uint256 facePrice;
    }

    struct MintParams {
        address to;
        uint256 eventId;
        string  eventName;
        uint256 ticketNumber;
        uint256 totalTickets;
        string  seat;
        uint256 eventTimestamp;
        address organizer;
        uint256 facePrice;
        address royaltyReceiver;
        uint96  royaltyFeeBps;
    }

    mapping(uint256 => TicketMetadata) public ticketData;
    mapping(uint256 => bool)           public frozen;
    mapping(uint256 => string)         private _frozenURI;

    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed buyer);
    event Frozen(uint256 indexed tokenId, string finalURI);

    error AlreadyFrozen(uint256 tokenId);

    constructor() ERC721("PlatformTicket", "TKET") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Mint ───────────────────────────────────────────────────────────────────

    function mint(MintParams calldata p) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(p.to, tokenId);
        _setTokenRoyalty(tokenId, p.royaltyReceiver, p.royaltyFeeBps);

        ticketData[tokenId] = TicketMetadata({
            eventId:        p.eventId,
            eventName:      p.eventName,
            ticketNumber:   p.ticketNumber,
            totalTickets:   p.totalTickets,
            seat:           p.seat,
            eventTimestamp: p.eventTimestamp,
            organizer:      p.organizer,
            facePrice:      p.facePrice
        });

        emit TicketMinted(tokenId, p.eventId, p.to);
    }

    function getTicketData(uint256 tokenId) external view returns (TicketMetadata memory) {
        return ticketData[tokenId];
    }

    // ─── URI ────────────────────────────────────────────────────────────────────

    // Pre-event: returns _baseTokenURI + tokenId  (dynamic server)
    // Post-event (frozen): returns the pinned IPFS CID set at freeze time
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ERC721URIStorage prefixes per-token URIs with the base URI, which would
    // corrupt the pinned IPFS CID — frozen tokens bypass it entirely.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (frozen[tokenId]) {
            _requireOwned(tokenId);
            return _frozenURI[tokenId];
        }
        return super.tokenURI(tokenId);
    }

    // ─── Freeze ─────────────────────────────────────────────────────────────────

    /// Pins the token URI to a static IPFS CID so metadata becomes immutable.
    /// Call this after the event date, passing the final metadata snapshot.
    /// The token remains freely transferable — holders can still sell/swap the
    /// ticket as a collectible; only the on-chain metadata is locked.
    function freeze(uint256 tokenId, string calldata finalURI)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (frozen[tokenId]) revert AlreadyFrozen(tokenId);
        _requireOwned(tokenId);
        frozen[tokenId] = true;
        _frozenURI[tokenId] = finalURI;
        emit Frozen(tokenId, finalURI);
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
    }

    function grantMinter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, account);
    }

    function revokeMinter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, account);
    }

    function grantOperator(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(OPERATOR_ROLE, account);
    }

    function revokeOperator(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(OPERATOR_ROLE, account);
    }

    // ─── ERC-165 ────────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
