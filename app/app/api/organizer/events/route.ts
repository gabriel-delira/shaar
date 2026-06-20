import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const organizer = await prisma.organizer.findUnique({ where: { userId: user.id } });
  if (!organizer) return forbidden();

  const events = await prisma.event.findMany({
    where: { organizerId: organizer.id },
    include: {
      _count: { select: { tickets: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const organizer = await prisma.organizer.findUnique({ where: { userId: user.id } });
  if (!organizer) return forbidden();
  if (organizer.status !== "APPROVED") {
    return NextResponse.json({ error: "Organizer not approved yet" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    title, description, venue, city,
    coverImageUrl, eventDate,
    ticketPriceUsdc, maxTickets,
    royaltyBps, royaltyOrgShareBps,
  } = body;

  if (!title || !venue || !city || !eventDate || ticketPriceUsdc === undefined) {
    return NextResponse.json(
      { error: "title, venue, city, eventDate and ticketPriceUsdc are required" },
      { status: 400 }
    );
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const price = Number(ticketPriceUsdc);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: "ticketPriceUsdc must be a positive number" }, { status: 400 });
  }

  const date = new Date(eventDate);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "eventDate is invalid" }, { status: 400 });
  }
  if (date.getTime() <= Date.now()) {
    return NextResponse.json({ error: "eventDate must be in the future" }, { status: 400 });
  }

  let max: number | null = null;
  if (maxTickets !== undefined && maxTickets !== null) {
    max = Number(maxTickets);
    if (!Number.isInteger(max) || max < 1) {
      return NextResponse.json({ error: "maxTickets must be a positive integer" }, { status: 400 });
    }
  }

  // Fees/royalties are NOT taken from organizer input.
  // platformFee is fixed by the platform; royalties are clamped to on-chain limits
  // (royaltyBps ≤ 1000 = 10% cap in TicketSale; org share ≤ 10000 = 100%).
  const clamp = (v: unknown, def: number, lo: number, hi: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  };
  const platformFeeBps     = Number(process.env.PLATFORM_FEE_BPS ?? 800);
  const finalRoyaltyBps    = royaltyBps === undefined ? 1000 : clamp(royaltyBps, 1000, 0, 1000);
  const finalOrgShareBps   = royaltyOrgShareBps === undefined ? 8000 : clamp(royaltyOrgShareBps, 8000, 0, 10000);

  const event = await prisma.event.create({
    data: {
      organizerId:        organizer.id,
      title,
      description,
      venue,
      city,
      coverImageUrl,
      eventDate:          date,
      ticketPriceUsdc:    price,
      maxTickets:         max,
      platformFeeBps,
      royaltyBps:         finalRoyaltyBps,
      royaltyOrgShareBps: finalOrgShareBps,
      status:             "PENDING_APPROVAL",
    },
  });

  return NextResponse.json({ event }, { status: 201 });
}
