// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TicketNFT.sol";
import "../src/TicketSale.sol";
import "../src/TicketSwap.sol";

contract TicketSwapTest is Test {
    TicketNFT public nft;
    TicketSale public sale;
    TicketSwap public swap;

    address public owner = makeAddr("owner");
    address public platform = makeAddr("platform");
    address public organizer = makeAddr("organizer");
    address public partyA = makeAddr("partyA");
    address public partyB = makeAddr("partyB");

    uint256 public constant FIXED_FEE = 0.01 ether;     // fee per party
    uint256 public constant PLATFORM_SHARE_BPS = 5000;  // 50% of total fee to platform
    uint256 public constant TTL = 1 days;
    uint256 public constant TICKET_PRICE = 1 ether;

    uint256 public tokenA;
    uint256 public tokenB;

    function setUp() public {
        vm.startPrank(owner);
        nft = new TicketNFT();
        sale = new TicketSale(address(nft), platform);
        swap = new TicketSwap(
            address(nft),
            platform,
            FIXED_FEE,
            PLATFORM_SHARE_BPS,
            TTL
        );
        nft.grantMinter(address(sale));

        uint256 eventId = sale.createEvent(
            organizer, TICKET_PRICE, address(0), 1000, 10, "Swap Event",
            block.timestamp + 30 days, "GA", 500, 7000
        );
        vm.stopPrank();

        vm.deal(partyA, 10 ether);
        vm.deal(partyB, 10 ether);

        vm.prank(partyA);
        tokenA = sale.buyTicket{value: TICKET_PRICE}(eventId);

        vm.prank(partyB);
        tokenB = sale.buyTicket{value: TICKET_PRICE}(eventId);
    }

    function test_QuoteFee() public view {
        uint256 fee = swap.quoteFee(tokenA, tokenB);
        assertEq(fee, FIXED_FEE);
    }

    function test_ProposeAndAcceptSwap() public {
        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        uint256 proposalId = swap.proposeSwap{value: FIXED_FEE}(tokenA, tokenB);

        assertEq(nft.ownerOf(tokenA), partyA); // still partyA's before accept

        vm.prank(partyB);
        nft.approve(address(swap), tokenB);
        vm.prank(partyB);
        swap.acceptSwap{value: FIXED_FEE}(proposalId);

        // Atomic swap occurred
        assertEq(nft.ownerOf(tokenA), partyB);
        assertEq(nft.ownerOf(tokenB), partyA);
    }

    function test_ProposeSwap_WrongFee_Reverts() public {
        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        vm.expectRevert("Wrong fee amount");
        swap.proposeSwap{value: 0.001 ether}(tokenA, tokenB);
    }

    function test_AcceptSwap_WrongFee_Reverts() public {
        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        uint256 proposalId = swap.proposeSwap{value: FIXED_FEE}(tokenA, tokenB);

        vm.prank(partyB);
        nft.approve(address(swap), tokenB);
        vm.prank(partyB);
        vm.expectRevert("Wrong fee amount");
        swap.acceptSwap{value: 0 ether}(proposalId);
    }

    function test_CancelProposal_RefundsFee() public {
        uint256 before = partyA.balance;

        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        uint256 proposalId = swap.proposeSwap{value: FIXED_FEE}(tokenA, tokenB);

        vm.prank(partyA);
        swap.cancelProposal(proposalId);

        // Refund is held as pull-payment; the proposer withdraws it back.
        vm.prank(partyA);
        swap.withdraw();

        assertEq(partyA.balance, before); // fee refunded
    }

    function test_AcceptAfterExpiry_Reverts() public {
        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        uint256 proposalId = swap.proposeSwap{value: FIXED_FEE}(tokenA, tokenB);

        vm.warp(block.timestamp + TTL + 1);

        vm.prank(partyB);
        nft.approve(address(swap), tokenB);
        vm.prank(partyB);
        vm.expectRevert("Proposal expired");
        swap.acceptSwap{value: FIXED_FEE}(proposalId);
    }

    function test_AcceptByNonOwnerOfTokenB_Reverts() public {
        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        uint256 proposalId = swap.proposeSwap{value: FIXED_FEE}(tokenA, tokenB);

        address rando = makeAddr("rando");
        vm.deal(rando, 1 ether);
        vm.prank(rando);
        vm.expectRevert("Not owner of tokenB");
        swap.acceptSwap{value: FIXED_FEE}(proposalId);
    }

    function test_FeeSplit_ToOrganizerAndPlatform() public {
        uint256 orgBefore = organizer.balance;
        uint256 platformBefore = platform.balance;

        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        uint256 proposalId = swap.proposeSwap{value: FIXED_FEE}(tokenA, tokenB);

        vm.prank(partyB);
        nft.approve(address(swap), tokenB);
        vm.prank(partyB);
        swap.acceptSwap{value: FIXED_FEE}(proposalId);

        // Total fee = 2 * FIXED_FEE = 0.02 ETH
        uint256 totalFee = 2 * FIXED_FEE;
        uint256 platformShare = (totalFee * PLATFORM_SHARE_BPS) / 10_000;
        uint256 remainder = totalFee - platformShare;
        uint256 org1 = remainder / 2;
        uint256 org2 = remainder - org1;

        // Swap fees are escrowed (pull-payment); organizer/platform withdraw their cut.
        vm.prank(organizer);
        swap.withdraw();
        vm.prank(platform);
        swap.withdraw();

        // Both tickets are from the same organizer
        assertEq(platform.balance - platformBefore, platformShare);
        assertEq(organizer.balance - orgBefore, org1 + org2);
    }

    function test_ProposeSwap_WithOwnToken_Reverts() public {
        // Buy a second ticket for partyA
        vm.prank(partyA);
        uint256 tokenA2 = sale.buyTicket{value: TICKET_PRICE}(0);

        vm.prank(partyA);
        nft.approve(address(swap), tokenA);
        vm.prank(partyA);
        vm.expectRevert("Cannot swap with yourself");
        swap.proposeSwap{value: FIXED_FEE}(tokenA, tokenA2);
    }
}
