# Shaar — Stack & Infraestrutura

> Estado atual: contratos completos + testados, preview navegável, planejamento detalhado.
> Backend/frontend ainda não iniciado.

---

## Visão geral

Plataforma B2B2C de venda de ingressos digitais verificáveis. Organizadores cadastram eventos; compradores pagam em R$ (PIX ou cartão) ou USDC; os ingressos existem on-chain como NFTs ERC-721 na rede Base, mas isso é invisível pro usuário final.

---

## Camadas da stack

### Smart Contracts
| Item | Decisão |
|---|---|
| Linguagem | Solidity ^0.8.20 |
| Biblioteca base | OpenZeppelin Contracts (ERC-721, ERC-2981, Ownable, AccessControl, ReentrancyGuard, Pausable) |
| Framework de testes | **Foundry** — 66/66 testes passando |
| Rede produção | **Base** (EVM L2) |
| Rede staging | Base Sepolia |
| Rede dev local | Anvil |

**Contratos em `smart_contracts/src/`:**

| Contrato | Papel |
|---|---|
| `TicketNFTLocked.sol` | NFT ERC-721 base — mint, freeze pós-evento, metadados; transfers restritos à plataforma |
| `TicketSale.sol` | Venda primária — `createEvent`, `buyTicket`, `buyTicketFor` (fiat-first) |
| `TicketResale.sol` | Mercado secundário — `listTicket`, `buyListedTicket`, `buyListedTicketFor` (fiat-first) |
| `RoyaltySplitter.sol` | Split de royalties por evento (organizador + plataforma) |
| `TicketSwap.sol` | Troca atômica de ingressos — **fora do MVP (fase 2)** |
| `SubscriptionSplit.sol` | Caso 1 (assinaturas para analistas) — separado do MVP de ingressos |

**Ajustes já implementados (12/06/2026):**
- `buyTicketFor(eventId, recipient)` e `buyListedTicketFor(listingId, recipient)` — permitem que a tesouraria execute compras fiat-first mintando direto pro comprador.
- Bug de URI corrigido no `TicketNFT.freeze` (herdado em `TicketNFTLocked`) — URI congelada agora é armazenada e retornada de forma independente, sem concatenação com `baseURI`.

---

### Backend / Frontend
| Item | Decisão |
|---|---|
| Framework | **Next.js** (App Router, TypeScript) |
| Hospedagem | Vercel ou Docker (self-hosted) |
| Web3 client | viem + wagmi |
| ORM | **Prisma** |
| Banco | **PostgreSQL** |

---

### Auth e Carteiras
| Item | Decisão |
|---|---|
| Autenticação | **Privy** — login por email ou Google |
| Carteira do usuário | Embedded wallet criada pelo Privy — invisível pro usuário |
| Chave da plataforma | Interface `Signer` abstraída via `SIGNER_MODE`: **`env`** (Anvil/dev, lê `PRIVATE_KEY`) → **`privy`** (testnet/prod, usa Privy Server Wallets sem expor chave) |

**Carteiras operacionais da plataforma:**

| Carteira | Função | Saldo |
|---|---|---|
| Owner | `createEvent`, pause, fees (`onlyOwner`) + `freeze` pós-evento (`OPERATOR_ROLE` — Owner já recebe essa role no deploy) | ETH para gas |
| Tesouraria | `buyTicketFor` / `buyListedTicketFor` no fluxo fiat; settler no TicketResale | USDC (float) + ETH para gas |

---

### Pagamentos
| Item | Decisão |
|---|---|
| Fiat | PSP (Pagar.me, Stone ou Stripe) — PIX e cartão |
| Cripto | USDC nativo da Circle na Base |
| Moeda on-chain | USDC — primeira classe, não fallback |
| Gas (compra fiat) | Pago pela tesouraria (quem assina paga) — sem paymaster |
| Gas (ações do usuário) | **Paymaster ERC-4337** — usuário nunca precisa de ETH |
| Off-ramp do vendedor | Plataforma recompra USDC → envia PIX (com KYC básico) |

---

### Armazenamento e Metadados
| Item | Decisão |
|---|---|
| IPFS | **Pinata** — para snapshot de metadados no freeze pós-evento |
| Metadados pré-freeze | Servidos pelo endpoint `/api/metadata/:tokenId` (OpenSea-compatible) |
| Metadados pós-freeze | Redirecionam para o CID do IPFS (permanente, imutável) |

---

## Arquitetura de alto nível

