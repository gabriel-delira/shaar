# Shaar

Plataforma de ingressos como NFT (ERC-721). Organizadores cadastram eventos, compradores pagam em fiat (PIX/cartão) e recebem um ingresso NFT mintado para uma carteira embutida (Privy). Inclui mercado secundário de revenda com royalties on-chain, check-in por QR rotativo e off-ramp (USDC → BRL) para organizadores.

## Status atual

`active` — venda primária, revenda, indexador on-chain, check-in e webhooks de PSP implementados e integrados (Fase 0-1 completas). Fluxo de compra direta em USDC e off-ramp efetivo ainda são parciais (stubs / jobs assíncronos pendentes).

## Como executar localmente

O projeto tem duas partes: contratos (`smart_contracts/`, Foundry) e app (`app/`, Next.js).

### 1. Smart contracts (Foundry)

```bash
cd smart_contracts
forge build
forge test                      # roda a suíte
anvil                           # node local em http://127.0.0.1:8545
# em outro terminal, faz o deploy local (CHAIN_ENV=local):
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

O deploy local: faz deploy de `MockUSDC`, `TicketNFT`, `TicketSale`, `TicketResale`, concede roles, define `baseURI`, registra o settler e grava os endereços em `app/lib/contracts/addresses.local.json`.

### 2. App (Next.js + Prisma)

```bash
cd app
npm install
npm run db:migrate              # prisma migrate dev (precisa do Postgres rodando)
npm run db:seed                 # opcional: popular dados
npm run dev                     # http://localhost:3000
```

Scripts disponíveis (`package.json`): `dev`, `build`, `start`, `lint`, `db:migrate`, `db:generate`, `db:seed`, `db:studio`.

> ⚠️ Esta versão do Next.js (16.x) tem breaking changes. Ver `app/AGENTS.md` antes de editar código do app.

## Variáveis de ambiente

Definidas em `app/.env` (sem `.env.example` no repo). Nomes:

- `DATABASE_URL` — Postgres
- `CHAIN_ENV` — `local` | `testnet` | `mainnet`
- `RPC_URL` — endpoint RPC da rede EVM
- `SIGNER_MODE` — `env` (chaves privadas locais) | `privy` (Privy Server Wallets)
- `OWNER_PRIVATE_KEY`, `TREASURY_PRIVATE_KEY` — modo `env`
- `OWNER_WALLET_ID`, `OWNER_WALLET_ADDRESS`, `TREASURY_WALLET_ID`, `TREASURY_WALLET_ADDRESS` — modo `privy`
- `PLATFORM_WALLET`, `TREASURY_WALLET` — usados pelo `Deploy.s.sol` (testnet/mainnet)
- `USDC_ADDRESS`, `NEXT_PUBLIC_NFT_ADDRESS`, `NEXT_PUBLIC_SALE_ADDRESS`, `NEXT_PUBLIC_RESALE_ADDRESS` — endereços dos contratos
- `BASE_URI` — base da URI de metadata
- `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` — Privy
- `NEXTAUTH_SECRET`, `NEXT_PUBLIC_APP_URL` — app
- `FX_MID_RATE`, `FX_SPREAD_BPS` — câmbio BRL/USDC no checkout
- `PSP_PROVIDER` — `mock` | `pagarme` | `stripe`
- `QR_SECRET` — assinatura HMAC do QR de check-in
- `INDEXER_START_BLOCK` — bloco inicial do indexador (opcional)
