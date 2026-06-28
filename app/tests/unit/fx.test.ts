import { describe, it, expect } from "vitest";
import { getBrlPerUsdc, usdcToBrl, brlToUsdc, lockRate } from "@/lib/fx";

/**
 * Domain (CONTEXT.md): usuário paga em BRL; on-chain usa USDC com taxa de câmbio
 * TRAVADA no checkout. fx.ts é a fonte da taxa (mid + spread) e dos conversores.
 *
 * Env do setup: FX_MID_RATE=5.50, FX_SPREAD_BPS=300 -> ask = 5.665 BRL/USDC.
 */
const ASK = 5.5 * (1 + 300 / 10_000); // 5.665

describe("lib/fx — câmbio BRL/USDC com spread", () => {
  it("getBrlPerUsdc aplica o spread sobre o mid rate", async () => {
    expect(await getBrlPerUsdc()).toBeCloseTo(ASK, 6);
  });

  it("usdcToBrl converte e arredonda a 2 casas", async () => {
    // 10 USDC * 5.665 = 56.65
    expect(await usdcToBrl(10)).toBe(56.65);
    // arredondamento: 1 USDC * 5.665 = 5.665 -> 5.67 (não 5.66)
    expect(await usdcToBrl(1)).toBe(5.67);
  });

  it("brlToUsdc converte e arredonda a 6 casas", async () => {
    // 56.65 BRL / 5.665 = 10 USDC
    expect(await brlToUsdc(56.65)).toBeCloseTo(10, 6);
  });

  it("lockRate retorna a mesma taxa ask (taxa travada no checkout)", async () => {
    expect(await lockRate()).toBe(await getBrlPerUsdc());
  });

  it("round-trip USDC -> BRL -> USDC fica dentro da tolerância de arredondamento", async () => {
    const usdc = 25.5;
    const brl = await usdcToBrl(usdc);
    const back = await brlToUsdc(brl);
    expect(back).toBeCloseTo(usdc, 2);
  });
});
