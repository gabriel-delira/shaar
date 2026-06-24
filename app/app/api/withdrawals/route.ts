import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

  // Snapshot the on-chain balance once (outside the DB transaction — the chain is not
  // transactional, but this is a read-only value that doesn't race with DB writes).
  const onchainBalance = await getUsdcBalance(organizer.payoutWallet as `0x${string}`);

  const fxRate    = await lockRate();
  const amountBrl = Math.round(amount * fxRate * 100) / 100;

  // Atomic reserve: aggregate committed amount and create the row in a single
  // serializable transaction.  Two concurrent requests reading the same committed
  // sum will cause one to fail with a serialization error; only the first writer wins.
  let withdrawal: Awaited<ReturnType<typeof prisma.withdrawal.create>>;
  try {
    withdrawal = await prisma.$transaction(async (tx) => {
      const pending = await tx.withdrawal.aggregate({
        where: { userId: user.id, status: { in: ["REQUESTED", "PROCESSING"] } },
        _sum:  { amount: true },
      });
      const committed = Number(pending._sum.amount ?? 0);
      const available = onchainBalance - committed;

      if (amount > available) {
        throw Object.assign(new Error("INSUFFICIENT_BALANCE"), { available });
      }

      return tx.withdrawal.create({
        data: { userId: user.id, amount, amountBrl, fxRate, pixKey, status: "REQUESTED" },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "INSUFFICIENT_BALANCE") {
      const available = (err as Error & { available: number }).available;
      return NextResponse.json(
        { error: "Insufficient balance", available, requested: amount },
        { status: 422 }
      );
    }
    throw err;
  }

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
