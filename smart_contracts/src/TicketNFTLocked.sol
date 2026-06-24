// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @dev Variante do TicketNFT com transferências restritas à plataforma.
/// Qualquer transferFrom/safeTransferFrom chamado por um endereço não autorizado
/// é revertido — garante que royalties e taxas de plataforma sejam sempre cobrados.
/// Minting (from == address(0)) é sempre permitido.
/// Authorized transferors: TicketSale, TicketResale, TicketSwap — configurados via grantTransferor().
contract TicketNFTLocked is ERC721URIStorage, ERC2981, AccessControl {
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

    /// Endereços autorizados a chamar transferFrom (TicketSale, TicketResale, TicketSwap).
    mapping(address => bool) public authorizedTransferor;

    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed buyer);
    event Frozen(uint256 indexed tokenId, string finalURI);
    event TransferorGranted(address indexed account);
    event TransferorRevoked(address indexed account);

    error AlreadyFrozen(uint256 tokenId);
    error UnauthorizedTransfer(address caller);

    constructor() ERC721("PlatformTicket", "TKET") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Transfer enforcement ────────────────────────────────────────────────────

    /// Bloqueia transfers diretos entre carteiras. Apenas contratos da plataforma
    /// listados em authorizedTransferor podem mover NFTs. Mint (from == address(0))
    /// sempre passa — não envolve pagamento de royalties.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && !authorizedTransferor[msg.sender]) {
            revert UnauthorizedTransfer(msg.sender);
        }
        return super._update(to, tokenId, auth);
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

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (frozen[tokenId]) {
            _requireOwned(tokenId);
            return _frozenURI[tokenId];
        }
        return super.tokenURI(tokenId);
    }

    // ─── Freeze ─────────────────────────────────────────────────────────────────

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

    /// Autoriza um contrato da plataforma a executar transfers (TicketSale, TicketResale, TicketSwap).
    function grantTransferor(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedTransferor[account] = true;
        emit TransferorGranted(account);
    }

    /// Remove autorização de transfer de um contrato da plataforma.
    function revokeTransferor(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedTransferor[account] = false;
        emit TransferorRevoked(account);
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
