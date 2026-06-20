import { createPublicClient, createWalletClient, http } from "viem";
import { base, baseSepolia, anvil } from "viem/chains";

type ChainEnv = "mainnet" | "testnet" | "local";

function resolveChain() {
  const env = (process.env.CHAIN_ENV ?? "local") as ChainEnv;
  switch (env) {
    case "mainnet": return base;
    case "testnet": return baseSepolia;
    default:        return anvil;
  }
}

const chain = resolveChain();
const transport = http(process.env.RPC_URL);

export const publicClient = createPublicClient({ chain, transport });

export { chain };
