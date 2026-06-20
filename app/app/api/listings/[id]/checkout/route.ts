import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { lockRate, usdcToBrl } from "@/lib/fx";
import { psp } from "@/lib/psp";
import { lockListingOnChain, unlockListingOnChain } from "@/lib/onchain";
import { randomUUID } from "crypto";

// POST /api/listings/:id/checkout
// Creates a PIX charge for the buyer and locks the listing on-chain so the seller can't cancel.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  if (!user.walletAddress) {
    return NextResponse.json({ error: "No wallet linked to account" }, { status: 409 });
  }

  const { id } = await params;

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { ticket: { include: { event: true } } },
  });

  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (listing.status !== "ACTIVE") {
    return NextResponse.json({ error: "Listing is not active" }, { status: 409 });
  }
  if (listing.onchainListingId === null) {
    return NextResponse.json({ error: "Listing not yet confirmed on-chain" }, { status: 409 });
  }
  if (listing.sellerAddress.toLowerCase() === user.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "Cannot buy your own listing" }, { status: 409 });
  }
  if (listing.expiresAt && listing.expiresAt < new Date()) {
    return NextResponse.json({ error: "Listing has expired" }, { status: 409 });
  }

  // Atomically reserve the listing: only one concurrent checkout can win the
  // ACTIVE → LOCKED transition. This is the real mutex — the read above is just
  // for early/friendly errors.
  const reserved = await prisma.listing.updateMany({
    where: { id: listing.id, status: "ACTIVE" },
    data:  { status: "LOCKED" },
  });
  if (reserved.count !== 1) {
    return NextResponse.json({ error: "Listing is no longer available" }, { status: 409 });
  }

  // From here on, any failure must release the reservation (back to ACTIVE).
  const priceUsdc = Number(listing.price);
  const fxRate    = await lockRate();
  const amountBrl = Math.round(priceUsdc * fxRate * 100) / 100;

  const externalRef = randomUUID();

  // Lock listing on-chain before creating the charge so the seller can't cancel
  // mid-payment. Passing the buyer address binds the NFT delivery to this exact
  // wallet — a compromised settler key cannot redirect to an arbitrary address.
  try {
    await lockListingOnChain(listing.onchainListingId, user.walletAddress as `0x${string}`);
  } catch (err) {
    console.error("[listings/checkout] lockListing failed:", err);
    await prisma.listing.updateMany({ where: { id: listing.id, status: "LOCKED" }, data: { status: "ACTIVE" } });
    return NextResponse.json({ error: "Failed to lock listing on-chain" }, { status: 500 });
  }

  let charge;
  try {
    charge = await psp.createPixCharge(amountBrl, externalRef);
  } catch (err) {
    console.error("[listings/checkout] createPixCharge failed:", err);
    try { await unlockListingOnChain(listing.onchainListingId); } catch { /* best effort */ }
    await prisma.listing.updateMany({ where: { id: listing.id, status: "LOCKED" }, data: { status: "ACTIVE" } });
    return NextResponse.json({ error: "Failed to create charge" }, { status: 502 });
  }

  const purchase = await prisma.purchase.create({
    data: {
      userId:        user.id,
      eventId:       listing.ticket.eventId,
      listingId:     listing.id,
      amountBrl,
      amountUsdc:    priceUsdc,
      fxRate,
      pspProvider:   process.env.PSP_PROVIDER ?? "mock",
      pspChargeId:   charge.chargeId,
      paymentMethod: "PIX",
      status:        "PENDING",
    },
  });

  return NextResponse.json({
    purchaseId:  purchase.id,
    status:      "PENDING",
    amountBrl,
    pixCode:     charge.pixCode,
    qrCodeUrl:   charge.qrCodeUrl,
    expiresAt:   charge.expiresAt,
  });
}
