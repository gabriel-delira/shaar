import { privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem";

export interface Signer {
  ownerAccount: LocalAccount;
  treasuryAccount: LocalAccount;
}

function loadEnvAccount(envVar: string): LocalAccount {
  const pk = process.env[envVar];
  if (!pk) throw new Error(`Missing env var: ${envVar}`);
  return privateKeyToAccount(pk as `0x${string}`);
}

async function loadPrivyAccount(walletIdVar: string, addressVar: string): Promise<LocalAccount> {
  const { createViemAccount } = await import("@privy-io/server-auth/viem");
  const { privy } = await import("@/lib/privy");
  const walletId = process.env[walletIdVar];
  const address  = process.env[addressVar];
  if (!walletId || !address) throw new Error(`Missing env var: ${walletIdVar} or ${addressVar}`);
  return createViemAccount({ walletId, address: address as `0x${string}`, privy });
}

let _signerPromise: Promise<Signer> | null = null;

export function getSigner(): Promise<Signer> {
  if (!_signerPromise) {
    if (process.env.SIGNER_MODE === "privy") {
      _signerPromise = Promise.all([
        loadPrivyAccount("OWNER_WALLET_ID",    "OWNER_WALLET_ADDRESS"),
        loadPrivyAccount("TREASURY_WALLET_ID", "TREASURY_WALLET_ADDRESS"),
      ]).then(([ownerAccount, treasuryAccount]) => ({ ownerAccount, treasuryAccount }));
    } else {
      _signerPromise = Promise.resolve({
        ownerAccount:    loadEnvAccount("OWNER_PRIVATE_KEY"),
        treasuryAccount: loadEnvAccount("TREASURY_PRIVATE_KEY"),
      });
    }
  }
  return _signerPromise;
}
