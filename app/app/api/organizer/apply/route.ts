import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
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

  if (typeof companyName !== "string" || companyName.trim().length < 2 || companyName.length > 120) {
    return NextResponse.json({ error: "companyName must be between 2 and 120 characters" }, { status: 400 });
  }

  // document = CPF (11 digits) or CNPJ (14 digits), digits only
  const documentDigits = String(document).replace(/\D/g, "");
  if (documentDigits.length !== 11 && documentDigits.length !== 14) {
    return NextResponse.json({ error: "document must be a valid CPF (11 digits) or CNPJ (14 digits)" }, { status: 400 });
  }

  if (!isAddress(payoutWallet)) {
    return NextResponse.json({ error: "payoutWallet must be a valid EVM address" }, { status: 400 });
  }

  const organizer = await prisma.organizer.create({
    data: { userId: user.id, companyName, document, payoutWallet, status: "PENDING" },
  });

  return NextResponse.json({ organizer }, { status: 201 });
}
