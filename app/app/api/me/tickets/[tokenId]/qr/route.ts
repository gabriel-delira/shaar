import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized } from "@/lib/auth";

const QR_SECRET = process.env.QR_SECRET ?? "change-me-in-production";
const WINDOW_SECS = 30;

function makeQrPayload(tokenId: number, userId: string): string {
  const window = Math.floor(Date.now() / (WINDOW_SECS * 1000));
  const sig = createHmac("sha256", QR_SECRET)
    .update(`${tokenId}:${window}:${userId}`)
    .digest("hex")
    .slice(0, 16);
  return `shaar:v1:${tokenId}:${window}:${userId}:${sig}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { tokenId: tokenIdStr } = await params;
  const tokenId = parseInt(tokenIdStr, 10);
  if (isNaN(tokenId)) return NextResponse.json({ error: "Invalid tokenId" }, { status: 400 });

  const ticket = await prisma.ticket.findUnique({ where: { tokenId } });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  if (ticket.ownerAddress.toLowerCase() !== user.walletAddress?.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = makeQrPayload(tokenId, user.id);
  const png = await QRCode.toBuffer(payload, { type: "png", width: 300, margin: 2 });

  // Expire slightly before the next window to prompt refresh
  const secsIntoWindow = Math.floor(Date.now() / 1000) % WINDOW_SECS;
  const ttl = Math.max(WINDOW_SECS - secsIntoWindow - 2, 1);

  return new NextResponse(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `private, max-age=${ttl}`,
    },
  });
}
