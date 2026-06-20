// On-chain event indexer — polls TicketSale + TicketNFT for new events and syncs the DB.
// Started once from instrumentation.ts (Node.js runtime only).

import { publicClient } from "@/lib/chain";
import { getAddresses } from "@/lib/contracts/addresses";
import { TICKET_SALE_ABI, TICKET_NFT_ABI, TICKET_RESALE_ABI } from "@/lib/contracts/abis";
import { prisma } from "@/lib/db";
import { getOnchainTicketNumber, unlockListingOnChain } from "@/lib/onchain";
import { psp } from "@/lib/psp";

const POLL_INTERVAL_MS      = 4_000;          // 4 s — fine for Anvil/Base (2 s block time)
const RECONCILE_INTERVAL_MS = 5 * 60 * 1_000; // 5 min
const BLOCK_BATCH           = 2_000n;

async function getLastBlock(contractAddress: string): Promise<bigint> {
  const state = await prisma.syncState.findUnique({ where: { contractAddress } });
  if (state) return state.lastProcessedBlock;
  const startBlock = process.env.INDEXER_START_BLOCK;
  if (startBlock) return BigInt(startBlock) - 1n;
  const current = await publicClient.getBlockNumber();
  return current - 1n;
}

async function setLastBlock(contractAddress: string, block: bigint) {
  await prisma.syncState.upsert({
    where:  { contractAddress },
    update: { lastProcessedBlock: block },
    create: { contractAddress, lastProcessedBlock: block },
  });
}

async function syncTicketSale(saleAddress: `0x${string}`) {
  const from = await getLastBlock(saleAddress);
  const head  = await publicClient.getBlockNumber();
  if (head <= from) return;

  const to = head < from + BLOCK_BATCH ? head : from + BLOCK_BATCH;

  const logs = await publicClient.getLogs({
    address:   saleAddress,
    event:     TICKET_SALE_ABI.find((x) => x.type === "event" && x.name === "TicketSold") as never,
    fromBlock: from + 1n,
    toBlock:   to,
  });

  for (const log of logs) {
    const { eventId, buyer, tokenId } = log.args as {
      eventId: bigint; buyer: string; tokenId: bigint; amount: bigint;
    };
    // Upsert the event's soldTickets cache (best-effort; source of truth is chain)
    await prisma.event.updateMany({
      where: { onchainEventId: Number(eventId) },
      data:  {},  // no-op: ticket count comes from tickets table
    });
    // Ensure ticket record exists (created by webhook handler; this is a safety net)
    const existing = await prisma.ticket.findUnique({ where: { tokenId: Number(tokenId) } });
    if (!existing) {
      const event = await prisma.event.findFirst({ where: { onchainEventId: Number(eventId) } });
      if (event) {
        // Authoritative, race-free ticket number from on-chain mint data.
        const ticketNumber = await getOnchainTicketNumber(Number(tokenId));
        await prisma.ticket.create({
          data: {
            tokenId:      Number(tokenId),
            eventId:      event.id,
            ownerAddress: buyer,
            ticketNumber,
            facePrice:    event.ticketPriceUsdc,
            status:       "VALID",
            mintTxHash:   log.transactionHash,
            mintedAt:     new Date(),
          },
        }).catch(() => {}); // ignore duplicate on race
      }
    }
  }

  await setLastBlock(saleAddress, to);
}

async function syncTicketNFT(nftAddress: `0x${string}`, resaleAddress: `0x${string}`) {
  const from = await getLastBlock(nftAddress);
  const head  = await publicClient.getBlockNumber();
  if (head <= from) return;

  const to = head < from + BLOCK_BATCH ? head : from + BLOCK_BATCH;

  // Sync Transfer events to keep ownerAddress up to date
  const transferLogs = await publicClient.getLogs({
    address:   nftAddress,
    event:     TICKET_NFT_ABI.find((x) => x.type === "event" && x.name === "Transfer") as never,
    fromBlock: from + 1n,
    toBlock:   to,
  });

  for (const log of transferLogs) {
    const { from: fromAddr, to: toAddr, tokenId } = log.args as {
      from: string; to: string; tokenId: bigint;
    };
    if (fromAddr === "0x0000000000000000000000000000000000000000") continue; // skip mints (handled by TicketSale)
    if (toAddr.toLowerCase() === resaleAddress.toLowerCase()) continue;   // skip escrow transfer on listing
    await prisma.ticket.updateMany({
      where: { tokenId: Number(tokenId) },
      data:  { ownerAddress: toAddr },
    });
  }

  await setLastBlock(nftAddress, to);
}

