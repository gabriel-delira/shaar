// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TicketNFT.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

contract TicketNFTTest is Test {
    TicketNFT public nft;

    address public admin    = makeAddr("admin");
    address public minter   = makeAddr("minter");
    address public operator = makeAddr("operator");
    address public buyer    = makeAddr("buyer");
    address public organizer = makeAddr("organizer");

    string public constant BASE_URI = "https://api.platform.com/tickets/";

    function setUp() public {
        vm.startPrank(admin);
        nft = new TicketNFT();
        nft.grantMinter(minter);
        nft.grantOperator(operator);
        nft.setBaseURI(BASE_URI);
        vm.stopPrank();
    }

    function _mintParams(address to) internal view returns (TicketNFT.MintParams memory) {
        return TicketNFT.MintParams({
            to:             to,
            eventId:        1,
            eventName:      "Test Event",
            ticketNumber:   1,
            totalTickets:   100,
            seat:           "A1",
            eventTimestamp: block.timestamp + 7 days,
            organizer:      organizer,
            facePrice:      1 ether,
            royaltyReceiver: organizer,
            royaltyFeeBps:  500
        });
    }

    // ─── Mint ───────────────────────────────────────────────────────────────────

    function test_MintByMinter() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(tokenId, 0);
    }

    function test_MintStoresMetadata() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        (
            uint256 eventId,
            string memory eventName,
            uint256 ticketNumber,
            uint256 totalTickets,
            string memory seat,
            ,
            address org,
            uint256 facePrice
        ) = nft.ticketData(tokenId);

        assertEq(eventId, 1);
        assertEq(eventName, "Test Event");
        assertEq(ticketNumber, 1);
        assertEq(totalTickets, 100);
        assertEq(seat, "A1");
        assertEq(org, organizer);
        assertEq(facePrice, 1 ether);
    }

    function test_MintIncreasesTokenId() public {
        vm.startPrank(minter);
        uint256 id0 = nft.mint(_mintParams(buyer));
        uint256 id1 = nft.mint(_mintParams(buyer));
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
    }

    function test_MintByNonMinter_Reverts() public {
        vm.prank(buyer);
        vm.expectRevert();
        nft.mint(_mintParams(buyer));
    }

    function test_GrantAndRevokeMinter() public {
        address newMinter = makeAddr("newMinter");

        vm.prank(admin);
        nft.grantMinter(newMinter);

        vm.prank(newMinter);
        nft.mint(_mintParams(buyer));

        vm.prank(admin);
        nft.revokeMinter(newMinter);

        vm.prank(newMinter);
        vm.expectRevert();
        nft.mint(_mintParams(buyer));
    }

    // ─── Royalties ──────────────────────────────────────────────────────────────

    function test_RoyaltyInfo() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        (address receiver, uint256 royaltyAmount) = nft.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, organizer);
        assertEq(royaltyAmount, 0.05 ether); // 5%
    }

    // ─── URI dinâmica (pré-evento) ───────────────────────────────────────────────

    function test_TokenURI_UsesBaseURI() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        // baseURI + tokenId (0-indexed, global)
        assertEq(nft.tokenURI(tokenId), string.concat(BASE_URI, "0"));
    }

    function test_TokenURI_SecondToken() public {
        vm.startPrank(minter);
        nft.mint(_mintParams(buyer));
        uint256 tokenId1 = nft.mint(_mintParams(buyer));
        vm.stopPrank();

        assertEq(nft.tokenURI(tokenId1), string.concat(BASE_URI, "1"));
    }

    // ─── Freeze (pós-evento) ─────────────────────────────────────────────────────

    function test_FreezeFixesURI() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        string memory ipfsCID = "ipfs://QmFinalMetadata";
        vm.prank(operator);
        nft.freeze(tokenId, ipfsCID);

        assertEq(nft.tokenURI(tokenId), ipfsCID);
        assertTrue(nft.frozen(tokenId));
    }

    function test_FreezeEmitsEvent() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        string memory ipfsCID = "ipfs://QmFinalMetadata";
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit TicketNFT.Frozen(tokenId, ipfsCID);
        nft.freeze(tokenId, ipfsCID);
    }

    function test_CannotFreezeAlreadyFrozen() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        vm.startPrank(operator);
        nft.freeze(tokenId, "ipfs://first");
        vm.expectRevert(abi.encodeWithSelector(TicketNFT.AlreadyFrozen.selector, tokenId));
        nft.freeze(tokenId, "ipfs://second");
        vm.stopPrank();
    }

    function test_OnlyOperatorCanFreeze() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        vm.prank(buyer);
        vm.expectRevert();
        nft.freeze(tokenId, "ipfs://attempt");
    }

    // ─── Soulbound após freeze ────────────────────────────────────────────────────

    function test_FrozenToken_TransferReverts() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        vm.prank(operator);
        nft.freeze(tokenId, "ipfs://final");

        address recipient = makeAddr("recipient");
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(TicketNFT.TokenFrozen.selector, tokenId));
        nft.transferFrom(buyer, recipient, tokenId);
    }

    function test_FrozenToken_SafeTransferReverts() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        vm.prank(operator);
        nft.freeze(tokenId, "ipfs://final");

        address recipient = makeAddr("recipient");
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(TicketNFT.TokenFrozen.selector, tokenId));
        nft.safeTransferFrom(buyer, recipient, tokenId);
    }

    function test_NonFrozenToken_TransferSucceeds() public {
        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        address recipient = makeAddr("recipient");
        vm.prank(buyer);
        nft.transferFrom(buyer, recipient, tokenId);

        assertEq(nft.ownerOf(tokenId), recipient);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────

    function test_SetBaseURI() public {
        vm.prank(admin);
        nft.setBaseURI("https://new.api.com/tickets/");

        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        assertEq(nft.tokenURI(tokenId), "https://new.api.com/tickets/0");
    }

    function test_GrantAndRevokeOperator() public {
        address newOperator = makeAddr("newOp");

        vm.prank(admin);
        nft.grantOperator(newOperator);

        vm.prank(minter);
        uint256 tokenId = nft.mint(_mintParams(buyer));

        vm.prank(newOperator);
        nft.freeze(tokenId, "ipfs://ok"); // should succeed

        vm.prank(admin);
        nft.revokeOperator(newOperator);

        vm.prank(minter);
        uint256 tokenId2 = nft.mint(_mintParams(buyer));

        vm.prank(newOperator);
        vm.expectRevert();
        nft.freeze(tokenId2, "ipfs://fail");
    }

    // ─── ERC-165 ─────────────────────────────────────────────────────────────────

    function test_SupportsERC165Interfaces() public view {
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC2981).interfaceId));
        assertTrue(nft.supportsInterface(type(IAccessControl).interfaceId));
    }
}
