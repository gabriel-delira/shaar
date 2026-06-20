import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      event:  { select: { title: true, eventDate: true } },
      ticket: { select: { tokenId: true, ticketNumber: true } },
    },
  });

  if (!purchase) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (purchase.userId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    id:            purchase.id,
    status:        purchase.status,
    paymentMethod: purchase.paymentMethod,
    amountBrl:     Number(purchase.amountBrl),
    amountUsdc:    Number(purchase.amountUsdc),
    event:         purchase.event,
    tokenId:       purchase.ticket?.tokenId ?? null,
    ticketNumber:  purchase.ticket?.ticketNumber ?? null,
    paidAt:        purchase.paidAt,
    completedAt:   purchase.completedAt,
  });
}
