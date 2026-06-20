import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBrlPerUsdc } from "@/lib/fx";

export async function GET() {
  const listings = await prisma.listing.findMany({
    where: {
      status:           "ACTIVE",
      onchainListingId: { not: null },
    },
    include: {
      ticket: {
        include: {
          event: {
            select: {
              id:           true,
              title:        true,
              venue:        true,
              city:         true,
              eventDate:    true,
              coverImageUrl: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const fxRate = await getBrlPerUsdc();

  const result = listings.map((l) => ({
    id:              l.id,
    onchainListingId: l.onchainListingId,
    tokenId:         l.tokenId,
    sellerAddress:   l.sellerAddress,
    priceUsdc:       Number(l.price),
    priceBrl:        Math.round(Number(l.price) * fxRate * 100) / 100,
    paymentToken:    l.paymentToken,
    expiresAt:       l.expiresAt,
    createdAt:       l.createdAt,
    ticket: {
      tokenId:      l.ticket.tokenId,
      ticketNumber: l.ticket.ticketNumber,
      seat:         l.ticket.seat,
      facePrice:    Number(l.ticket.facePrice),
      event:        l.ticket.event,
    },
  }));

  return NextResponse.json(result);
}
