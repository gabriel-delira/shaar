# Stack & Infraestrutura — Shaar

## Stack principal

| Camada | Tecnologia |
|---|---|
| Contratos | Solidity `^0.8.20`, Foundry (Forge + Anvil), OpenZeppelin Contracts |
| App | Next.js 16.x (App Router), React 19, TypeScript |
| ORM / DB | Prisma 7 + PostgreSQL |
| Chain client | viem `^2.52` (+ wagmi no front) |
| Auth / Wallets | Privy (`@privy-io/react-auth` no front, `@privy-io/server-auth` no back) |
| Estilo | Tailwind CSS 4 |

## Contratos on-chain (`smart_contracts/src/`)

| Contrato | Responsabilidade |
|---|---|
| `TicketNFTLocked.sol` | ERC-721 + ERC-721URIStorage + ERC-2981 + AccessControl. Mint, metadata por token, freeze (pin de URI), roles `MINTER_ROLE` / `OPERATOR_ROLE`. Transfers restritos a contratos autorizados (`authorizedTransferor`). Não recebe pagamento. |
| `TicketSale.sol` | Venda primária. `Ownable` + `Pausable` + `ReentrancyGuard`. Cria eventos, faz split organizador/plataforma e chama `TicketNFTLocked.mint()`. Deploy de um `RoyaltySplitter` por evento. |
| `TicketResale.sol` | Mercado secundário com escrow do NFT. Split vendedor / royalty (ERC-2981) / plataforma. Suporta fluxo cripto direto e fluxo fiat via `lockListing`/`settleListedTicket` (gated por `settler`). |
| `TicketSwap.sol` | Troca atômica de ingressos entre dois usuários + taxa. |
| `RoyaltySplitter.sol` | Recebe royalties ERC-2981 e divide entre organizador e plataforma. |
| `MockUSDC.sol` | ERC-20 de teste, usado só em `CHAIN_ENV=local`. |

> Nota: o spec em `smart_contracts/CLAUDE.md` cita `SubscriptionSplit.sol`, mas esse contrato NÃO existe no `src/` atual — o projeto implementado é só a plataforma de ingressos (Caso 2).

## Dependências externas

- **PostgreSQL** — banco principal (`DATABASE_URL`). Modela usuários, organizadores, eventos, ingressos, listagens, compras, saques, check-ins e `SyncState` (cursor do indexador).
- **Blockchain EVM (RPC)** — `RPC_URL`. Local: Anvil. Alvo: Base (USDC da Circle em Base). Toda escrita on-chain passa por viem `walletClient`.
- **Privy** — autenticação de usuários e **Server Wallets** (assinatura on-chain server-side em testnet/mainnet). Carteiras embutidas são criadas para o usuário no primeiro login. `PRIVY_APP_SECRET` + `NEXT_PUBLIC_PRIVY_APP_ID`.
- **PSP (gateway de pagamento)** — abstraído em `app/lib/psp` (`mock` | `pagarme` | `stripe`). Cria cobranças PIX/cartão e envia webhook de confirmação. Webhook verificado por assinatura (HMAC sobre o corpo cru).
- **Feed de câmbio BRL/USDC** — hoje hardcoded em `app/lib/fx.ts` (`FX_MID_RATE` + `FX_SPREAD_BPS`); previsto trocar por feed real (Transfero/Bitso).
- **IPFS** — usado conceitualmente no `freeze` do `TicketNFTLocked` (pin de CID estático como URI final pós-evento); o pin em si é feito off-chain.

## Como os serviços se comunicam

```
Front (Next.js, Privy)
   │  Bearer token Privy
   ▼
API Routes (app/app/api/**)  ──Prisma──▶  PostgreSQL
   │            │
   │ viem       │ psp.createCharge / refund
   ▼            ▼
RPC EVM      PSP gateway ──webhook──▶ /api/webhooks/psp
   ▲                                       │ dirige a state machine de Purchase
   │                                       │ (mint / settle on-chain via TREASURY)
   │                                       ▼
Indexer (app/worker/indexer.ts) ◀── polling de eventos ── contratos
   └─ roda via instrumentation.ts (Node runtime), sincroniza DB com a chain
```

- **Assinatura on-chain**: `app/lib/signer` decide entre chave privada (`SIGNER_MODE=env`, Anvil) ou Privy Server Wallets (`SIGNER_MODE=privy`). Duas contas: `OWNER` (admin, cria eventos, freeze) e `TREASURY` (settler/comprador no fluxo fiat).
- **Indexador**: faz polling de `TicketSold`, `Transfer`, `TicketListed`, `ListingCancelled`, `TicketSettled` e reconcilia compras travadas em `MINTING`. Cursor por contrato em `SyncState`.
- **Endereços dos contratos**: gravados pelo `Deploy.s.sol` em `app/lib/contracts/addresses.<chainEnv>.json` e lidos por `app/lib/contracts/addresses.ts`.
