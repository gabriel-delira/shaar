// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./TicketNFT.sol";

contract TicketSwap is Ownable, ReentrancyGuard {
    TicketNFT public immutable nft;
    address public platformWallet;

    // Fee config
    uint256 public fixedFeeETH;      // each party pays this amount (total fee = 2x)
    uint256 public platformShareBps; // platform's share of total fee
    uint256 public proposalTTL;      // seconds a proposal stays valid

    struct Proposal {
        address proposer;
        uint256 tokenIdA;    // proposer's token
        uint256 tokenIdB;    // target token
        uint256 feePerParty; // ETH each party contributes
        uint256 expiresAt;
        bool active;
    }

    uint256 private _nextProposalId;
    mapping(uint256 => Proposal) public proposals;

    uint256 private constant BPS = 10_000;

    mapping(address => uint256) public pendingWithdrawals;

    event SwapProposed(uint256 indexed proposalId, address indexed proposer, uint256 tokenIdA, uint256 tokenIdB);
    event TicketsSwapped(
        uint256 indexed proposalId,
        uint256 tokenIdA,
        uint256 tokenIdB,
        address partyA,
        address partyB,
        uint256 totalFee
    );
    event ProposalCancelled(uint256 indexed proposalId);
    event FeeConfigUpdated(uint256 fixedFeeETH, uint256 platformShareBps);
    event PlatformWalletUpdated(address newWallet);
    event Withdrawn(address indexed account, uint256 amount);

    constructor(
        address _nft,
        address _platformWallet,
        uint256 _fixedFeeETH,
        uint256 _platformShareBps,
        uint256 _proposalTTL
    ) Ownable(msg.sender) {
        require(_nft != address(0) && _platformWallet != address(0), "Invalid address");
        require(_platformShareBps <= BPS, "Share > 100%");
        nft = TicketNFT(_nft);
        platformWallet = _platformWallet;
        fixedFeeETH = _fixedFeeETH;
        platformShareBps = _platformShareBps;
        proposalTTL = _proposalTTL > 0 ? _proposalTTL : 300; // default 5 min
    }

    // ─── Owner admin ───────────────────────────────────────────────────────────

    function setFeeConfig(uint256 _fixedFeeETH, uint256 _platformShareBps) external onlyOwner {
        require(_platformShareBps <= BPS, "Share > 100%");
        fixedFeeETH = _fixedFeeETH;
        platformShareBps = _platformShareBps;
        emit FeeConfigUpdated(_fixedFeeETH, _platformShareBps);
    }

    function setProposalTTL(uint256 _ttl) external onlyOwner {
        proposalTTL = _ttl;
    }

    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid wallet");
        platformWallet = _wallet;
        emit PlatformWalletUpdated(_wallet);
    }

    // ─── Propose swap ──────────────────────────────────────────────────────────

    /// Proposer pays fixedFeeETH. Accepter pays the same amount at acceptSwap.
    /// Total fee distributed = 2 * fixedFeeETH.
    function proposeSwap(uint256 tokenIdA, uint256 tokenIdB)
        external
        payable
        returns (uint256 proposalId)
    {
        require(nft.ownerOf(tokenIdA) == msg.sender, "Not owner of tokenA");
        require(nft.ownerOf(tokenIdB) != msg.sender, "Cannot swap with yourself");
        require(
            nft.getApproved(tokenIdA) == address(this) || nft.isApprovedForAll(msg.sender, address(this)),
            "TokenA not approved"
        );
        require(msg.value == fixedFeeETH, "Wrong fee amount");

        proposalId = _nextProposalId++;
        proposals[proposalId] = Proposal({
            proposer: msg.sender,
            tokenIdA: tokenIdA,
            tokenIdB: tokenIdB,
            feePerParty: fixedFeeETH,
            expiresAt: block.timestamp + proposalTTL,
            active: true
        });

        emit SwapProposed(proposalId, msg.sender, tokenIdA, tokenIdB);
    }

    function cancelProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.active, "Not active");
        require(p.proposer == msg.sender, "Not proposer");
        p.active = false;

        // Pull-payment: store refund so a proposer contract cannot grief its own cancel
        pendingWithdrawals[msg.sender] += p.feePerParty;

        emit ProposalCancelled(proposalId);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ─── Accept swap ───────────────────────────────────────────────────────────

    /// Accepter also pays fixedFeeETH (locked at proposal time as p.feePerParty).
    function acceptSwap(uint256 proposalId) external payable nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.active, "Not active");
        require(block.timestamp <= p.expiresAt, "Proposal expired");
        require(nft.ownerOf(p.tokenIdB) == msg.sender, "Not owner of tokenB");
        require(
            nft.getApproved(p.tokenIdB) == address(this) || nft.isApprovedForAll(msg.sender, address(this)),
            "TokenB not approved"
        );
        require(msg.value == p.feePerParty, "Wrong fee amount");

        p.active = false;

        address partyA = p.proposer;
        address partyB = msg.sender;
        uint256 tokenIdA = p.tokenIdA;
        uint256 tokenIdB = p.tokenIdB;
        uint256 totalFee = p.feePerParty * 2;

        // Atomic NFT swap
        nft.transferFrom(partyA, partyB, tokenIdA);
        nft.transferFrom(partyB, partyA, tokenIdB);

        _distributeFee(tokenIdA, tokenIdB, totalFee);

        emit TicketsSwapped(proposalId, tokenIdA, tokenIdB, partyA, partyB, totalFee);
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    function _distributeFee(uint256 tokenIdA, uint256 tokenIdB, uint256 totalFee) internal {
        if (totalFee == 0) return;

        TicketNFT.TicketMetadata memory metaA = nft.getTicketData(tokenIdA);
        TicketNFT.TicketMetadata memory metaB = nft.getTicketData(tokenIdB);

        uint256 platformShare = (totalFee * platformShareBps) / BPS;
        uint256 remainderFee = totalFee - platformShare;

        uint256 org1Share = remainderFee / 2;
        uint256 org2Share = remainderFee - org1Share;

        _payETH(metaA.organizer, org1Share);
        _payETH(metaB.organizer, org2Share);
        _payETH(platformWallet, platformShare);
    }

    // Pull-payment: accumulate so a reverting organizer/platform cannot grief the swap.
    function _payETH(address to, uint256 amount) internal {
        if (amount == 0) return;
        pendingWithdrawals[to] += amount;
    }

    /// Returns the fee each party must pay (total fee = 2x this value).
    function quoteFee(uint256 /*tokenIdA*/, uint256 /*tokenIdB*/) external view returns (uint256) {
        return fixedFeeETH;
    }
}
