# Fluxos — Shaar

## Smart contracts

### Venda primária (mint)
Função de entrada: `TicketSale.buyTicket(eventId)` (cripto direto) ou `TicketSale.buyTicketFor(eventId, recipient)` (fiat, chamado pela treasury)
Quem pode chamar: qualquer (buyTicket) / treasury (buyTicketFor) — ambos `whenNotPaused` + `nonReentrant`
Etapas de execução:
1. Valida evento não pausado, capacidade (`maxTickets`) e janela de tempo (`eventTimestamp + 2h`).
2. Incrementa `soldTickets` → define `ticketNumber`.
3. Recebe pagamento: ETH (split via pull-payment `pendingWithdrawals`) ou ERC-20 (split direto `_splitERC20`).
4. Split organizador / plataforma por `platformFeeBps`.
5. Chama `TicketNFT.mint(MintParams)` → NFT enviado ao `recipient`, royalty apontando para o `RoyaltySplitter` do evento.
Eventos emitidos: `TicketSold`

### Criar evento
Função de entrada: `TicketSale.createEvent(organizer, ticketPrice, paymentToken, platformFeeBps, maxTickets, eventName, eventTimestamp, defaultSeat, royaltyBps, royaltyOrgShareBps)`
Quem pode chamar: owner
Etapas de execução:
1. Valida parâmetros (preço > 0, fee < 100%, royalty ≤ 10%).
2. Faz deploy de um `RoyaltySplitter(organizer, platformWallet, royaltyOrgShareBps)`.
3. Registra o `Event` em storage com `eventId` incremental.
Eventos emitidos: `EventCreated`

### Revenda — cripto direto
Função de entrada: `TicketResale.buyListedTicket(listingId)` / `buyListedTicketFor(listingId, recipient)`
Quem pode chamar: qualquer — `nonReentrant`
Etapas de execução:
1. Valida listing ativa, não travada e não expirada.
2. Lê royalty via ERC-2981 (`nft.royaltyInfo`).
3. Split triplo: vendedor / royaltyReceiver / plataforma (`platformFeeBps`).
4. Transfere o NFT do escrow (contrato) para o comprador.
Eventos emitidos: `TicketResold`

### Revenda — fiat (settler)
Função de entrada: `lockListing(listingId, buyer)` → `settleListedTicket(listingId, recipient)` ou `unlockListing(listingId)`
Quem pode chamar: `settler` (treasury) — `onlySettler`
Etapas de execução:
1. `lockListing`: trava a listing e fixa o `lockedBuyer` antes da cobrança PSP.
2. Pagamento liquidado off-chain pelo PSP (BRL para vendedor/organizador/plataforma).
3. `settleListedTicket`: valida `lockedBuyer == recipient` e transfere o NFT do escrow. Falha/timeout → `unlockListing`.
Eventos emitidos: `ListingLocked`, `TicketSettled`, `ListingUnlocked`

### Listar / cancelar listing
Função de entrada: `TicketResale.listTicket(tokenId, price, paymentToken, expiresAt)` / `cancelListing(listingId)`
Quem pode chamar: dono do NFT (list) / vendedor ou owner (cancel)
Etapas de execução (list): valida posse + aprovação → transfere NFT para escrow no contrato → cria `Listing`.
Eventos emitidos: `TicketListed`, `ListingCancelled`

### Freeze de metadata
Função de entrada: `TicketNFTLocked.freeze(tokenId, finalURI)`
Quem pode chamar: `OPERATOR_ROLE` (platformWallet)
Etapas de execução: marca `frozen[tokenId]` e fixa `_frozenURI` (CID IPFS imutável). O token continua transferível via contratos da plataforma (pode ser revendido como colecionável); só os metadados ficam bloqueados.
Eventos emitidos: `Frozen`

### Swap atômico
Função de entrada: `TicketSwap.proposeSwap(...)` → `acceptSwap(proposalId)`
Quem pode chamar: usuário A propõe / usuário B aceita
Etapas de execução: troca atômica dos dois NFTs + cobrança de taxa; reverte tudo se qualquer transferência falhar.
Eventos emitidos: `TicketsSwapped`

---

## Backend APIs (`app/app/api/**`)

### Sync de autenticação
Entrada: `POST /api/auth/sync`
Quem pode chamar: autenticado (Bearer token Privy)
Etapas: verifica token Privy → busca usuário Privy (email + wallet) → upsert do `User` por `privyId`.
Serviços usados: Privy, Prisma

### Checkout — venda primária
Entrada: `POST /api/events/:id/checkout`
Quem pode chamar: autenticado (comprador com wallet)
Etapas: valida evento `ON_SALE` e deployado on-chain → checa capacidade (mintados + em voo) → trava câmbio (`lockRate`) → cria cobrança PIX/cartão no PSP → cria `Purchase` `PENDING`. Método `USDC` ainda não implementado (501).
Serviços usados: Prisma, FX, PSP

### Checkout — revenda
Entrada: `POST /api/listings/:id/checkout`
Quem pode chamar: autenticado (comprador, não pode ser o próprio vendedor)
Etapas: valida listing `ACTIVE` + confirmada on-chain → reserva atômica `ACTIVE→LOCKED` (mutex) → `lockListingOnChain(buyer)` → cria cobrança PIX → cria `Purchase`. Qualquer falha libera a reserva.
Serviços usados: Prisma, FX, PSP, onchain (treasury/settler)

