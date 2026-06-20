// BRL / USDC exchange rate with configurable spread.
// In production, replace getUsdcBrlRate() with a real FX feed (e.g. Transfero, Bitso API).
// USDC = 1 USD (Circle on Base), so this is essentially BRL/USD.

const SPREAD_BPS = parseInt(process.env.FX_SPREAD_BPS ?? "300", 10); // 3% default

/** Returns the ask rate (BRL per 1 USDC) including spread. */
export async function getBrlPerUsdc(): Promise<number> {
  // TODO: replace with live feed; hardcoded for sandbox
  const midRate = parseFloat(process.env.FX_MID_RATE ?? "5.50");
  return midRate * (1 + SPREAD_BPS / 10_000);
}

/** Converts a USDC amount (as number) to BRL, rounded to 2 decimal places. */
export async function usdcToBrl(usdc: number): Promise<number> {
  const rate = await getBrlPerUsdc();
  return Math.round(usdc * rate * 100) / 100;
}

/** Converts a BRL amount to USDC, rounded to 6 decimal places. */
export async function brlToUsdc(brl: number): Promise<number> {
  const rate = await getBrlPerUsdc();
  return Math.round((brl / rate) * 1_000_000) / 1_000_000;
}

/** Returns the locked rate (BRL per USDC) at checkout time, stored on the Purchase. */
export async function lockRate(): Promise<number> {
  return getBrlPerUsdc();
}
