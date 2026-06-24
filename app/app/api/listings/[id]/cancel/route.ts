import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { getAddresses } from "@/lib/contracts/addresses";
import { getCancelListingCalldata } from "@/lib/onchain";

// POST /api/listings/:id/cancel
// Returns calldata for the seller to submit on-chain. Sets listing to CANCELLING
// (an intermediate state) while the ticket stays LISTED; the indexer finalises both
// to CANCELLED/VALID once it observes the on-chain ListingCancelled event.
// This prevents the "phantom relist" window where the DB said CANCELLED but the NFT
// was still in escrow and the on-chain listing was still active.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const isOwner = listing.sellerAddress.toLowerCase() === user.walletAddress?.toLowerCase();
  const isAdmin = user.role === "ADMIN";
  if (!isOwner && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (listing.status !== "ACTIVE") {
    return NextResponse.json({ error: "Listing is not active" }, { status: 409 });
  }

  if (listing.onchainListingId === null) {
    // Listing never made it on-chain — safe to cancel immediately; no escrow to return.
    await prisma.$transaction([
      prisma.listing.update({ where: { id }, data: { status: "CANCELLED" } }),
      prisma.ticket.updateMany({ where: { tokenId: listing.tokenId, status: "LISTED" }, data: { status: "VALID" } }),
    ]);
    return NextResponse.json({ ok: true, message: "Listing cancelled (not yet on-chain)" });
  }

  // Mark as CANCELLING — ticket stays LISTED until on-chain ListingCancelled is observed.
  // The indexer's syncTicketResale will set Listing=CANCELLED and Ticket=VALID.
  await prisma.listing.update({ where: { id }, data: { status: "CANCELLING" } });

  const { resale } = getAddresses();
  const cancelCalldata = getCancelListingCalldata(listing.onchainListingId);

  return NextResponse.json({
    ok:            true,
    resaleAddress: resale,
    cancelCalldata,
    message:       "Sign and submit cancelCalldata to return the NFT from escrow. The listing will be fully cancelled once the transaction is confirmed on-chain.",
  });
}