```
┌────────────────────────────── Next.js ──────────────────────────────┐
│  Frontend (React)          API Routes (/api/*)       Worker          │
│  ├─ Catálogo / Evento      ├─ REST (comprador,        ├─ Indexer    │
│  ├─ Checkout               │   organizador, admin,    ├─ Job freeze  │
│  ├─ Meus Ingressos (QR)    │   staff, webhooks)       └─ Job expirar │
│  ├─ Mercado de revenda     └─ Tx server-side                         │
│  ├─ Dashboard organizador     (createEvent, freeze)                  │
│  ├─ Painel admin                                                     │
│  └─ Scanner check-in                                                 │
└────────┬──────────────────────────┬──────────────────────┬──────────┘
         │                          │                      │
    ┌────▼────┐               ┌─────▼─────┐          ┌─────▼─────┐
    │  Privy  │               │ PostgreSQL │          │   Base    │
    │  auth + │               │  (Prisma) │          │  (chain)  │
    │ wallets │               └───────────┘          └───────────┘
    └─────────┘               ┌───────────┐          ┌───────────┐
    ┌─────────────────┐       │  Pinata   │          │ Paymaster │
    │ PSP (PIX/cartão)│       │  (IPFS)   │          │ ERC-4337  │
    │ webhook → tx    │       └───────────┘          └───────────┘
    └─────────────────┘
```

---

## Modelo de dados (PostgreSQL / Prisma)

```
users          id, privy_id, email, wallet_address, role (BUYER|ORGANIZER|ADMIN|STAFF)
organizers     id, user_id, company_name, document (CNPJ), payout_wallet,
               status (PENDING|APPROVED|REJECTED)
events         id, organizer_id, title, venue, city, event_date,
               ticket_price_usdc, max_tickets, platform_fee_bps, royalty_bps,
               status (DRAFT|PENDING_APPROVAL|APPROVED|ON_SALE|PAUSED|ENDED|FROZEN|REJECTED),
               onchain_event_id, royalty_splitter_address, create_tx_hash
tickets        token_id (PK, on-chain), event_id, owner_address, ticket_number,
               seat, face_price, status (VALID|LISTED|CHECKED_IN|FROZEN), mint_tx_hash
listings       id, onchain_listing_id, token_id, seller_address, price,
               expires_at, status (ACTIVE|SOLD|CANCELLED|EXPIRED)
purchases      id, user_id, event_id, listing_id?,
               amount_brl, amount_usdc, fx_rate, psp_provider, psp_charge_id (UNIQUE),
               payment_method (PIX|CARD|USDC),
               status (PENDING|PAID|MINTING|COMPLETED|REFUNDING|REFUNDED|FAILED),
               mint_tx_hash, token_id?
withdrawals    id, user_id, amount_usdc, amount_brl, fx_rate, pix_key,
               status (REQUESTED|PROCESSING|PAID|FAILED), usdc_transfer_tx_hash?
checkins       id, token_id, event_id, staff_user_id, scanned_at
sync_state     contract_address (PK), last_processed_block
```

---

## Fluxos principais

### Compra primária (fiat)
```
Comprador → checkout PIX → PSP → webhook "pago"
→ tesouraria executa buyTicketFor(eventId, comprador)
→ split USDC on-chain: organizador recebe na hora
→ indexer detecta TicketSold → purchase = COMPLETED
→ NFT aparece em "Meus Ingressos"
```
> Falha on-chain após PIX pago → estorno automático.

### Revenda
```
Vendedor → define preço → embedded wallet assina approve + listTicket (gas via paymaster)
Comprador → paga PIX → webhook → tesouraria executa buyListedTicketFor
→ split triplo on-chain (vendedor / royalty org / plataforma) + NFT transferido
Vendedor → "Sacar via PIX" → transfere USDC → plataforma envia PIX (off-ramp)
```

### Check-in e freeze
```
Staff escaneia QR (payload assinado, expira em 60s)
→ verifica assinatura + ownerOf on-chain + não usado → entrada liberada

Pós-evento (job agendado):
→ snapshot metadados → pin IPFS → freeze(tokenId, ipfs://CID)
→ NFT vira soulbound (lembrança, intransferível)
```

---

## Roadmap de desenvolvimento

| Fase | Entrega | Estimativa |
|---|---|---|
| **0 — Setup** | Repo Next.js + Prisma + Privy + Anvil + deploy script + seed | 4–6 dias |
| **1 — Venda primária fiat** | Catálogo, checkout PIX/cartão, webhook idempotente, máquina de estados purchases, indexer básico | 2–2,5 semanas |
| **2 — Ingressos & metadata** | Meus ingressos, QR, endpoint `/api/metadata/:tokenId` | 3–5 dias |
| **3 — Revenda + off-ramp** | Mercado, listar/cancelar, saque via PIX | 1,5 semana |
| **4 — Check-in & freeze** | Scanner staff, validação, job de freeze + IPFS | 1 semana |
| **5 — Testnet & hardening** | Base Sepolia, paymaster real, Privy Server Wallets (`SIGNER_MODE=privy`), rotina recompra USDC, monitoramento | 1,5 semana |
| **Fase 2** | Swap de ingressos, app mobile, PSP produção + antifraude | — |

> **Antes de mainnet: auditoria externa dos contratos (obrigatória).**