async function syncTicketResale(resaleAddress: `0x${string}`) {
  const from = await getLastBlock(resaleAddress);
  const head  = await publicClient.getBlockNumber();
  if (head <= from) return;

  const to = head < from + BLOCK_BATCH ? head : from + BLOCK_BATCH;

  // TicketListed — update onchainListingId on the matching DB Listing
  const listedLogs = await publicClient.getLogs({
    address:   resaleAddress,
    event:     TICKET_RESALE_ABI.find((x) => x.type === "event" && x.name === "TicketListed") as never,
    fromBlock: from + 1n,
    toBlock:   to,
  });
  for (const log of listedLogs) {
    const { listingId, tokenId } = log.args as { listingId: bigint; seller: string; tokenId: bigint; price: bigint };
    await prisma.listing.updateMany({
      where: { tokenId: Number(tokenId), onchainListingId: null, status: "ACTIVE" },
      data:  { onchainListingId: Number(listingId), txHash: log.transactionHash },
    });
  }

  // ListingCancelled — mark listing cancelled and return ticket to VALID
  const cancelledLogs = await publicClient.getLogs({
    address:   resaleAddress,
    event:     TICKET_RESALE_ABI.find((x) => x.type === "event" && x.name === "ListingCancelled") as never,
    fromBlock: from + 1n,
    toBlock:   to,
  });
  for (const log of cancelledLogs) {
    const { listingId } = log.args as { listingId: bigint };
    const listing = await prisma.listing.findFirst({ where: { onchainListingId: Number(listingId) } });
    if (listing) {
      await prisma.$transaction([
        prisma.listing.update({ where: { id: listing.id }, data: { status: "CANCELLED" } }),
        prisma.ticket.updateMany({ where: { tokenId: listing.tokenId, status: "LISTED" }, data: { status: "VALID" } }),
      ]);
    }
  }

  // TicketSettled — mark listing sold, update ticket owner (safety-net; webhook already handles this)
  const settledLogs = await publicClient.getLogs({
    address:   resaleAddress,
    event:     TICKET_RESALE_ABI.find((x) => x.type === "event" && x.name === "TicketSettled") as never,
    fromBlock: from + 1n,
    toBlock:   to,
  });
  for (const log of settledLogs) {
    const { listingId, recipient, tokenId } = log.args as { listingId: bigint; recipient: string; tokenId: bigint };
    const listing = await prisma.listing.findFirst({ where: { onchainListingId: Number(listingId) } });
    if (listing && listing.status !== "SOLD") {
      await prisma.$transaction([
        prisma.listing.update({ where: { id: listing.id }, data: { status: "SOLD" } }),
        prisma.ticket.updateMany({ where: { tokenId: Number(tokenId) }, data: { ownerAddress: recipient, status: "VALID" } }),
      ]);
    }
  }

  await setLastBlock(resaleAddress, to);
}

async function reconcileStuckMinting() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1_000);
  const stuck = await prisma.purchase.findMany({
    where: { status: "MINTING", mintTxHash: null, paidAt: { lt: cutoff } },
    include: { listing: true },
  });

  for (const purchase of stuck) {
    console.warn(`[reconcile] stuck MINTING purchase ${purchase.id}, triggering refund`);
    await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "REFUNDING" } });

    const onchainListingId = purchase.listing?.onchainListingId ?? null;
    if (onchainListingId !== null) {
      try {
        await unlockListingOnChain(onchainListingId);
      } catch (err) {
        console.error(`[reconcile] unlockListing failed for purchase ${purchase.id}:`, err);
      }
      await prisma.listing.updateMany({
        where: { onchainListingId, status: "LOCKED" },
        data:  { status: "ACTIVE" },
      });
    }

    try {
      await psp.refund(purchase.pspChargeId, Number(purchase.amountBrl));
      await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "REFUNDED" } });
    } catch (err) {
      console.error(`[reconcile] PSP refund failed for purchase ${purchase.id}:`, err);
      await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
    }
  }
}

async function tick() {
  try {
    const { sale, nft, resale } = getAddresses();
    await syncTicketSale(sale);
    await syncTicketNFT(nft, resale);
    await syncTicketResale(resale);
  } catch (err) {
    // Don't crash the loop — log and retry next tick
    console.error("[indexer] tick error:", err);
  }
}

export function startIndexer() {
  console.log("[indexer] starting");
  setInterval(tick, POLL_INTERVAL_MS);
  setInterval(reconcileStuckMinting, RECONCILE_INTERVAL_MS);
  tick();
  reconcileStuckMinting();
}
