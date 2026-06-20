// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TicketNFT.sol";
import "../src/TicketSale.sol";
import "../src/RoyaltySplitter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 10_000e18);
    }
}

contract TicketSaleTest is Test {
    TicketNFT public nft;
    TicketSale public sale;
    MockToken public usdc;

    address public owner = makeAddr("owner");
    address public platform = makeAddr("platform");
    address public organizer = makeAddr("organizer");
    address public buyer = makeAddr("buyer");

    uint256 public constant PRICE = 1 ether;
    uint256 public constant PLATFORM_FEE_BPS = 1000;  // 10%
    uint256 public constant MAX_TICKETS = 10;
    uint96  public constant ROYALTY_BPS = 500;         // 5% total royalty
    uint256 public constant ROYALTY_ORG_SHARE_BPS = 7000; // 70% to organizer, 30% to platform
    string  public constant BASE_URI = "https://api.platform.com/tickets/";

    uint256 public eventId;

    function setUp() public {
        vm.startPrank(owner);
        nft = new TicketNFT();
        sale = new TicketSale(address(nft), platform);
        nft.grantMinter(address(sale));
        nft.setBaseURI(BASE_URI);

        eventId = sale.createEvent(
            organizer,
            PRICE,
            address(0), // ETH
            PLATFORM_FEE_BPS,
            MAX_TICKETS,
            "Rock Concert",
            block.timestamp + 30 days,
            "General",
            ROYALTY_BPS,
            ROYALTY_ORG_SHARE_BPS
        );
        vm.stopPrank();

        vm.deal(buyer, 100 ether);
        usdc = new MockToken(); // minted to test contract (address(this))
    }

    // ─── Primary sale ──────────────────────────────────────────────────────────

    function test_BuyTicketETH() public {
        uint256 orgBefore = organizer.balance;
        uint256 platformBefore = platform.balance;

        vm.prank(buyer);
        uint256 tokenId = sale.buyTicket{value: PRICE}(eventId);

        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(organizer.balance - orgBefore, 0.9 ether);
        assertEq(platform.balance - platformBefore, 0.1 ether);
    }

    function test_BuyTicket_SoldOut_Reverts() public {
        for (uint256 i = 0; i < MAX_TICKETS; i++) {
            address b = makeAddr(string(abi.encodePacked("buyer", i)));
            vm.deal(b, 2 ether);
            vm.prank(b);
            sale.buyTicket{value: PRICE}(eventId);
        }

        vm.expectRevert("Sold out");
        vm.prank(buyer);
        sale.buyTicket{value: PRICE}(eventId);
    }

    function test_BuyTicket_WrongETHAmount_Reverts() public {
        vm.prank(buyer);
        vm.expectRevert("Wrong ETH amount");
        sale.buyTicket{value: 0.5 ether}(eventId);
    }

    function test_BuyTicket_PausedEvent_Reverts() public {
        vm.prank(owner);
        sale.toggleEventPause(eventId);

        vm.prank(buyer);
        vm.expectRevert("Event sales paused");
        sale.buyTicket{value: PRICE}(eventId);
    }

    function test_TicketMetadata_StoredCorrectly() public {
        vm.prank(buyer);
        uint256 tokenId = sale.buyTicket{value: PRICE}(eventId);

        (uint256 eId,, uint256 num, uint256 total,,, address org, uint256 face) = nft.ticketData(tokenId);
        assertEq(eId, eventId);
        assertEq(num, 1);
        assertEq(total, MAX_TICKETS);
        assertEq(org, organizer);
        assertEq(face, PRICE);
    }

    function test_TokenURI_UsesGlobalBaseURI() public {
        vm.prank(buyer);
        uint256 tokenId = sale.buyTicket{value: PRICE}(eventId);

        // tokenId = 0 (first ever mint) → URI = BASE_URI + "0"
        assertEq(nft.tokenURI(tokenId), string.concat(BASE_URI, "0"));
    }

    function test_TicketNumberIncrements() public {
        vm.prank(buyer);
        uint256 t1 = sale.buyTicket{value: PRICE}(eventId);

        address buyer2 = makeAddr("buyer2");
        vm.deal(buyer2, 2 ether);
        vm.prank(buyer2);
        uint256 t2 = sale.buyTicket{value: PRICE}(eventId);

        (,, uint256 num1,,,,,) = nft.ticketData(t1);
        (,, uint256 num2,,,,,) = nft.ticketData(t2);
        assertEq(num1, 1);
        assertEq(num2, 2);
    }

    function test_BuyTicketERC20() public {
        usdc.transfer(buyer, 100e18);
        vm.startPrank(owner);
        uint256 usdcEventId = sale.createEvent(
            organizer,
            100e18,
            address(usdc),
            PLATFORM_FEE_BPS,
            10,
            "USDC Concert",
            block.timestamp + 30 days,
            "General",
            ROYALTY_BPS,
            ROYALTY_ORG_SHARE_BPS
        );
        vm.stopPrank();

        vm.startPrank(buyer);
        usdc.approve(address(sale), 100e18);
        sale.buyTicket(usdcEventId);
        vm.stopPrank();

        assertEq(usdc.balanceOf(organizer), 90e18);
        assertEq(usdc.balanceOf(platform), 10e18);
    }

    // ─── buyTicketFor (fiat flow: treasury pays, recipient receives) ────────────

    function test_BuyTicketFor_MintsToRecipient() public {
        address treasury = makeAddr("treasury");
        address recipient = makeAddr("recipient");
        vm.deal(treasury, 10 ether);

        uint256 orgBefore = organizer.balance;
        uint256 platformBefore = platform.balance;

        vm.prank(treasury);
        uint256 tid = sale.buyTicketFor{value: PRICE}(eventId, recipient);

        assertEq(nft.ownerOf(tid), recipient);
        assertEq(organizer.balance - orgBefore, 0.9 ether);
        assertEq(platform.balance - platformBefore, 0.1 ether);
    }

    function test_BuyTicketFor_ERC20_PaidByCaller() public {
        address treasury = makeAddr("treasury");
        address recipient = makeAddr("recipient");
        usdc.transfer(treasury, 100e18);

        vm.startPrank(owner);
        uint256 usdcEventId = sale.createEvent(
            organizer,
            100e18,
            address(usdc),
            PLATFORM_FEE_BPS,
            10,
            "USDC Concert",
            block.timestamp + 30 days,
            "General",
            ROYALTY_BPS,
            ROYALTY_ORG_SHARE_BPS
        );
        vm.stopPrank();

        vm.startPrank(treasury);
        usdc.approve(address(sale), 100e18);
        uint256 tid = sale.buyTicketFor(usdcEventId, recipient);
        vm.stopPrank();

        assertEq(nft.ownerOf(tid), recipient);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(usdc.balanceOf(organizer), 90e18);
        assertEq(usdc.balanceOf(platform), 10e18);
    }

    function test_BuyTicketFor_ZeroRecipient_Reverts() public {
        vm.prank(buyer);
        vm.expectRevert("Invalid recipient");
        sale.buyTicketFor{value: PRICE}(eventId, address(0));
    }

    function test_UpdatePlatformFee_AfterSales_Reverts() public {
        vm.prank(buyer);
        sale.buyTicket{value: PRICE}(eventId);

        vm.prank(owner);
        vm.expectRevert("Sales already started");
        sale.updatePlatformFee(eventId, 500);
    }

    // ─── RoyaltySplitter ───────────────────────────────────────────────────────

    function test_RoyaltySplitter_DeployedPerEvent() public view {
        (,,,,,,,,,,, address splitterAddr) = sale.events(eventId);
        assertTrue(splitterAddr != address(0));
    }

    function test_RoyaltySplitter_SetAsRoyaltyReceiver() public {
        vm.prank(buyer);
        uint256 tokenId = sale.buyTicket{value: PRICE}(eventId);

        (,,,,,,,,,,, address splitterAddr) = sale.events(eventId);
        (address receiver,) = nft.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, splitterAddr);
    }

    function test_RoyaltySplitter_RoyaltyBps() public {
        vm.prank(buyer);
        uint256 tokenId = sale.buyTicket{value: PRICE}(eventId);

        // 5% royalty on a 10 ETH sale = 0.5 ETH
        (, uint256 royaltyAmount) = nft.royaltyInfo(tokenId, 10 ether);
        assertEq(royaltyAmount, 0.5 ether);
    }

    function test_RoyaltySplitter_SplitsETH() public {
        vm.prank(buyer);
        sale.buyTicket{value: PRICE}(eventId);

        (,,,,,,,,,,, address splitterAddr) = sale.events(eventId);
        RoyaltySplitter splitter = RoyaltySplitter(payable(splitterAddr));

        uint256 orgBefore = organizer.balance;
        uint256 platformBefore = platform.balance;

        // Simulate a marketplace sending 1 ETH royalty to the splitter
        vm.deal(address(this), 1 ether);
        (bool ok,) = splitterAddr.call{value: 1 ether}("");
        assertTrue(ok);

        // 70% to organizer, 30% to platform
        assertEq(organizer.balance - orgBefore, 0.7 ether);
        assertEq(platform.balance - platformBefore, 0.3 ether);

        assertEq(splitter.organizer(), organizer);
        assertEq(splitter.platform(), platform);
        assertEq(splitter.organizerShareBps(), ROYALTY_ORG_SHARE_BPS);
    }

    function test_RoyaltySplitter_SplitsERC20() public {
        vm.prank(buyer);
        sale.buyTicket{value: PRICE}(eventId);

        (,,,,,,,,,,, address splitterAddr) = sale.events(eventId);

        // Send 100 USDC to splitter (simulating marketplace ERC-20 royalty payment)
        usdc.transfer(splitterAddr, 100e18);

        uint256 orgBefore = usdc.balanceOf(organizer);
        uint256 platformBefore = usdc.balanceOf(platform);

        RoyaltySplitter(payable(splitterAddr)).releaseERC20(address(usdc));

        assertEq(usdc.balanceOf(organizer) - orgBefore, 70e18);   // 70%
        assertEq(usdc.balanceOf(platform) - platformBefore, 30e18); // 30%
    }

    function test_TwoEvents_HaveDifferentSplitters() public {
        vm.prank(owner);
        uint256 eventId2 = sale.createEvent(
            organizer, PRICE, address(0), PLATFORM_FEE_BPS, 5,
            "Second Show", block.timestamp + 60 days, "VIP",
            ROYALTY_BPS, ROYALTY_ORG_SHARE_BPS
        );

        (,,,,,,,,,,, address splitter1) = sale.events(eventId);
        (,,,,,,,,,,, address splitter2) = sale.events(eventId2);
        assertTrue(splitter1 != splitter2);
    }
}
