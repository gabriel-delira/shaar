import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { lockRate } from "@/lib/fx";
import { getUsdcBalance } from "@/lib/onchain";

// POST /api/withdrawals — Organizer requests off-ramp (USDC → BRL via PIX)
// The actual USDC transfer and PIX payout are handled by an async job; this endpoint
// just records the request and returns the current BRL equivalent.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  // Only an APPROVED organizer with a payout wallet can off-ramp event proceeds.
  const organizer = await prisma.organizer.findUnique({ where: { userId: user.id } });
  if (!organizer || organizer.status !== "APPROVED") {
    return NextResponse.json({ error: "Forbidden — approved organizer required" }, { status: 403 });
  }
  if (!organizer.payoutWallet) {
    return NextResponse.json({ error: "Organizer has no payout wallet" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const { amount, pixKey } = body as { amount?: number; pixKey?: string };

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (!pixKey || typeof pixKey !== "string") {
    return NextResponse.json({ error: "pixKey is required" }, { status: 400 });
  }

  // Available balance = on-chain USDC of the organizer's payout wallet, minus
  // amounts already committed to in-flight withdrawals (prevents double-withdrawal).
  const onchainBalance = await getUsdcBalance(organizer.payoutWallet as `0x${string}`);

  const pending = await prisma.withdrawal.aggregate({
    where:  { userId: user.id, status: { in: ["REQUESTED", "PROCESSING"] } },
    _sum:   { amount: true },
  });
  const committed = Number(pending._sum.amount ?? 0);
  const available = onchainBalance - committed;

  if (amount > available) {
    return NextResponse.json(
      { error: "Insufficient balance", available, requested: amount },
      { status: 422 }
    );
  }

  const fxRate    = await lockRate();
  const amountBrl = Math.round(amount * fxRate * 100) / 100;

  const withdrawal = await prisma.withdrawal.create({
    data: {
      userId: user.id,
      amount,
      amountBrl,
      fxRate,
      pixKey,
      status: "REQUESTED",
    },
  });

  return NextResponse.json({
    withdrawalId: withdrawal.id,
    amount,
    amountBrl,
    pixKey,
    status:       "REQUESTED",
    message:      "Withdrawal requested. Funds will be transferred after processing (typically 1 business day).",
  });
}

// GET /api/withdrawals — lists the authenticated user's withdrawals
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const withdrawals = await prisma.withdrawal.findMany({
    where:   { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(withdrawals);
}
