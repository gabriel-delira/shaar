# Plataforma de Ingressos NFT — Planejamento (Caso 2)

> Plataforma B2B2C sobre os contratos já implementados em `../smart_contracts/src/`
> (`TicketNFT`, `TicketSale`, `TicketResale`, `TicketSwap`, `RoyaltySplitter`).

---

## 1. Decisões já tomadas (com Gabriel)

| Tema | Decisão |
|---|---|
| Chain | **Base** (EVM L2) — contratos atuais funcionam sem alteração. Dev local em **Anvil**, validação em **Base Sepolia**, produção em Base mainnet. |
| Carteira do usuário | **Embedded wallet** (login com email/Google via **Privy**) — usuário não precisa saber o que é cripto. |
| Stack | **Next.js full-stack TypeScript** (App Router): frontend + API routes + worker de indexação. Web3 via **viem/wagmi**. |
| Escopo do MVP | Venda primária + painel admin, mercado de revenda, check-in + freeze pós-evento. **Swap fica fora do MVP** (fase 2). |
| Fluxo B2B | Organizador **self-service com aprovação**: cadastra evento no dashboard → admin revisa → aprovação dispara `createEvent` on-chain pela carteira da plataforma. |
| Pagamento do comprador | **Três formas, lado a lado no checkout**: (a) **PIX** e (b) **cartão** via PSP (Pagar.me, Stone ou Stripe) — confirmado o pagamento, a **tesouraria da plataforma** executa a compra on-chain em USDC e o NFT é mintado direto na carteira do comprador (requer `buyTicketFor`, ver seção 3.1); (c) **USDC direto** — o comprador assina `buyTicket` com a própria carteira, sem PSP no meio. |
| Moeda on-chain | **USDC** (nativo da Circle na Base; USDT lá é bridged e menos líquido). |
| Gas | Compra/mint: pago pela tesouraria (quem assina paga) — sem paymaster. Ações assinadas pelo usuário (listar revenda etc.): **paymaster ERC-4337** patrocina o gas. |
| Chave da plataforma | Camada de assinatura abstraída desde o início (interface `Signer`): **env var no MVP → Privy Server Wallets em produção** trocando só configuração. Privy já cobre user wallets; usar Server Wallets consolida tudo num único vendor. |

### Premissas que assumi (me corrija se algo estiver errado)

1. **Banco: PostgreSQL + Prisma.** Indexação dos eventos on-chain feita por um listener próprio (viem `watchContractEvent`) — sem subgraph no MVP.
2. **IPFS via Pinata** para o snapshot de metadados no freeze pós-evento.
3. **QR code de check-in é off-chain** (payload assinado pelo backend + verificação de ownership on-chain no momento do scan). Não há transação na porta do evento.
4. **Freeze é disparado por job do admin** após o evento (a carteira da plataforma tem `OPERATOR_ROLE` no `TicketNFT`).
5. **Preço do evento é fixado em USDC on-chain**; o valor em BRL cobrado no PSP é calculado na hora do checkout pela cotação do dia (+ spread configurável da plataforma).
6. **USDC direto é opção de primeira classe no checkout** (não fallback): o comprador paga com a própria carteira via `buyTicket`/`buyListedTicket`, e a embedded wallet também pode ser usada pra isso (ex.: gastando saldo de revendas). Pra essas transações assinadas pelo usuário, o gas é patrocinado via paymaster.

---

## 2. Arquitetura

