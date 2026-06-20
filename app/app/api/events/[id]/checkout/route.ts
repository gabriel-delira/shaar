import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { usdcToBrl, lockRate } from "@/lib/fx";
import { psp } from "@/lib/psp";
import { randomUUID } from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { id: eventId } = await params;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.status !== "ON_SALE") {
    return NextResponse.json({ error: "Event is not on sale" }, { status: 409 });
  }
  if (event.onchainEventId === null) {
    return NextResponse.json({ error: "Event not deployed on-chain yet" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const method: string = body.method ?? "PIX";

  if (!["PIX", "CARD", "USDC"].includes(method)) {
    return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
  }

  // buyer must have a wallet (created by Privy on first login)
  if (!user.walletAddress) {
    return NextResponse.json({ error: "No wallet linked to account" }, { status: 409 });
  }

  // Capacity check: minted tickets + in-flight purchases must not exceed maxTickets.
  // The on-chain contract is the final guard, but checking here avoids charging a
  // buyer for a ticket that would revert at mint time. null maxTickets = unlimited.
  if (event.maxTickets !== null) {
    const [sold, inFlight] = await Promise.all([
      prisma.ticket.count({ where: { eventId } }),
      prisma.purchase.count({
        where: { eventId, listingId: null, status: { in: ["PENDING", "PAID", "MINTING"] } },
      }),
    ]);
    if (sold + inFlight >= event.maxTickets) {
      return NextResponse.json({ error: "Event is sold out" }, { status: 409 });
    }
  }

  const priceUsdc = Number(event.ticketPriceUsdc);
  const fxRate    = await lockRate();
  const amountBrl = Math.round(priceUsdc * fxRate * 100) / 100;

  const externalRef = randomUUID();

  if (method === "PIX" || method === "CARD") {
    const charge = await psp.createPixCharge(amountBrl, externalRef);

    const purchase = await prisma.purchase.create({
      data: {
        userId:        user.id,
        eventId,
        amountBrl,
        amountUsdc:    priceUsdc,
        fxRate,
        pspProvider:   process.env.PSP_PROVIDER ?? "mock",
        pspChargeId:   charge.chargeId,
        paymentMethod: method as "PIX" | "CARD",
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

  // USDC direct flow — return unsigned tx for the user's wallet to sign
  return NextResponse.json({
    message: "USDC direct flow not yet implemented (Phase 1 scope: fiat only)",
  }, { status: 501 });
}
