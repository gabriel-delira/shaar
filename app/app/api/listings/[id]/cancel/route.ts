import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { getAddresses } from "@/lib/contracts/addresses";
import { getCancelListingCalldata } from "@/lib/onchain";

// POST /api/listings/:id/cancel
// Returns calldata for the seller to submit on-chain. Marks listing CANCELLED in DB
// optimistically. The indexer also catches ListingCancelled events as a safety-net.
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
    // Listing never made it on-chain: just revert DB state
    await prisma.$transaction([
      prisma.listing.update({ where: { id }, data: { status: "CANCELLED" } }),
      prisma.ticket.updateMany({ where: { tokenId: listing.tokenId, status: "LISTED" }, data: { status: "VALID" } }),
    ]);
    return NextResponse.json({ ok: true, message: "Listing cancelled (not yet on-chain)" });
  }

  // Mark cancelled in DB and return calldata for on-chain cancel
  await prisma.$transaction([
    prisma.listing.update({ where: { id }, data: { status: "CANCELLED" } }),
    prisma.ticket.updateMany({ where: { tokenId: listing.tokenId, status: "LISTED" }, data: { status: "VALID" } }),
  ]);

  const { resale } = getAddresses();
  const cancelCalldata = getCancelListingCalldata(listing.onchainListingId);

  return NextResponse.json({
    ok:             true,
    resaleAddress:  resale,
    cancelCalldata,
    message: "Listing cancelled in DB. Sign and submit cancelCalldata to return the NFT from escrow.",
  });
}
