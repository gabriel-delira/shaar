/**
 * Global test setup — deterministic env for modules that read process.env at
 * import time (QR routes throw if QR_SECRET is missing) and at call time
 * (psp webhook secret, FX rate). No external service is contacted.
 */
process.env.QR_SECRET = "test-qr-secret-deterministic";
process.env.PSP_WEBHOOK_SECRET = "test-psp-webhook-secret";
process.env.PSP_PROVIDER = "mock";

// Fixed FX so conversions are deterministic: 5.50 mid * (1 + 300bps) = 5.665 BRL/USDC.
process.env.FX_MID_RATE = "5.50";
process.env.FX_SPREAD_BPS = "300";

process.env.NODE_ENV = "test";
