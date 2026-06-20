import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { usdcToBrl } from "@/lib/fx";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      organizer: { select: { companyName: true, payoutWallet: true } },
      tickets:   { select: { status: true } },
    },
  });

  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const soldCount    = event.tickets.length;
  const available    = event.maxTickets ? event.maxTickets - soldCount : null;
  const priceUsdc    = Number(event.ticketPriceUsdc);
  const priceBrl     = await usdcToBrl(priceUsdc);

  return NextResponse.json({
    id:            event.id,
    title:         event.title,
    description:   event.description,
    venue:         event.venue,
    city:          event.city,
    coverImageUrl: event.coverImageUrl,
    eventDate:     event.eventDate,
    ticketPriceUsdc: priceUsdc,
    ticketPriceBrl:  priceBrl,
    platformFeeBps:  event.platformFeeBps,
    royaltyBps:      event.royaltyBps,
    maxTickets:      event.maxTickets,
    soldCount,
    available,
    status:          event.status,
    onchainEventId:  event.onchainEventId,
    organizer:       event.organizer.companyName,
  });
}
