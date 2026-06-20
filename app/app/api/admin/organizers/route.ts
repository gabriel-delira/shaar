import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { searchParams } = new URL(req.url);
  const ORGANIZER_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
  type OrganizerStatusValue = typeof ORGANIZER_STATUSES[number];
  const rawStatus = searchParams.get("status") ?? "PENDING";
  if (!ORGANIZER_STATUSES.includes(rawStatus as OrganizerStatusValue)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const status = rawStatus as OrganizerStatusValue;

  const organizers = await prisma.organizer.findMany({
    where: { status },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ organizers });
}
