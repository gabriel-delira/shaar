import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const reason: string = body.reason ?? "";

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.event.update({
    where: { id },
    data: { status: "REJECTED", description: event.description ? `${event.description}\n\n[REJECTED: ${reason}]` : `[REJECTED: ${reason}]` },
  });

  return NextResponse.json({ ok: true });
}
