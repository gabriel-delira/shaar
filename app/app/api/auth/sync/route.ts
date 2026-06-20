import { NextRequest, NextResponse } from "next/server";
import { privy } from "@/lib/privy";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let claims;
  try {
    claims = await privy.verifyAuthToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const privyUser = await privy.getUser(claims.userId);
  const email = privyUser.email?.address ?? null;
  const walletAddress =
    privyUser.linkedAccounts.find((a) => a.type === "wallet")?.address ?? null;

  const user = await prisma.user.upsert({
    where: { privyId: claims.userId },
    create: { privyId: claims.userId, email, walletAddress },
    update: { email, walletAddress },
  });

  return NextResponse.json({ user });
}
