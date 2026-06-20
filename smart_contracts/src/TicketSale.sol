// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./TicketNFT.sol";
import "./RoyaltySplitter.sol";

contract TicketSale is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    TicketNFT public immutable nft;
    address public platformWallet;

    struct Event {
        address organizer;
        uint256 ticketPrice;          // in token units (or wei for ETH)
        address paymentToken;         // address(0) = ETH
        uint256 platformFeeBps;       // primary-sale platform cut (basis points)
        uint256 maxTickets;
        uint256 soldTickets;
        bool paused;
        string eventName;
        uint256 eventTimestamp;
        string defaultSeat;
        // ERC-2981 royalty config
        uint96 royaltyBps;            // total royalty % charged by external marketplaces
        address royaltySplitter;      // RoyaltySplitter deployed for this event
    }

    uint256 private _nextEventId;
    mapping(uint256 => Event) public events;

    uint256 private constant BPS = 10_000;
    uint256 private constant SALE_GRACE_PERIOD = 2 hours;

    mapping(address => uint256) public pendingWithdrawals;

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        uint256 price,
        uint256 maxTickets,
        address royaltySplitter
    );
    event TicketSold(uint256 indexed eventId, address indexed buyer, uint256 indexed tokenId, uint256 amount);
    event EventPauseToggled(uint256 indexed eventId, bool paused);
    event PlatformWalletUpdated(address newWallet);
    event MaxTicketsUpdated(uint256 indexed eventId, uint256 newMax);
    event Withdrawn(address indexed account, uint256 amount);

    constructor(address _nft, address _platformWallet) Ownable(msg.sender) {
        require(_nft != address(0) && _platformWallet != address(0), "Invalid address");
        nft = TicketNFT(_nft);
        platformWallet = _platformWallet;
    }

    // ─── Owner admin ───────────────────────────────────────────────────────────

    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid wallet");
        platformWallet = _wallet;
        emit PlatformWalletUpdated(_wallet);
    }

    /// @param royaltyBps            Total royalty % that external marketplaces will pay (e.g. 500 = 5%)
    /// @param royaltyOrgShareBps    Organizer's cut of that royalty (e.g. 7000 = 70%, platform gets 30%)
    function createEvent(
        address organizer,
        uint256 ticketPrice,
        address paymentToken,
        uint256 platformFeeBps,
        uint256 maxTickets,
        string calldata eventName,
        uint256 eventTimestamp,
        string calldata defaultSeat,
        uint96 royaltyBps,
        uint256 royaltyOrgShareBps
    ) external onlyOwner returns (uint256 eventId) {
        require(organizer != address(0), "Invalid organizer");
        require(ticketPrice > 0, "Price must be > 0");
        require(platformFeeBps < BPS, "Fee too high");
        require(eventTimestamp > 0, "Invalid event timestamp");
        require(royaltyBps <= 1000, "Royalty max 10%"); // sane cap
        require(royaltyOrgShareBps <= BPS, "Org share > 100%");

        // Deploy one RoyaltySplitter per event
        RoyaltySplitter splitter = new RoyaltySplitter(organizer, platformWallet, royaltyOrgShareBps);

        eventId = _nextEventId++;
        events[eventId] = Event({
            organizer: organizer,
            ticketPrice: ticketPrice,
            paymentToken: paymentToken,
            platformFeeBps: platformFeeBps,
            maxTickets: maxTickets,
            soldTickets: 0,
            paused: false,
            eventName: eventName,
            eventTimestamp: eventTimestamp,
            defaultSeat: defaultSeat,
            royaltyBps: royaltyBps,
            royaltySplitter: address(splitter)
        });

        emit EventCreated(eventId, organizer, ticketPrice, maxTickets, address(splitter));
    }

    function toggleEventPause(uint256 eventId) external onlyOwner {
        events[eventId].paused = !events[eventId].paused;
        emit EventPauseToggled(eventId, events[eventId].paused);
    }

    function updatePlatformFee(uint256 eventId, uint256 newFeeBps) external onlyOwner {
        require(events[eventId].soldTickets == 0, "Sales already started");
        require(newFeeBps < BPS, "Fee too high");
        events[eventId].platformFeeBps = newFeeBps;
    }

    /// @notice Allows only increasing maxTickets or switching to unlimited (0).
    ///         Decreasing is not permitted to protect buyers who already purchased.
    function updateMaxTickets(uint256 eventId, uint256 newMax) external onlyOwner {
        Event storage ev = events[eventId];
        require(newMax == 0 || newMax > ev.maxTickets, "Can only increase max or set unlimited");
        ev.maxTickets = newMax;
        emit MaxTicketsUpdated(eventId, newMax);
    }

    // ─── Buy ───────────────────────────────────────────────────────────────────

    /// Crypto-direct flow: caller pays and receives the NFT.
    function buyTicket(uint256 eventId)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        return _buyTicket(eventId, msg.sender);
    }

    /// Fiat flow: caller (platform treasury) pays, NFT is minted to `recipient`.
    function buyTicketFor(uint256 eventId, address recipient)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        require(recipient != address(0), "Invalid recipient");
        return _buyTicket(eventId, recipient);
    }

    function _buyTicket(uint256 eventId, address recipient) internal returns (uint256 tokenId) {
        Event storage ev = events[eventId];
        require(!ev.paused, "Event sales paused");
        require(ev.maxTickets == 0 || ev.soldTickets < ev.maxTickets, "Sold out");
        require(block.timestamp < ev.eventTimestamp + SALE_GRACE_PERIOD, "Event has passed");

        uint256 ticketNumber = ev.soldTickets + 1;
        ev.soldTickets = ticketNumber;

        if (ev.paymentToken == address(0)) {
            require(msg.value == ev.ticketPrice, "Wrong ETH amount");
            _splitETH(ev.organizer, ev.platformFeeBps, ev.ticketPrice);
        } else {
            require(msg.value == 0, "ETH not accepted");
            IERC20(ev.paymentToken).safeTransferFrom(msg.sender, address(this), ev.ticketPrice);
            _splitERC20(ev.paymentToken, ev.organizer, ev.platformFeeBps, ev.ticketPrice);
        }

        tokenId = nft.mint(TicketNFT.MintParams({
            to: recipient,
            eventId: eventId,
            eventName: ev.eventName,
            ticketNumber: ticketNumber,
            totalTickets: ev.maxTickets,
            seat: ev.defaultSeat,
            eventTimestamp: ev.eventTimestamp,
            organizer: ev.organizer,
            facePrice: ev.ticketPrice,
            royaltyReceiver: ev.royaltySplitter,
            royaltyFeeBps: ev.royaltyBps
        }));

        emit TicketSold(eventId, recipient, tokenId, ev.ticketPrice);
    }

    // ─── Split helpers ─────────────────────────────────────────────────────────

    // Pull-payment: accumulate balances so a reverting organizer cannot grief the sale.
    function _splitETH(address organizer, uint256 platformFeeBps, uint256 total) internal {
        uint256 platformShare = (total * platformFeeBps) / BPS;
        uint256 organizerShare = total - platformShare;
        pendingWithdrawals[organizer] += organizerShare;
        if (platformShare > 0) {
            pendingWithdrawals[platformWallet] += platformShare;
        }
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    function _splitERC20(address token, address organizer, uint256 platformFeeBps, uint256 total) internal {
        uint256 platformShare = (total * platformFeeBps) / BPS;
        uint256 organizerShare = total - platformShare;

        IERC20(token).safeTransfer(organizer, organizerShare);
        if (platformShare > 0) {
            IERC20(token).safeTransfer(platformWallet, platformShare);
        }
    }
}
