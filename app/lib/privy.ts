import { PrivyClient } from "@privy-io/server-auth";

const globalForPrivy = globalThis as unknown as { privy: PrivyClient };

export const privy =
  globalForPrivy.privy ??
  new PrivyClient(
    process.env.PRIVY_APP_ID!,
    process.env.PRIVY_APP_SECRET!,
  );

if (process.env.NODE_ENV !== "production") globalForPrivy.privy = privy;
