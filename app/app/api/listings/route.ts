import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { getAddresses } from "@/lib/contracts/addresses";
import { getApproveCalldata, getListTicketCalldata } from "@/lib/onchain";
import { lockRate } from "@/lib/fx";

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  if (!user.walletAddress) {
    return NextResponse.json({ error: "No wallet linked to account" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const { tokenId, priceUsdc, expiresAt } = body as {
    tokenId:   number;
    priceUsdc: number;
    expiresAt?: number;
  };

  if (!tokenId || !priceUsdc || priceUsdc <= 0) {
    return NextResponse.json({ error: "tokenId and priceUsdc (> 0) are required" }, { status: 400 });
  }

  // Verify ownership in DB
  const ticket = await prisma.ticket.findUnique({ where: { tokenId } });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  if (ticket.ownerAddress.toLowerCase() !== user.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "You do not own this ticket" }, { status: 403 });
  }
  if (ticket.status === "LISTED") {
    return NextResponse.json({ error: "Ticket is already listed" }, { status: 409 });
  }
  if (ticket.status !== "VALID") {
    return NextResponse.json({ error: "Ticket cannot be listed in its current status" }, { status: 409 });
  }

  const { nft, resale, usdc } = getAddresses();
  const expiry = expiresAt ?? 0;
  const fxRate  = await lockRate();
  const amountBrl = Math.round(priceUsdc * fxRate * 100) / 100;

  // Create DB listing (onchainListingId set by indexer after tx is mined)
  const listing = await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { tokenId }, data: { status: "LISTED" } });
    return tx.listing.create({
      data: {
        tokenId,
        sellerAddress: user.walletAddress!,
        price:         priceUsdc,
        paymentToken:  usdc,
        expiresAt:     expiry > 0 ? new Date(expiry * 1000) : null,
        status:        "ACTIVE",
      },
    });
  });

  // Build calldata for the seller to sign and submit via their embedded wallet
  const approveCalldata   = getApproveCalldata(tokenId, resale);
  const listTicketCalldata = getListTicketCalldata(tokenId, priceUsdc, usdc, expiry);

  return NextResponse.json({
    listingId:        listing.id,
    priceUsdc,
    priceBrl:         amountBrl,
    nftAddress:       nft,
    resaleAddress:    resale,
    approveCalldata,
    listTicketCalldata,
    message: "Sign both transactions with your wallet: (1) approve, (2) listTicket. The listing will appear in the market once the tx is mined.",
  });
}
