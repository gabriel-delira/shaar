import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";
import { freezeTicketOnChain } from "@/lib/onchain";

// POST /api/admin/events/:id/freeze
// Freezes every ticket for the event: pins the metadata URI on-chain so it becomes immutable.
// Tokens remain transferable after freeze — holders can still sell/swap the ticket as a collectible.
// Optional body: { baseMetadataUrl: string } to override the metadata base URL.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — ADMIN role required" }, { status: 403 });
  }

  const { id: eventId } = await params;

  const event = await prisma.event.findUnique({
    where:   { id: eventId },
    include: { tickets: true },
  });

  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.status === "FROZEN") {
    return NextResponse.json({ error: "Event already frozen" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const appUrl = (body.baseMetadataUrl as string | undefined)
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? "http://localhost:3000";

  const results: { tokenId: number; txHash: string; error?: string }[] = [];
  const frozenTokenIds: number[] = [];

  for (const ticket of event.tickets) {
    if (ticket.status === "FROZEN") {
      results.push({ tokenId: ticket.tokenId, txHash: "", error: "already frozen" });
      continue;
    }
    const finalURI = `${appUrl}/api/metadata/${ticket.tokenId}`;
    try {
      const txHash = await freezeTicketOnChain(ticket.tokenId, finalURI);
      frozenTokenIds.push(ticket.tokenId);
      results.push({ tokenId: ticket.tokenId, txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[freeze] tokenId ${ticket.tokenId}:`, msg);
      results.push({ tokenId: ticket.tokenId, txHash: "", error: msg });
    }
  }

  if (frozenTokenIds.length > 0) {
    await prisma.ticket.updateMany({
      where: { tokenId: { in: frozenTokenIds } },
      data:  { status: "FROZEN" },
    });
  }

  // Mark event FROZEN only if all tickets were frozen successfully
  const allOk = results.every((r) => !r.error || r.error === "already frozen");
  if (allOk) {
    await prisma.event.update({ where: { id: eventId }, data: { status: "FROZEN" } });
  }

  return NextResponse.json({ eventId, frozen: allOk, results });
}
