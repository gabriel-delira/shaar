// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RoyaltySplitter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 10_000e18);
    }
}

/// Dedicated unit tests for RoyaltySplitter — previously only covered indirectly
/// via TicketSale. Validates the ERC-2981 royalty split + pull-payment invariants
/// (CONTEXT.md / smart_contracts/CLAUDE.md): organizer/platform shares by BPS,
/// pull-payment accumulation so a reverting recipient cannot grief the other.
contract RoyaltySplitterTest is Test {
    RoyaltySplitter public splitter;
    MockToken public token;

    address public organizer = makeAddr("organizer");
    address public platform = makeAddr("platform");
    address public stranger = makeAddr("stranger");

    uint256 public constant ORG_SHARE_BPS = 7000; // 70% organizer / 30% platform

    event RoyaltyReceived(address indexed token, uint256 total, uint256 toOrganizer, uint256 toPlatform);
    event Withdrawn(address indexed account, uint256 amount);
    event WithdrawnERC20(address indexed account, address indexed token, uint256 amount);

    function setUp() public {
        splitter = new RoyaltySplitter(organizer, platform, ORG_SHARE_BPS);
        token = new MockToken();
    }

    // ─── Constructor ────────────────────────────────────────────────────────────

    function test_Constructor_StoresParams() public view {
        assertEq(splitter.organizer(), organizer);
        assertEq(splitter.platform(), platform);
        assertEq(splitter.organizerShareBps(), ORG_SHARE_BPS);
    }

    function test_Constructor_RevertsOnZeroOrganizer() public {
        vm.expectRevert("Invalid address");
        new RoyaltySplitter(address(0), platform, ORG_SHARE_BPS);
    }

    function test_Constructor_RevertsOnZeroPlatform() public {
        vm.expectRevert("Invalid address");
        new RoyaltySplitter(organizer, address(0), ORG_SHARE_BPS);
    }

    function test_Constructor_RevertsOnShareAboveHundredPercent() public {
        vm.expectRevert("Share > 100%");
        new RoyaltySplitter(organizer, platform, 10_001);
    }

    // ─── ETH split (receive / withdraw) ─────────────────────────────────────────

    function test_ReceiveETH_SplitsByBps() public {
        vm.expectEmit(true, false, false, true);
        emit RoyaltyReceived(address(0), 1 ether, 0.7 ether, 0.3 ether);
        (bool ok,) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);

        assertEq(splitter.pendingWithdrawals(organizer), 0.7 ether);
        assertEq(splitter.pendingWithdrawals(platform), 0.3 ether);
    }

    function test_ReceiveETH_Accumulates() public {
        (bool a,) = address(splitter).call{value: 1 ether}("");
        (bool b,) = address(splitter).call{value: 1 ether}("");
        assertTrue(a && b);
        assertEq(splitter.pendingWithdrawals(organizer), 1.4 ether);
        assertEq(splitter.pendingWithdrawals(platform), 0.6 ether);
    }

    function test_Withdraw_TransfersAndZeroes() public {
        (bool ok,) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);

        uint256 before = organizer.balance;
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(organizer, 0.7 ether);
        vm.prank(organizer);
        splitter.withdraw();

        assertEq(organizer.balance - before, 0.7 ether);
        assertEq(splitter.pendingWithdrawals(organizer), 0);
    }

    function test_Withdraw_RevertsWhenNothingPending() public {
        vm.prank(stranger);
        vm.expectRevert("Nothing to withdraw");
        splitter.withdraw();
    }

    /// Pull-payment: a reverting organizer cannot block the platform's share.
    function test_Withdraw_RevertingRecipientDoesNotGriefOther() public {
        RevertingReceiver badOrg = new RevertingReceiver();
        RoyaltySplitter s = new RoyaltySplitter(address(badOrg), platform, ORG_SHARE_BPS);
        (bool ok,) = address(s).call{value: 1 ether}("");
        assertTrue(ok);

        // Organizer withdrawal fails...
        vm.prank(address(badOrg));
        vm.expectRevert("Withdraw failed");
        s.withdraw();

        // ...but the platform can still withdraw its share.
        uint256 before = platform.balance;
        vm.prank(platform);
        s.withdraw();
        assertEq(platform.balance - before, 0.3 ether);
    }

    // ─── ERC-20 split (releaseERC20 / withdrawERC20) ────────────────────────────

    function test_ReleaseERC20_SplitsBalanceByBps() public {
        token.transfer(address(splitter), 1_000e18);

        vm.expectEmit(true, false, false, true);
        emit RoyaltyReceived(address(token), 1_000e18, 700e18, 300e18);
        splitter.releaseERC20(address(token));

        assertEq(splitter.pendingERC20(organizer, address(token)), 700e18);
        assertEq(splitter.pendingERC20(platform, address(token)), 300e18);
    }

    function test_ReleaseERC20_RevertsWhenNoBalance() public {
        vm.expectRevert("Nothing to release");
        splitter.releaseERC20(address(token));
    }

    function test_WithdrawERC20_TransfersAndZeroes() public {
        token.transfer(address(splitter), 1_000e18);
        splitter.releaseERC20(address(token));

        vm.expectEmit(true, true, false, true);
        emit WithdrawnERC20(organizer, address(token), 700e18);
        vm.prank(organizer);
        splitter.withdrawERC20(address(token));

        assertEq(token.balanceOf(organizer), 700e18);
        assertEq(splitter.pendingERC20(organizer, address(token)), 0);
    }

    function test_WithdrawERC20_RevertsWhenNothingPending() public {
        vm.prank(stranger);
        vm.expectRevert("Nothing to withdraw");
        splitter.withdrawERC20(address(token));
    }

    /// Anyone may flush the balance; the split still credits only org/platform.
    function test_ReleaseERC20_CallableByAnyone() public {
        token.transfer(address(splitter), 100e18);
        vm.prank(stranger);
        splitter.releaseERC20(address(token));
        assertEq(splitter.pendingERC20(organizer, address(token)), 70e18);
    }
}

/// Helper: an account that rejects incoming ETH, to prove pull-payment isolation.
contract RevertingReceiver {
    receive() external payable {
        revert("no ETH");
    }
}
