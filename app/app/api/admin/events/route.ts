import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { searchParams } = new URL(req.url);
  const EVENT_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ON_SALE", "PAUSED", "ENDED", "FROZEN", "REJECTED"] as const;
  type EventStatusValue = typeof EVENT_STATUSES[number];
  const rawStatus = searchParams.get("status") ?? "PENDING_APPROVAL";
  if (!EVENT_STATUSES.includes(rawStatus as EventStatusValue)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const status = rawStatus as EventStatusValue;

  const events = await prisma.event.findMany({
    where:   { status },
    include: { organizer: { select: { companyName: true, document: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ events });
}