### Webhook PSP (state machine)
Entrada: `POST /api/webhooks/psp`
Quem pode chamar: público, mas com assinatura HMAC verificada sobre o corpo cru
Etapas: verifica assinatura → ignora status ≠ `paid` → `processPspPayment(chargeId)`: idempotência → marca `PAID` → `MINTING` → mint (venda primária via `buyTicketOnChain`) ou settle (revenda via `settleListedTicketOnChain`) → grava `Ticket`/`Listing`, marca `COMPLETED`. Em erro: `triggerRefund` (unlock + refund PSP).
Serviços usados: Prisma, PSP, onchain (treasury)

### Aprovar evento (deploy on-chain)
Entrada: `POST /api/admin/events/:id/approve`
Quem pode chamar: ADMIN
Etapas: valida `PENDING_APPROVAL` → marca `APPROVED` → `createEventOnChain` (owner) → grava `onchainEventId`/`royaltySplitterAddr`/txHash, marca `ON_SALE`. Falha → volta a `PENDING_APPROVAL`.
Serviços usados: Prisma, onchain (owner)

### Outras rotas admin/organizer
- `POST /api/organizer/apply` — cadastro de organizador (`PENDING`)
- `POST /api/admin/organizers/:id/{approve,reject}` — aprova/rejeita organizador (ADMIN)
- `POST /api/admin/events/:id/{reject,pause,freeze}` — gestão de evento (ADMIN); `pause`/`freeze` tocam a chain
- `POST /api/organizer/events` + `GET/PATCH /api/organizer/events/:id` — CRUD de eventos do organizador (status `DRAFT`/`PENDING_APPROVAL`)
- `POST /api/admin/setup-approvals` — aprova gasto de USDC da treasury (non-local)

### Saque (off-ramp)
Entrada: `POST /api/withdrawals` / `GET /api/withdrawals`
Quem pode chamar: organizador `APPROVED` com payout wallet
Etapas: lê saldo USDC on-chain da payout wallet (`getUsdcBalance`) − saques em voo → valida disponível → trava câmbio → cria `Withdrawal` `REQUESTED` (transferência USDC + PIX feitos por job assíncrono).
Serviços usados: Prisma, onchain (read), FX

### Check-in por QR
Entrada: `POST /api/checkin`
Quem pode chamar: STAFF ou ADMIN
Etapas: valida payload `shaar:v1:{tokenId}:{window}:{userId}:{sig}` (HMAC + janela 30s ±1) → confirma que o dono atual do ticket gerou o QR → valida status `VALID` → marca `CHECKED_IN` + cria `Checkin`.
Serviços usados: Prisma, HMAC (`QR_SECRET`)

### QR rotativo do ingresso
Entrada: `GET /api/me/tickets/:tokenId/qr`
Quem pode chamar: autenticado, dono do ticket
Etapas: confirma posse → gera payload HMAC da janela atual → retorna PNG do QR com cache curto (~30s).
Serviços usados: Prisma, HMAC, `qrcode`

### Leituras públicas
- `GET /api/events` e `GET /api/events/:id` — catálogo de eventos
- `GET /api/market` e `GET /api/listings` — listagens à venda
- `GET /api/me/tickets` — ingressos do usuário (autenticado)
- `GET /api/purchases/:id` — status da compra (polling do front)
- `GET /api/metadata/:tokenId` — metadata ERC-721 do token (servida ao `baseURI`)
- `POST /api/dev/simulate-payment/:purchaseId` — dispara `processPspPayment` em dev

---

## Front / App (`app/app/**`)

### Comprar ingresso (venda primária)
Descrição: usuário escolhe um evento, paga via PIX e acompanha o status até o NFT ser mintado para sua carteira Privy.
Telas envolvidas: Home (`/`), Detalhe do evento (`/events/[id]`), Meus ingressos (`/my-tickets`)
APIs consumidas: `POST /api/events/:id/checkout`, `GET /api/purchases/:id` (polling), `GET /api/me/tickets`

### Comprar no mercado secundário
Descrição: usuário navega listagens e compra um ingresso revendido.
Telas envolvidas: Mercado (`/market`)
APIs consumidas: `GET /api/market` / `GET /api/listings`, `POST /api/listings/:id/checkout`, `GET /api/purchases/:id`

### Meus ingressos / QR de entrada
Descrição: usuário vê seus ingressos e exibe o QR rotativo no portão.
Telas envolvidas: Meus ingressos (`/my-tickets`)
APIs consumidas: `GET /api/me/tickets`, `GET /api/me/tickets/:tokenId/qr`

### Painel do organizador
Descrição: organizador se cadastra, cria eventos (vão para aprovação) e solicita saques.
Telas envolvidas: Organizador (`/organizer`)
APIs consumidas: `POST /api/organizer/apply`, `POST /api/organizer/events`, `GET/PATCH /api/organizer/events/:id`, `POST /api/withdrawals`

### Painel admin
Descrição: admin aprova/rejeita organizadores e eventos (deploy on-chain), pausa e congela eventos.
Telas envolvidas: Admin (`/admin`)
APIs consumidas: `GET /api/admin/{organizers,events}`, `POST /api/admin/organizers/:id/{approve,reject}`, `POST /api/admin/events/:id/{approve,reject,pause,freeze}`

### Check-in (staff)
Descrição: staff escaneia o QR do ingresso na entrada do evento.
Telas envolvidas: Check-in (`/checkin`)
APIs consumidas: `POST /api/checkin`
