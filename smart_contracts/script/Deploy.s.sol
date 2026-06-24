// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/MockUSDC.sol";
import "../src/TicketNFTLocked.sol";
import "../src/TicketSale.sol";
import "../src/TicketResale.sol";

contract Deploy is Script {
    // Anvil default accounts (only used when CHAIN_ENV=local)
    address constant ANVIL_OWNER    = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant ANVIL_TREASURY = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    uint256 constant TREASURY_USDC = 1_000_000 * 1e6;

    function run() external {
        bool isLocal = keccak256(bytes(vm.envOr("CHAIN_ENV", string("local")))) == keccak256(bytes("local"));

        address platformWallet = vm.envOr("PLATFORM_WALLET", isLocal ? ANVIL_OWNER    : address(0));
        address treasury       = vm.envOr("TREASURY_WALLET", isLocal ? ANVIL_TREASURY : address(0));
        require(platformWallet != address(0), "Set PLATFORM_WALLET for non-local deploy");
        require(treasury       != address(0), "Set TREASURY_WALLET for non-local deploy");

        uint256 resaleFeeBps = vm.envOr("RESALE_FEE_BPS", uint256(500));

        vm.startBroadcast();

        // ── USDC ──────────────────────────────────────────────────────────────────
        address usdcAddr;
        if (isLocal) {
            MockUSDC usdc = new MockUSDC();
            usdc.mint(treasury, TREASURY_USDC);
            usdcAddr = address(usdc);
            console.log("MockUSDC deployed at:     ", usdcAddr);
        } else {
            usdcAddr = vm.envAddress("USDC_ADDRESS");
            console.log("Using USDC at:            ", usdcAddr);
        }

        // ── Core contracts ────────────────────────────────────────────────────────
        TicketNFTLocked nft = new TicketNFTLocked();
        console.log("TicketNFTLocked deployed at:", address(nft));

        TicketSale sale = new TicketSale(address(nft), platformWallet);
        console.log("TicketSale deployed at:   ", address(sale));

        TicketResale resale = new TicketResale(address(nft), platformWallet, resaleFeeBps);
        console.log("TicketResale deployed at: ", address(resale));

        // ── Roles ─────────────────────────────────────────────────────────────────
        nft.grantRole(nft.MINTER_ROLE(),   address(sale));
        nft.grantRole(nft.OPERATOR_ROLE(), platformWallet);
        console.log("MINTER_ROLE  → TicketSale");
        console.log("OPERATOR_ROLE → platformWallet:", platformWallet);

        // ── Authorized transferors (TicketNFTLocked) ──────────────────────────────
        // Apenas contratos da plataforma podem mover NFTs; transfers diretos revertam.
        nft.grantTransferor(address(sale));
        nft.grantTransferor(address(resale));
        console.log("authorizedTransferor → TicketSale");
        console.log("authorizedTransferor → TicketResale");
        // Se TicketSwap for deployado: nft.grantTransferor(address(swap));

        // ── baseURI ───────────────────────────────────────────────────────────────
        string memory baseURI = vm.envOr("BASE_URI", string("http://localhost:3000/api/metadata/"));
        nft.setBaseURI(baseURI);
        console.log("baseURI set to:", baseURI);

        // ── Settler ───────────────────────────────────────────────────────────────
        resale.setSettler(treasury);
        console.log("TicketResale settler →", treasury);

        // ── Non-local: transfer ownership to Server Wallets, renounce deployer ────
        // Deployer is a throwaway key. Operational control moves to Privy Server Wallets.
        if (!isLocal) {
            nft.grantRole(nft.DEFAULT_ADMIN_ROLE(), platformWallet);
            nft.renounceRole(nft.DEFAULT_ADMIN_ROLE(), msg.sender);
            sale.transferOwnership(platformWallet);
            resale.transferOwnership(platformWallet);
            console.log("Ownership transferred to platformWallet:", platformWallet);
            console.log("Deployer DEFAULT_ADMIN_ROLE renounced.");
        }

        vm.stopBroadcast();

        // ── Local only: treasury pre-approves USDC spend ──────────────────────────
        if (isLocal) {
            vm.startBroadcast(vm.envOr("TREASURY_PRIVATE_KEY",
                bytes32(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a)));
            IERC20(usdcAddr).approve(address(sale),   type(uint256).max);
            IERC20(usdcAddr).approve(address(resale), type(uint256).max);
            console.log("Treasury approved TicketSale + TicketResale for max USDC");
            vm.stopBroadcast();
        } else {
            console.log("");
            console.log("NEXT STEP: POST /api/admin/setup-approvals to approve treasury USDC spend.");
        }

        // ── Write addresses ───────────────────────────────────────────────────────
        string memory chainEnv = vm.envOr("CHAIN_ENV", string("local"));
        string memory outFile  = string.concat("../app/lib/contracts/addresses.", chainEnv, ".json");
        string memory json = string.concat(
            '{"usdc":"',    vm.toString(usdcAddr),
            '","nft":"',    vm.toString(address(nft)),
            '","sale":"',   vm.toString(address(sale)),
            '","resale":"', vm.toString(address(resale)),
            '"}'
        );
        vm.writeFile(outFile, json);
        console.log("Addresses written to", outFile);
    }
}
