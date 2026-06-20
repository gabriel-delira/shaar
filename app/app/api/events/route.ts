import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const city  = searchParams.get("city")  ?? undefined;
  const q     = searchParams.get("q")     ?? undefined;
  const from  = searchParams.get("from")  ?? undefined;
  const to    = searchParams.get("to")    ?? undefined;

  const events = await prisma.event.findMany({
    where: {
      status: { in: ["ON_SALE", "PAUSED"] },
      ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
      ...(q    ? { title: { contains: q, mode: "insensitive" } }  : {}),
      ...(from ? { eventDate: { gte: new Date(from) } }           : {}),
      ...(to   ? { eventDate: { lte: new Date(to) } }             : {}),
    },
    include: { organizer: { select: { companyName: true } } },
    orderBy: { eventDate: "asc" },
  });

  const data = events.map((e) => ({
    id:            e.id,
    title:         e.title,
    venue:         e.venue,
    city:          e.city,
    eventDate:     e.eventDate,
    coverImageUrl: e.coverImageUrl,
    ticketPriceUsdc: Number(e.ticketPriceUsdc),
    maxTickets:    e.maxTickets,
    status:        e.status,
    organizer:     e.organizer.companyName,
    // sold count available via onchain_event_id — skip for now, indexer syncs later
  }));

  return NextResponse.json({ events: data });
}