```
┌─────────────────────────────── Next.js (Vercel ou Docker) ───────────────────────────────┐
│                                                                                           │
│  Frontend (React/App Router)          API Routes (/api/*)            Worker               │
│  ├─ Catálogo / Detalhe evento         ├─ REST (seção 5)              ├─ Indexer de        │
│  ├─ Checkout (Privy + wagmi)          ├─ /api/metadata/:tokenId  ◄───┤   eventos on-chain │
│  ├─ Meus ingressos (QR)               │   (baseURI do TicketNFT)     ├─ Job de expiração  │
│  ├─ Mercado de revenda                ├─ Tx server-side (admin):     └─ Job de freeze     │
│  ├─ Dashboard organizador             │   createEvent, pause,                             │
│  ├─ Painel admin                      │   freeze                                          │
│  └─ Scanner de check-in               └─ Validação QR                                     │
│                                                                                           │
└───────────┬──────────────────────────────┬─────────────────────────────┬─────────────────┘
            │                              │                             │
      ┌─────▼─────┐                 ┌──────▼──────┐               ┌──────▼──────┐
      │   Privy   │                 │  PostgreSQL │               │ Base (RPC)  │
      │ auth +    │                 │  (Prisma)   │               │ TicketNFT   │
      │ embedded  │                 └─────────────┘               │ TicketSale  │
      │ wallets   │                 ┌─────────────┐               │ TicketResale│
      └───────────┘                 │   Pinata    │               │ RoyaltySplt │
                                    │   (IPFS)    │               └─────────────┘
      ┌───────────────────┐         └─────────────┘               ┌─────────────┐
      │  PSP (Pagar.me /  │  webhook "pago" → backend executa     │  Paymaster  │
      │  Stone / Stripe)  │  compra on-chain pela tesouraria      │  ERC-4337   │
      │  PIX + cartão     │                                       │ (gas de ações
      └───────────────────┘                                       │  do usuário)│
                                                                  └─────────────┘
```

**Carteiras da plataforma** (separação de poderes, todas atrás da camada `Signer` env→Privy Server Wallets):

| Carteira | Papel | Saldo que mantém |
|---|---|---|
| **Owner/Admin** | `createEvent`, pause, fees (`onlyOwner`) | ETH pra gas |
| **Operator** | `freeze` pós-evento (`OPERATOR_ROLE`) | ETH pra gas |
| **Tesouraria** | Executa compras fiat-first (`buyTicketFor`) | **USDC** (float) + ETH pra gas |

**Quem assina o quê:**

| Ação | Assinante | Contrato |
|---|---|---|
| `createEvent`, `toggleEventPause`, `updatePlatformFee` | Owner/Admin (backend) | `TicketSale` |
| `freeze` | Operator (backend) | `TicketNFT` |
| `buyTicketFor(eventId, comprador)` — fluxo fiat | **Tesouraria** (backend, após webhook do PSP) | `TicketSale` |
| `buyTicket` — fluxo cripto-direto (opcional) | Comprador (carteira própria) | `TicketSale` |
| `approve` + `listTicket` / `cancelListing` | Vendedor (embedded wallet, gas via paymaster) | `TicketNFT` + `TicketResale` |
| `buyListedTicketFor(listingId, comprador)` — fluxo fiat | **Tesouraria** (backend) | `TicketResale` |

---

## 3. Pontos de atenção

### 3.1 Mudança nos contratos (fluxo fiat-first) — ✅ IMPLEMENTADO

`buyTicket` mintava pra `msg.sender` e `buyListedTicket` transferia pra `msg.sender` — no fluxo
fiat a tesouraria assina a transação, então o NFT iria pra tesouraria. Implementado em 12/06/2026:

- `TicketSale.buyTicketFor(eventId, recipient)` — quem chama paga (ETH ou ERC-20), o NFT é
  mintado pro `recipient`. `buyTicket` virou atalho pra `_buyTicket(eventId, msg.sender)`.
- `TicketResale.buyListedTicketFor(listingId, recipient)` — mesma ideia na revenda.
- Bônus: corrigido bug pré-existente no `TicketNFT.freeze` — o `ERC721URIStorage` concatenava
  `baseURI` + URI congelada (gerando `https://api...//ipfs://Qm...`); agora a URI congelada é
  armazenada à parte e retornada intacta (`tokenURI` sobrescrito).

Suíte Foundry: **66/66 testes passando** (5 novos cobrindo os fluxos `*For`).

### 3.2 Conceitos e consequências do modelo fiat-first

1. **Paymaster ≠ financiador de compra.** O paymaster (ERC-4337) paga apenas o **gas** (taxa de
   rede, centavos na Base) de transações assinadas pelo usuário — nunca o valor do ingresso.
   No nosso fluxo: a compra é assinada pela tesouraria (que já paga o próprio gas, sem paymaster);
   o paymaster entra só nas ações do usuário, como listar revenda (`approve` + `listTicket`),
   pra ele nunca precisar ter ETH. Privy + Base (paymaster da Coinbase) suportam isso nativamente.
