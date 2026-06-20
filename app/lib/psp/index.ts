// PSP abstraction — swap the mock with a real Pagar.me / Stripe adapter by changing
// PSP_PROVIDER env var and implementing the corresponding class.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface PixCharge {
  chargeId: string;
  pixCode: string;      // EMV copia-e-cola string (or fake in mock)
  qrCodeUrl: string;    // URL to QR image (or data URI in mock)
  expiresAt: Date;
}

export interface PspProvider {
  createPixCharge(amountBrl: number, externalRef: string): Promise<PixCharge>;
  refund(chargeId: string, amountBrl: number): Promise<void>;
  /// Verifies an incoming webhook is authentic. Receives the RAW request body
  /// (must not be re-serialized) and the request headers. Returns false if the
  /// signature is missing or invalid. Each provider reads its own header/scheme.
  verifyWebhook(rawBody: string, headers: Headers): boolean;
}

// ── Mock (sandbox) ────────────────────────────────────────────────────────────

class MockPsp implements PspProvider {
  async createPixCharge(amountBrl: number, externalRef: string): Promise<PixCharge> {
    const chargeId = `mock_${externalRef}_${Date.now()}`;
    const pixCode  = `00020126580014BR.GOV.BCB.PIX0136${chargeId}5204000053039865406${amountBrl.toFixed(2).replace(".","")
      }5802BR5909Shaar Dev6009SAO PAULO62070503***63040000`;
    return {
      chargeId,
      pixCode,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixCode)}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
    };
  }

  async refund(_chargeId: string, _amountBrl: number): Promise<void> {
    // no-op for mock
  }

  // HMAC-SHA256 over the raw body, keyed by PSP_WEBHOOK_SECRET, compared in
  // constant time against the `x-psp-signature` header (hex). Fails closed:
  // a missing secret or missing/invalid signature is rejected.
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const secret = process.env.PSP_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[psp] PSP_WEBHOOK_SECRET not set — rejecting webhook");
      return false;
    }
    const provided = headers.get("x-psp-signature");
    if (!provided) return false;

    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

function getPsp(): PspProvider {
  const provider = process.env.PSP_PROVIDER ?? "mock";
  switch (provider) {
    case "mock": return new MockPsp();
    default:
      throw new Error(`Unknown PSP_PROVIDER: ${provider}. Implement it in lib/psp/index.ts`);
  }
}

export const psp = getPsp();
