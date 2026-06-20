"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { base, baseSepolia, anvil } from "viem/chains";

const chains = [base, baseSepolia, anvil] as const;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: { theme: "light" },
        loginMethods: ["email", "google"],
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        defaultChain: base,
        supportedChains: chains,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
