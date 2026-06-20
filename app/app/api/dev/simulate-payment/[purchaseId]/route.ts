import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processPspPayment } from "@/app/api/webhooks/psp/route";

// DEV ONLY — simulates PSP confirming a payment.
// Hit this after creating a purchase to drive the full flow without a real PSP.
// Guarded by NODE_ENV; 404 in production.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ purchaseId: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { purchaseId } = await params;

  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });

  const result = await processPspPayment(purchase.pspChargeId);
  return NextResponse.json(result);
}
