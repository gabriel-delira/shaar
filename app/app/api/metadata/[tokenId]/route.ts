import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId: tokenIdStr } = await params;
  const tokenId = parseInt(tokenIdStr, 10);
  if (isNaN(tokenId)) return NextResponse.json({ error: "Invalid tokenId" }, { status: 400 });

  const ticket = await prisma.ticket.findUnique({
    where: { tokenId },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          description: true,
          venue: true,
          city: true,
          eventDate: true,
          coverImageUrl: true,
        },
      },
    },
  });

  if (!ticket) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  const { event } = ticket;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const metadata = {
    name: `${event.title} #${ticket.ticketNumber}`,
    description: [
      `Ingresso #${ticket.ticketNumber} para ${event.title}.`,
      `Local: ${event.venue}, ${event.city}.`,
      `Data: ${new Date(event.eventDate).toLocaleDateString("pt-BR")}.`,
      event.description ? event.description : null,
    ]
      .filter(Boolean)
      .join(" "),
    image: event.coverImageUrl ?? `${appUrl}/placeholder-ticket.png`,
    external_url: `${appUrl}/events/${event.id}`,
    attributes: [
      { trait_type: "Evento",            value: event.title },
      { trait_type: "Local",             value: `${event.venue}, ${event.city}` },
      { trait_type: "Data",              value: event.eventDate.toISOString() },
      { display_type: "number", trait_type: "Número do Ingresso", value: ticket.ticketNumber },
      ...(ticket.seat ? [{ trait_type: "Assento", value: ticket.seat }] : []),
      { display_type: "number", trait_type: "Token ID", value: tokenId },
    ],
  };

  return NextResponse.json(metadata, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
