import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";
import { toggleEventPauseOnChain } from "@/lib/onchain";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (event.onchainEventId === null) {
    return NextResponse.json({ error: "Event not on-chain yet" }, { status: 409 });
  }

  const txHash = await toggleEventPauseOnChain(event.onchainEventId);
  const newStatus = event.status === "PAUSED" ? "ON_SALE" : "PAUSED";
  await prisma.event.update({ where: { id }, data: { status: newStatus } });

  return NextResponse.json({ ok: true, status: newStatus, txHash });
}
