import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * E2E (infra mockada) da rota POST /api/checkin — exercita o handler real do
 * Next, incluindo a validação do QR rotativo (CONTEXT.md):
 *   payload = shaar:v1:{tokenId}:{window}:{userId}:{sig}
 *   - HMAC-SHA256 keyed por QR_SECRET, comparado em tempo constante;
 *   - janela de 30s com tolerância ±1 (30s de clock skew);
 *   - o QR é vinculado ao DONO ATUAL do ticket;
 *   - só STAFF/ADMIN podem fazer check-in; status VALID -> CHECKED_IN.
 */

const { getAuthUser, prismaMock } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  prismaMock: {
    ticket: { findUnique: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    checkin: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser,
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  forbidden: () => Response.json({ error: "Forbidden" }, { status: 403 }),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { POST } from "@/app/api/checkin/route";

const QR_SECRET = process.env.QR_SECRET as string;
const WINDOW_SECS = 30;
const OWNER_USER_ID = "owner-user-1";
const OWNER_WALLET = "0xabc0000000000000000000000000000000000001";

function makePayload(tokenId: number, userId: string, windowOffset = 0): string {
  const window = Math.floor(Date.now() / (WINDOW_SECS * 1000)) + windowOffset;
  const sig = createHmac("sha256", QR_SECRET).update(`${tokenId}:${window}:${userId}`).digest("hex");
  return `shaar:v1:${tokenId}:${window}:${userId}:${sig}`;
}

function postReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const staff = { id: "staff-1", role: "STAFF" };

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue(staff);
  prismaMock.$transaction.mockResolvedValue([]);
});

describe("POST /api/checkin — auth & role gate", () => {
  it("401 quando não autenticado", async () => {
    getAuthUser.mockResolvedValue(null);
    const res = await POST(postReq({ qrPayload: makePayload(1, OWNER_USER_ID) }));
    expect(res.status).toBe(401);
  });

  it("403 quando o usuário não é STAFF/ADMIN", async () => {
    getAuthUser.mockResolvedValue({ id: "u", role: "BUYER" });
    const res = await POST(postReq({ qrPayload: makePayload(1, OWNER_USER_ID) }));
    expect(res.status).toBe(403);
  });

  it("400 quando falta qrPayload", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/checkin — validação do QR", () => {
  it("422 para assinatura inválida", async () => {
    const res = await POST(postReq({ qrPayload: "shaar:v1:1:1:user:deadbeef" }));
    expect(res.status).toBe(422);
  });

  it("422 quando a janela está fora da tolerância (±1)", async () => {
    const res = await POST(postReq({ qrPayload: makePayload(1, OWNER_USER_ID, 2) }));
    expect(res.status).toBe(422);
  });

  it("aceita a janela anterior (offset -1, clock skew)", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue({
      tokenId: 1, ownerAddress: OWNER_WALLET, status: "VALID", eventId: "e1", ticketNumber: 5, seat: "A1", event: {},
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: OWNER_USER_ID });
    const res = await POST(postReq({ qrPayload: makePayload(1, OWNER_USER_ID, -1) }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/checkin — vínculo com o dono e máquina de estados", () => {
  const validPayload = () => makePayload(1, OWNER_USER_ID);

  it("404 quando o ticket não existe", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);
    const res = await POST(postReq({ qrPayload: validPayload() }));
    expect(res.status).toBe(404);
  });

  it("422 quando o QR foi emitido por um dono anterior (userId != dono atual)", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue({ tokenId: 1, ownerAddress: OWNER_WALLET, status: "VALID", eventId: "e1", event: {} });
    prismaMock.user.findFirst.mockResolvedValue({ id: "different-owner" });
    const res = await POST(postReq({ qrPayload: validPayload() }));
    expect(res.status).toBe(422);
  });

  it("409 quando o ticket já fez check-in", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue({ tokenId: 1, ownerAddress: OWNER_WALLET, status: "CHECKED_IN", eventId: "e1", event: {} });
    prismaMock.user.findFirst.mockResolvedValue({ id: OWNER_USER_ID });
    const res = await POST(postReq({ qrPayload: validPayload() }));
    expect(res.status).toBe(409);
  });

  it("409 quando o ticket não está VALID (ex.: FROZEN)", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue({ tokenId: 1, ownerAddress: OWNER_WALLET, status: "FROZEN", eventId: "e1", event: {} });
    prismaMock.user.findFirst.mockResolvedValue({ id: OWNER_USER_ID });
    const res = await POST(postReq({ qrPayload: validPayload() }));
    expect(res.status).toBe(409);
  });

  it("200 e transita VALID -> CHECKED_IN no caminho feliz", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue({
      tokenId: 1, ownerAddress: OWNER_WALLET, status: "VALID", eventId: "e1", ticketNumber: 7, seat: "B2",
      event: { title: "Show", venue: "Arena", city: "SP", eventDate: new Date() },
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: OWNER_USER_ID });

    const res = await POST(postReq({ qrPayload: validPayload() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, tokenId: 1, ticketNumber: 7 });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });
});
