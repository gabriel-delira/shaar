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

  const organizer = await prisma.organizer.findUnique({ where: { id } });
  if (!organizer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.organizer.update({ where: { id }, data: { status: "REJECTED" } });
  return NextResponse.json({ ok: true });
}
