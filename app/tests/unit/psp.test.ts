import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { psp } from "@/lib/psp";

/**
 * Invariante (CONTEXT.md / fluxos): o webhook do PSP é o motor do state machine.
 * verifyWebhook valida HMAC-SHA256 sobre o rawBody contra `x-psp-signature`,
 * em tempo constante, e FALHA FECHADO (segredo/assinatura ausente => rejeita).
 */
const SECRET = process.env.PSP_WEBHOOK_SECRET as string;

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function headersWith(sig?: string): Headers {
  const h = new Headers();
  if (sig !== undefined) h.set("x-psp-signature", sig);
  return h;
}

describe("lib/psp — MockPsp.verifyWebhook", () => {
  const body = JSON.stringify({ event: "charge.paid", chargeId: "mock_123" });

  it("aceita uma assinatura válida sobre o rawBody", () => {
    expect(psp.verifyWebhook(body, headersWith(sign(body)))).toBe(true);
  });

  it("rejeita quando o header de assinatura está ausente", () => {
    expect(psp.verifyWebhook(body, headersWith(undefined))).toBe(false);
  });

  it("rejeita assinatura de tamanho/valor incorreto", () => {
    expect(psp.verifyWebhook(body, headersWith("deadbeef"))).toBe(false);
  });

  it("rejeita quando o corpo foi adulterado após assinar", () => {
    const sig = sign(body);
    const tampered = body.replace("charge.paid", "charge.refunded");
    expect(psp.verifyWebhook(tampered, headersWith(sig))).toBe(false);
  });

  it("falha fechado quando PSP_WEBHOOK_SECRET não está configurado", () => {
    const saved = process.env.PSP_WEBHOOK_SECRET;
    delete process.env.PSP_WEBHOOK_SECRET;
    try {
      expect(psp.verifyWebhook(body, headersWith("00"))).toBe(false);
    } finally {
      process.env.PSP_WEBHOOK_SECRET = saved;
    }
  });
});

describe("lib/psp — MockPsp.createPixCharge", () => {
  it("gera uma cobrança Pix com expiração futura e código embutido", async () => {
    const charge = await psp.createPixCharge(56.65, "purchase-1");
    expect(charge.chargeId).toContain("purchase-1");
    expect(charge.pixCode).toContain("BR.GOV.BCB.PIX");
    expect(charge.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
