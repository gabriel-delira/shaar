import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, http, maxUint256 } from "viem";
import { chain } from "@/lib/chain";
import { getSigner } from "@/lib/signer";
import { getAddresses } from "@/lib/contracts/addresses";
import { ERC20_ABI } from "@/lib/contracts/abis";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";

// POST /api/admin/setup-approvals
// One-time call after testnet/mainnet deploy: pre-approves treasury USDC spend on TicketSale + TicketResale.
// On local/Anvil this is done by Deploy.s.sol directly; on testnet it must go through getSigner().
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { usdc, sale, resale } = getAddresses();
  const { treasuryAccount } = await getSigner();
  const client = createWalletClient({ account: treasuryAccount, chain, transport: http(process.env.RPC_URL) });

  const [saleTx, resaleTx] = await Promise.all([
    client.writeContract({ address: usdc, abi: ERC20_ABI, functionName: "approve", args: [sale, maxUint256] }),
    client.writeContract({ address: usdc, abi: ERC20_ABI, functionName: "approve", args: [resale, maxUint256] }),
  ]);

  return NextResponse.json({ saleTx, resaleTx });
}
