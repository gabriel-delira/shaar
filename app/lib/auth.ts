import { NextRequest } from "next/server";
import { privy } from "@/lib/privy";
import { prisma } from "@/lib/db";
import type { User } from "@prisma/client";

export async function getAuthUser(req: NextRequest): Promise<User | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;

  let claims;
  try {
    claims = await privy.verifyAuthToken(token);
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { privyId: claims.userId } });
  return user;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
