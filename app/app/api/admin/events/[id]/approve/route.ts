import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";
import { createEventOnChain } from "@/lib/onchain";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;

  const event = await prisma.event.findUnique({
    where:   { id },
    include: { organizer: true },
  });

  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (event.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Event is not pending approval" }, { status: 409 });
  }

  // Mark APPROVED while we wait for chain
  await prisma.event.update({ where: { id }, data: { status: "APPROVED" } });

  let result;
  try {
    result = await createEventOnChain(event);
  } catch (err) {
    // Roll back to PENDING_APPROVAL so admin can retry
    await prisma.event.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
    console.error("[admin/approve] createEvent on-chain failed:", err);
    return NextResponse.json({ error: "On-chain createEvent failed", detail: String(err) }, { status: 500 });
  }

  await prisma.event.update({
    where: { id },
    data: {
      status:              "ON_SALE",
      onchainEventId:      result.onchainEventId,
      royaltySplitterAddr: result.royaltySplitterAddr,
      createTxHash:        result.txHash,
    },
  });

  return NextResponse.json({
    ok: true,
    onchainEventId:      result.onchainEventId,
    royaltySplitterAddr: result.royaltySplitterAddr,
    txHash:              result.txHash,
  });
}
