import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  if (!user.walletAddress) return NextResponse.json([]);

  const tickets = await prisma.ticket.findMany({
    where: { ownerAddress: user.walletAddress },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          venue: true,
          city: true,
          eventDate: true,
          coverImageUrl: true,
        },
      },
    },
    orderBy: { mintedAt: "desc" },
  });

  return NextResponse.json(tickets);
}
