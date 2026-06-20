// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Deployed once per event by TicketSale. Set as the ERC-2981 royaltyReceiver
/// so that external marketplaces (OpenSea, Blur, etc.) send royalties here and the
/// split between organizer and platform happens automatically on-chain.
contract RoyaltySplitter {
    using SafeERC20 for IERC20;

    address public immutable organizer;
    address public immutable platform;
    uint256 public immutable organizerShareBps; // e.g. 7000 = 70%

    uint256 private constant BPS = 10_000;

    mapping(address => uint256) public pendingWithdrawals;

    event RoyaltyReceived(address indexed token, uint256 total, uint256 toOrganizer, uint256 toPlatform);
    event Withdrawn(address indexed account, uint256 amount);

    constructor(address _organizer, address _platform, uint256 _organizerShareBps) {
        require(_organizer != address(0) && _platform != address(0), "Invalid address");
        require(_organizerShareBps <= BPS, "Share > 100%");
        organizer = _organizer;
        platform = _platform;
        organizerShareBps = _organizerShareBps;
    }

    // ─── ETH ───────────────────────────────────────────────────────────────────

    /// Auto-splits any incoming ETH immediately between organizer and platform.
    receive() external payable {
        _splitETH(msg.value);
    }

    // Pull-payment: accumulate so a reverting organizer/platform cannot grief incoming royalties.
    function _splitETH(uint256 total) internal {
        if (total == 0) return;
        uint256 toOrganizer = (total * organizerShareBps) / BPS;
        uint256 toPlatform = total - toOrganizer;
        pendingWithdrawals[organizer] += toOrganizer;
        pendingWithdrawals[platform] += toPlatform;
        emit RoyaltyReceived(address(0), total, toOrganizer, toPlatform);
    }

    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ─── ERC-20 ────────────────────────────────────────────────────────────────

    /// Some marketplaces pay royalties in ERC-20 (e.g. WETH). Since ERC-20
    /// transfers don't trigger receive(), anyone can call this to flush the balance.
    function releaseERC20(address token) external {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "Nothing to release");

        uint256 toOrganizer = (balance * organizerShareBps) / BPS;
        uint256 toPlatform = balance - toOrganizer;

        IERC20(token).safeTransfer(organizer, toOrganizer);
        IERC20(token).safeTransfer(platform, toPlatform);

        emit RoyaltyReceived(token, balance, toOrganizer, toPlatform);
    }
}