2. **Off-ramp pra vendedores de revenda.** O split on-chain paga o vendedor em **USDC** na embedded
   wallet dele. Usuário fiat-first vai querer R$ → precisamos de "Sacar via PIX" (plataforma recompra
   o USDC e envia PIX), com KYC básico do recebedor. Entra na fase de revenda.
3. **Gestão de tesouraria.** Plataforma recebe BRL (PSP) e gasta USDC (chain): precisa de rotina de
   recompra de USDC (Transfero, Bitso, Mercado Bitcoin OTC ou Circle), monitoramento do float e
   spread BRL/USD configurável no preço de checkout. Alarmes de saldo mínimo (USDC e ETH de gas).
4. **Conciliação PSP ↔ chain.** Webhook de pagamento precisa ser idempotente; se a tx on-chain
   falhar após o PIX cair (ex.: evento esgotou no meio), fluxo de **estorno automático** no PSP.
   Tabela `purchases` (seção 4) guarda o estado dessa máquina: `PAID → MINTING → COMPLETED | REFUNDED`.
5. **Chargeback de cartão.** NFT já mintado + chargeback = prejuízo da plataforma. Mitigações:
   PIX como método preferido (sem chargeback), limites por cartão novo, e possibilidade de
   bloquear o check-in do ingresso em disputa (flag off-chain).

### 3.3 Demais riscos

6. **Custódia das chaves.** Interface `Signer` única no backend desde o dia 1: implementação env var
   no MVP → **Privy Server Wallets** em produção, trocando só config. Owner,
   Operator e Tesouraria são chaves separadas (limita o raio de explosão de um vazamento).
   Privy Server Wallets consolida num único vendor o que antes exigiria KMS/Turnkey separado.
7. **Aprovação dupla na revenda em ERC-20.** `buyListedTicket` com USDC faz 3 `transferFrom` do
   comprador — no fluxo fiat a tesouraria mantém um `approve` alto pro contrato de revenda (renovado
   por rotina), então isso só afeta o fluxo cripto-direto.
8. **Discrepâncias doc × contrato** (registro; swap está fora do MVP): o doc descreve taxa de swap
   fixa+percentual, o contrato implementa só fixa; `proposalTTL` default é 5 min (doc fala 24h/7d).
9. **Compliance:** LGPD (dados de comprador), nota fiscal de ingresso, KYC de organizador (recebe
   repasse direto on-chain) e enquadramento da recompra de USDC (off-ramp). Definir antes da produção.

---

## 4. Modelo de dados (PostgreSQL / Prisma)

```
users            id, privy_id, email, wallet_address, role (BUYER|ORGANIZER|ADMIN|STAFF), created_at
organizers       id, user_id → users, company_name, document (CNPJ), payout_wallet,
                 status (PENDING|APPROVED|REJECTED), created_at
events           id, organizer_id → organizers, title, description, venue, city, cover_image_url,
                 event_date, ticket_price_usdc, max_tickets, platform_fee_bps, royalty_bps,
                 royalty_org_share_bps, status (DRAFT|PENDING_APPROVAL|APPROVED|ON_SALE|PAUSED|
                 ENDED|FROZEN|REJECTED),
                 onchain_event_id (uint), royalty_splitter_address, create_tx_hash, created_at
tickets          token_id (PK, on-chain), event_id → events, owner_address, ticket_number,
                 seat, face_price, status (VALID|LISTED|CHECKED_IN|FROZEN), mint_tx_hash, minted_at
listings         id, onchain_listing_id, token_id → tickets, seller_address, price, payment_token,
                 expires_at, status (ACTIVE|SOLD|CANCELLED|EXPIRED), tx_hash, created_at
purchases        id, user_id → users, event_id → events, listing_id? → listings,
                 amount_brl, amount_usdc, fx_rate, psp_provider, psp_charge_id (UNIQUE, idempotência),
                 payment_method (PIX|CARD), status (PENDING|PAID|MINTING|COMPLETED|REFUNDING|REFUNDED|FAILED),
                 mint_tx_hash, token_id?, created_at, paid_at, completed_at
withdrawals      id, user_id → users, amount_usdc, amount_brl, fx_rate, pix_key,
                 status (REQUESTED|PROCESSING|PAID|FAILED), usdc_transfer_tx_hash?, created_at
checkins         id, token_id → tickets, event_id, staff_user_id, scanned_at
sync_state       contract_address (PK), last_processed_block
```

