Checklist para fazer o deploy em Base Sepolia
Privy Dashboard → Wallet API → criar 2 Server Wallets → copiar IDs e endereços para .env
Setar no terminal antes do forge:

export CHAIN_ENV=testnet
export PLATFORM_WALLET=<owner server wallet address>
export TREASURY_WALLET=<treasury server wallet address>
export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
export BASE_URI=https://<seu-app>.vercel.app/api/metadata/
Rodar o deploy (com uma chave throwaway que tenha ETH Sepolia):

forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --private-key <DEPLOYER_KEY>
Copiar endereços do output para .env da app (USDC_ADDRESS, NEXT_PUBLIC_NFT_ADDRESS, etc.)
Chamar POST /api/admin/setup-approvals uma vez para aprovar o USDC da tesouraria