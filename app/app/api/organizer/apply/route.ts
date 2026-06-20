import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const existing = await prisma.organizer.findUnique({ where: { userId: user.id } });
  if (existing) {
    return NextResponse.json({ error: "Already applied", status: existing.status }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const { companyName, document, payoutWallet } = body;

  if (!companyName || !document || !payoutWallet) {
    return NextResponse.json({ error: "companyName, document and payoutWallet are required" }, { status: 400 });
  }

  const organizer = await prisma.organizer.create({
    data: { userId: user.id, companyName, document, payoutWallet, status: "PENDING" },
  });

  return NextResponse.json({ organizer }, { status: 201 });
}