> `tickets.owner_address` e `listings.status` são **espelho do on-chain**, atualizados pelo indexer.
> A fonte de verdade de posse é sempre a chain; o banco serve pra busca/UX.

---

## 5. API (Next.js Route Handlers — REST)

Autenticação: token do Privy no header `Authorization: Bearer`, verificado server-side.
Roles checadas no banco (`users.role`).

### Público
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/events` | Lista eventos `ON_SALE` (filtros: `?city=&from=&to=&q=`) |
| GET | `/api/events/:id` | Detalhe + disponibilidade (`sold/max`, preço, taxas) |
| GET | `/api/metadata/:tokenId` | **Metadados ERC-721** (JSON OpenSea-compatible). É pra cá que o `baseURI` do `TicketNFT` aponta. Pós-freeze, redireciona pro CID do IPFS. |

### Autenticado (comprador)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/sync` | Upsert do usuário após login Privy (cria registro + vincula wallet) |
| POST | `/api/events/:id/checkout` | Cria `purchase`. Body: `{method: PIX\|CARD\|USDC}`. PIX/cartão: retorna QR PIX / sessão de cartão + preço BRL travado (cotação + spread). USDC: retorna a tx pronta (`to`, `data`, `value`) pra carteira do usuário assinar |
| GET | `/api/purchases/:id` | Status da compra (polling do front: `PENDING → PAID → MINTING → COMPLETED`) |
| GET | `/api/me/tickets` | Meus ingressos (indexados, com status e dados do evento) |
| GET | `/api/me/tickets/:tokenId/qr` | Payload do QR: `{tokenId, exp, nonce}` assinado pelo backend (rotaciona a cada 60s) |
| GET | `/api/me/balance` | Saldo USDC da embedded wallet (proventos de revenda) + equivalente em BRL |
| POST | `/api/me/withdrawals` | Saque via PIX: usuário assina transfer do USDC → tesouraria (gas via paymaster), plataforma envia PIX |
| GET | `/api/listings` | Listagens ativas do mercado (`?eventId=`) com breakdown do split |
| POST | `/api/listings/intent` | Tx pronta pra `approve` + `listTicket` (assinada pela embedded wallet, gas via paymaster) |
| POST | `/api/listings/:id/checkout` | Compra de revenda em fiat — mesmo fluxo PSP do checkout primário (tesouraria executa `buyListedTicketFor`) |
| POST | `/api/listings/:id/cancel-intent` | Tx pronta pra `cancelListing` |

### Webhooks (PSP → backend)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/webhooks/psp` | Confirmação de pagamento (idempotente por `psp_charge_id`). `PAID` → tesouraria executa `buyTicketFor`/`buyListedTicketFor` → `COMPLETED`. Falha on-chain (ex.: esgotou) → estorno automático → `REFUNDED` |

### Organizador
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/organizer/apply` | Cadastro de organizador (→ `PENDING`) |
| GET | `/api/organizer/events` | Meus eventos + métricas (vendidos, receita, royalties) |
| POST | `/api/organizer/events` | Submete evento (→ `PENDING_APPROVAL`) |
| PATCH | `/api/organizer/events/:id` | Edita enquanto `DRAFT`/`PENDING_APPROVAL` |
| GET | `/api/organizer/events/:id/sales` | Vendas detalhadas, holders, revendas e royalties recebidos |

### Admin
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/organizers?status=PENDING` | Fila de aprovação de organizadores |
| POST | `/api/admin/organizers/:id/approve` \| `/reject` | Aprova/rejeita organizador |
| GET | `/api/admin/events?status=PENDING_APPROVAL` | Fila de aprovação de eventos |
| POST | `/api/admin/events/:id/approve` | **Dispara `createEvent` on-chain** (assina com a carteira da plataforma), salva `onchain_event_id` + `royalty_splitter_address` |
| POST | `/api/admin/events/:id/reject` | Rejeita com motivo |
| POST | `/api/admin/events/:id/pause` | `toggleEventPause` on-chain |
| POST | `/api/admin/events/:id/freeze` | Pós-evento: snapshot dos metadados → pin no IPFS → `freeze(tokenId, cid)` em batch |
| GET/PATCH | `/api/admin/config` | Fee padrão, carteira da plataforma, fee de revenda (`setPlatformFee`) |

