import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { processPspPayment } from "@/app/api/webhooks/psp/route";

// DEV ONLY — simulates PSP confirming a payment without a real PSP webhook.
// Only active when APP_ENV=local (allowlist-positive gate) AND caller is ADMIN.
// NODE_ENV is not a reliable gate: staging/preview envs may differ.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ purchaseId: string }> }
) {
  if (process.env.APP_ENV !== "local") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — ADMIN role required" }, { status: 403 });
  }

  const { purchaseId } = await params;

  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });

  const result = await processPspPayment(purchase.pspChargeId);
  return NextResponse.json(result);
}
