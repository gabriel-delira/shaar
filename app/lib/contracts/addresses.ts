// Reads contract addresses from env vars (populated by Deploy.s.sol via addresses.local.json).
// The deploy script writes to lib/contracts/addresses.local.json; import that file at startup
// to populate NEXT_PUBLIC_* vars, or set them manually.

export function getAddresses() {
  const usdc   = process.env.USDC_ADDRESS   as `0x${string}` | undefined;
  const nft    = process.env.NEXT_PUBLIC_NFT_ADDRESS    as `0x${string}` | undefined;
  const sale   = process.env.NEXT_PUBLIC_SALE_ADDRESS   as `0x${string}` | undefined;
  const resale = process.env.NEXT_PUBLIC_RESALE_ADDRESS as `0x${string}` | undefined;

  if (!usdc || !nft || !sale || !resale) {
    throw new Error(
      "Contract addresses not set. Run Deploy.s.sol and populate .env with the output."
    );
  }

  return { usdc, nft, sale, resale };
}