### Check-in (role STAFF)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/checkin/validate` | Recebe payload do QR → verifica assinatura + expiração + `ownerOf(tokenId)` on-chain + não usado → marca `CHECKED_IN` |
| GET | `/api/checkin/events/:id/stats` | Entradas × vendidos em tempo real |

### Worker (interno, não exposto)
- **Indexer**: `watchContractEvent` em `TicketSold`, `TicketMinted`, `TicketListed`, `TicketResold`, `ListingCancelled`, `Frozen`, `Transfer` → atualiza `tickets`/`listings`/`events` + `sync_state` (com replay de blocos perdidos no boot).
- **Job de expiração**: marca `listings` expiradas.
- **Job de freeze**: N horas após `event_date`, gera snapshot por token, pina no Pinata e chama `freeze`.

---

## 6. Fluxos principais

### 6.1 Criação de evento (self-service + aprovação)
```
Organizador                    API/Banco                      Admin              Base (chain)
    │  POST /organizer/events     │                              │                    │
    ├────────────────────────────►│ status=PENDING_APPROVAL      │                    │
    │                             ├─────────────────────────────►│ revisa no painel   │
    │                             │   POST /admin/events/:id/approve                  │
    │                             │◄─────────────────────────────┤                    │
    │                             │ assina createEvent(...) ─────────────────────────►│
    │                             │◄── EventCreated(eventId, splitter) ───────────────┤
    │   notificação "no ar"       │ status=ON_SALE, salva onchain_event_id            │
    │◄────────────────────────────┤                              │                    │
```

### 6.2 Compra primária (fiat-first)
```
Comprador                  API/PSP                        Tesouraria             Base (chain)
    │ login email (Privy → embedded wallet criada)            │                      │
    │ POST /events/:id/checkout {PIX}                         │                      │
    ├──────────────────────────►│ cria purchase + QR PIX      │                      │
    │ paga o PIX                │ (preço BRL = USDC × câmbio  │                      │
    │                           │  + spread, travado 15 min)  │                      │
    │                           │◄── webhook "pago" (PSP)     │                      │
    │                           ├────────────────────────────►│ buyTicketFor(        │
    │                           │                             │   eventId, comprador)│
    │                           │                             ├─────────────────────►│
    │                           │   split USDC: organizador recebe na hora ◄─────────┤
    │                           │◄── indexer vê TicketSold/TicketMinted ─────────────┤
    │ "Ingresso #143 é seu" ◄───┤ purchase = COMPLETED        │                      │
```
> Falha on-chain depois do PIX pago (ex.: esgotou na concorrência) → estorno automático no PSP.

### 6.3 Revenda
```
Vendedor: "Revender" em Meus Ingressos → define preço em BRL (convertido pra USDC)
  → embedded wallet assina approve(NFT) + listTicket (gas patrocinado pelo paymaster)
Comprador: mercado → vê breakdown (vendedor / royalty organizador / taxa plataforma)
  → paga PIX/cartão → webhook → tesouraria executa buyListedTicketFor(listingId, comprador)
  → split triplo em USDC on-chain + NFT transferido → indexer atualiza dono e listagem
Vendedor depois: "Sacar via PIX" → transfere USDC pra tesouraria → plataforma envia PIX (off-ramp)
```

### 6.4 Check-in e freeze
```
Porta: app staff escaneia QR (payload assinado, expira em 60s)
  → POST /checkin/validate → confere assinatura + ownerOf on-chain + não usado → ✓ entrada
Pós-evento (job): snapshot metadados → pin IPFS → freeze(tokenId, ipfs://CID)
  → NFT vira soulbound (lembrança/colecionável, intransferível)
```

---

## 7. Telas (wireframes)

> Versão navegável com dados fake em [`preview/index.html`](preview/index.html).

### Catálogo (home pública)
```
┌──────────────────────────────────────────────────────────────┐
│ ◆ TicketChain     [Eventos] [Mercado]        [Entrar c/email]│
├──────────────────────────────────────────────────────────────┤
│  Busca: [____________]  Cidade: [▼]  Data: [▼]               │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│  │ (capa)   │  │ (capa)   │  │ (capa)   │                    │
│  │ Show X   │  │ Festival │  │ Conf Y   │                    │
│  │ 12/08 SP │  │ 20/09 RJ │  │ 03/10 SP │                    │
│  │ R$ 250   │  │ R$ 480   │  │ R$ 120   │                    │
│  │ 142/500  │  │ ESGOTADO │  │ 89/300   │                    │
│  └──────────┘  └──────────┘  └──────────┘                    │
└──────────────────────────────────────────────────────────────┘
```

### Detalhe do evento + checkout
```
┌──────────────────────────────────────────────────────────────┐
│  (banner do evento)                                          │
│  Show X — 12/08/2026 20h — Allianz Parque, SP                │
│  Organizador: Produtora ABC ✓                                │
│                                                              │
│  ┌────────────────────────────┐  ┌────────────────────────┐  │
│  │ Sobre o evento ...         │  │ Ingresso: R$ 250       │  │
│  │                            │  │ (≈ 45,40 USDC)         │  │
│  │ Disponíveis: 358/500       │  │ [ Comprar ingresso ]   │  │
│  │                            │  │ taxa plataforma incl.  │  │
│  └────────────────────────────┘  └────────────────────────┘  │
│  Modal pós-clique: login Privy → confirmar → "NFT #143 é seu"│
└──────────────────────────────────────────────────────────────┘
```

### Meus ingressos
```
┌──────────────────────────────────────────────────────────────┐
│  Meus Ingressos                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ ▓▓ QR ▓▓   Show X — #143 de 500 — Pista             │     │
│  │ ▓▓    ▓▓   12/08/2026 · VÁLIDO                      │     │
│  │            [Ver QR]  [Revender]  [ver na chain ↗]   │     │
│  └─────────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ (cinza)    Festival Z — #87 — USADO/CONGELADO 🔒    │     │
│  │            lembrança colecionável (soulbound)       │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### Mercado de revenda
```
┌──────────────────────────────────────────────────────────────┐
│  Mercado · Show X                                            │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ #201 Pista    R$ 310   vendedor 0xAb..3f   [Comprar] │    │
│  │   split: vendedor R$ 263 · organizador R$ 31 (10%)   │    │
│  │          plataforma R$ 16 (5%)                       │    │
│  └──────────────────────────────────────────────────────┘    │
│  [+ Revender meu ingresso]                                   │
└──────────────────────────────────────────────────────────────┘
```

### Dashboard organizador / Painel admin / Check-in
```
Organizador: cards (receita, vendidos, royalties) + tabela de eventos + [Novo evento]
Admin: fila de aprovações (organizadores, eventos) + ações on-chain (aprovar→createEvent,
       pausar, freeze) + config de fees
Check-in: tela mobile fullscreen com câmera/entrada manual → ✓ verde (entrada ok) /
          ✗ vermelho (já usado / inválido) + contador entradas/vendidos
```

---

## 8. Roadmap

| Fase | Entrega | Estimativa |
|---|---|---|
| **0 — Setup + contratos** | Repo Next.js + Prisma + Privy + Anvil com deploy script (Foundry) + seed. **`buyTicketFor` / `buyListedTicketFor` nos contratos + testes.** Interface `Signer` (env var, pronta pra Privy Server Wallets) | 4–6 dias |
| **1 — Venda primária fiat** | Catálogo, detalhe, checkout PIX/cartão (PSP sandbox), webhook idempotente, máquina de estados `purchases` com estorno, tesouraria executando `buyTicketFor`, fluxo organizador→aprovação admin→`createEvent`, indexer básico | 2–2,5 semanas |
| **2 — Ingressos & metadata** | Meus ingressos, QR, endpoint `/api/metadata/:tokenId`, `setBaseURI` | 3–5 dias |
| **3 — Revenda + off-ramp** | Mercado, listar/cancelar (embedded wallet + paymaster), compra fiat de revenda, saldo USDC e **saque via PIX** | 1,5 semana |
| **4 — Check-in & freeze** | Scanner staff, validação, job de freeze com IPFS | 1 semana |
| **5 — Testnet & hardening** | Base Sepolia, paymaster real (Coinbase), **migração env→Privy Server Wallets**, rotina de recompra de USDC + alarmes de float, monitoramento | 1,5 semana |
| **Fase 2 (pós-MVP)** | Swap de ingressos (resolver discrepâncias do contrato), PSP de produção + antifraude de cartão, app mobile | — |

> Antes de mainnet: **auditoria externa dos contratos** (obrigatória pelo doc de arquitetura).
