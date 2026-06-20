## O que foi feito até agora

### Decisões de produto (fechadas)

- **Chain:** Base (EVM L2) — contratos Solidity aproveitados integralmente
- **Carteira do usuário:** Embedded wallet via Privy (login por email/Google, sem cripto visível)
- **Pagamento:** Fiat-first (PIX + cartão via PSP) **e** USDC direto — os dois como opção de primeira classe no checkout
- **Moeda on-chain:** USDC (nativo da Circle na Base)
- **Gas:** Plataforma banca tudo — compras fiat via tesouraria, ações do usuário (listar revenda) via paymaster ERC-4337
- **Chave da plataforma:** Interface `Signer` desde o dia 1 (env var no MVP → KMS em produção, troca só config)
- **Escopo MVP:** Venda primária + admin, revenda, check-in/freeze. Swap fica pra fase 2.
- **Fluxo B2B:** Organizador self-service com aprovação — admin dispara o `createEvent` on-chain

---

### Contratos ([smart_contracts/src/](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/smart_contracts/src/))

Dois ajustes implementados e testados:

1. **`buyTicketFor` / `buyListedTicketFor`** — novas funções em `TicketSale.sol` e `TicketResale.sol`. Necessárias porque no fluxo fiat quem assina a tx é a tesouraria (não o comprador), então sem elas o NFT iria pra carteira errada.
    
2. **Bug de URI corrigido no `TicketNFT.sol`** — o `freeze` gerava URI corrompida (`https://api.../ipfs://Qm...`). Corrigido sobrescrevendo `tokenURI` pra tokens congelados.
    

**Suíte Foundry: 66/66 testes passando** (5 novos cobrindo os fluxos `*For`).

---

### Planejamento ([ticket-platform/PLANEJAMENTO.md](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/ticket-platform/PLANEJAMENTO.md))

Documento completo cobrindo:

- Arquitetura (Next.js full-stack + PostgreSQL/Prisma + Privy + Pinata + PSP + Base)
- 3 carteiras operacionais separadas (Owner, Operator, Tesouraria) + por que cada uma
- Modelo de dados completo (8 tabelas incluindo `purchases` com máquina de estados e `withdrawals` pro off-ramp PIX)
- ~25 endpoints REST organizados por papel (público, comprador, organizador, admin, staff, webhooks)
- 4 fluxos sequenciais detalhados (criação evento, compra fiat, revenda, check-in/freeze)
- Riscos: chargeback de cartão, gestão de float USDC/BRL, conciliação PSP↔chain com estorno automático, compliance
- Roadmap em 6 fases (~9–11 semanas até testnet)

---

### Preview clicável ([ticket-platform/preview/](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/ticket-platform/preview/))

7 telas HTML estáticas navegáveis (sem backend, dados fake):

|Arquivo|Tela|
|---|---|
|`index.html`|Catálogo de eventos|
|`evento.html`|Detalhe + checkout (PIX / cartão / USDC)|
|`ingressos.html`|Meus ingressos + QR + saldo USDC + saque PIX|
|`mercado.html`|Mercado de revenda com split triplo visível|
|`organizador.html`|Dashboard do organizador (receita, royalties, novo evento)|
|`admin.html`|Painel admin (filas de aprovação, ações on-chain)|
|`checkin.html`|Scanner de check-in pra staff na porta|

---

### Próximo passo natural

**Fase 0 do roadmap** — scaffolding do projeto real:

- Repo Next.js + Prisma + Privy configurado
- Script Foundry de deploy dos contratos no Anvil (local)
- Seed de dados de teste
- Interface `Signer` (env var, pronta pra KMS)




# FIXES

# Revisão — Shaar (contratos + serviços)

Escopo: `smart_contracts/src/*.sol` + `app/lib/*` + `app/app/api/**` + `worker/indexer.ts`. As descobertas de contrato eu analisei diretamente; as de backend foram levantadas por um agente e confirmei as críticas no código.

---

## 🔴 CRÍTICO

### 1. Webhook do PSP sem verificação de assinatura → mint/settle grátis para qualquer um

[webhooks/psp/route.ts:161-174](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/webhooks/psp/route.ts#L161-L174)

O `POST` aceita qualquer JSON `{ charge_id, status: "paid" }` e dispara `processPspPayment`, que minta NFT on-chain ou faz settle de revenda. **Não há HMAC/assinatura** (o próprio comentário na linha 159 admite). Como o `pspChargeId` é devolvido ao comprador no checkout, um atacante reusa/adivinha o id e força a tesouraria a mintar/transferir um ingresso **sem nunca pagar**. Roubo direto de ativo.

**Fix:** ler o corpo cru (`await req.text()`) e validar o header de assinatura do PSP (Pagar.me HMAC / `Stripe-Signature`) antes de processar. Rejeitar se inválido.

### 2. `freeze()` trava permanentemente um ingresso em escrow (perda definitiva do NFT)

[TicketNFT.sol:101-122](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/TicketNFT.sol#L101-L122) × [TicketResale.sol:107](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/TicketResale.sol#L107)

Quando um ingresso é listado, ele fica **em escrow** dentro do `TicketResale` (owner = contrato). Se o OPERATOR chamar `freeze(tokenId)` enquanto está listado, `_requireOwned` passa (o contrato é o dono) e o token vira soulbound. A partir daí `cancelListing`, `buyListedTicket` e `settleListedTicket` todos fazem `nft.transferFrom(address(this), …)` → `_update` reverte com `TokenFrozen`. **O NFT fica preso no contrato de revenda para sempre** — e `freeze` é irreversível (não há `unfreeze`). O endpoint admin de freeze itera todos os ingressos do evento, aumentando a chance de pegar uma listagem ativa/stale.

**Fix:** em `freeze`, exigir que o token não esteja em escrow (`ownerOf != address(resale)`), ou pular tokens listados; alternativamente, dar um caminho de `unfreeze` administrativo. Off-chain: cancelar/settle todas as listagens antes de congelar.

---

## 🟠 ALTO

### 3. Saque (`withdrawals`) sem verificação de saldo nem de titularidade

[withdrawals/route.ts:9-49](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/withdrawals/route.ts#L9-L49)

Só checa `role === ORGANIZER|ADMIN`. Cria um `Withdrawal` de **`amountUsdc` arbitrário** para um **`pixKey` arbitrário**, sem confrontar com saldo disponível/proventos do organizador, sem vincular ao evento, sem idempotência. Qualquer organizer pede payout de qualquer valor para qualquer PIX.

**Fix:** calcular saldo realmente disponível (proventos acumulados / splitter on-chain) e rejeitar `amountUsdc > disponível`; vincular o PIX a uma conta verificada (KYC), não a input livre.

### 4. Settler compromisso = dreno de todas as listagens em escrow

[TicketResale.sol:169-180](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/TicketResale.sol#L169-L180)

`settleListedTicket` transfere o NFT escrowed para um `recipient` arbitrário **sem qualquer pagamento on-chain** (confia que o PSP liquidou off-chain). Se a chave do `settler` (a tesouraria) vazar, o atacante chama `settleListedTicket(listingId, suaConta)` para cada listagem ativa e drena todos os ingressos em escrow sem pagar nada. É uma decisão de design (settler confiável), mas concentra risco numa hot key.

**Fix:** separar a chave do settler da tesouraria; idealmente multisig/timelock para o settler, ou exigir prova on-chain do pagamento.

### 5. Organizer controla `platformFeeBps` / `royaltyBps` / `royaltyOrgShareBps` pelo body

[organizer/events/route.ts:38-66](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/organizer/events/route.ts#L38-L66) → [onchain.ts](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/lib/onchain.ts)

A rota lê esses campos direto do request e os propaga para `createEventOnChain` sem clamp nem revalidação no approve. Organizer pode mandar `platformFeeBps: 0` (zera a plataforma) ou `royaltyOrgShareBps: 10000` (100% do royalty pra ele).

**Fix:** não aceitar fees do organizer; definir `platformFeeBps` por config do servidor e limitar royalties a faixas válidas, fixadas no approve do admin.

### 6. Corrida no checkout de revenda + falta de checagem de esgotado na venda primária

[listings/[id]/checkout/route.ts:24-71](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/listings/%5Bid%5D/checkout/route.ts#L24-L71) · [events/[id]/checkout/route.ts:17-59](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/events/%5Bid%5D/checkout/route.ts#L17-L59)

Revenda: dois compradores leem `status === ACTIVE` simultaneamente, ambos travam on-chain e criam charges — o status no DB nunca vira "reservado", então a checagem `ACTIVE` não é mutex real. Primária: nada checa `maxTickets`/esgotado antes de cobrar; só falha no mint (após o comprador pagar) → refund.

**Fix:** reservar em transação com `updateMany({ where: { id, status: "ACTIVE" }})` e checar `count === 1` antes de criar a charge; checar capacidade antes de cobrar.

### 7. `ticketNumber` por `count()+1` é racy → números duplicados

[webhooks/psp/route.ts:98-99](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/webhooks/psp/route.ts#L98-L99) · [worker/indexer.ts:55](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/worker/indexer.ts#L55)

Dois mints concorrentes (webhook + indexer safety-net) calculam o mesmo count. Sem `@@unique([eventId, ticketNumber])` no schema, duplicatas persistem.

**Fix:** derivar do evento `TicketSold` on-chain ou adicionar unique + alocação transacional.

---

## 🟡 MÉDIO

### 8. Lock de listagem não é respeitado na compra cripto

[TicketResale.sol:182-185](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/TicketResale.sol#L182-L185)

`lockListing` impede o vendedor de cancelar durante o checkout PSP, mas `_buyListed` (fluxo cripto) só checa `l.active`, **não `!l.locked`**. Um comprador cripto "snipa" a listagem travada; o settle do PSP depois reverte (`active=false`) e o comprador fiat é reembolsado. Sem perda de NFT (o flag `active` protege), mas o lock não cumpre o propósito.

**Fix:** adicionar `require(!l.locked, "Locked")` em `_buyListed`.

### 9. Refund marca `REFUNDED` mesmo se o estorno falhar

[webhooks/psp/route.ts:128-155](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/webhooks/psp/route.ts#L128-L155)

`triggerRefund` só faz `console.error` se `psp.refund` lançar, e em seguida grava `REFUNDED` incondicionalmente — o comprador pode nunca ter sido estornado. O estado `FAILED` nunca é usado.

**Fix:** só marcar `REFUNDED` com estorno confirmado; senão `FAILED` + alerta para reconciliação manual.

### 10. Pagamentos por `.call` a organizer/recipient podem travar swap/venda/royalty (griefing DoS)

[TicketSwap.sol:166-168](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/TicketSwap.sol#L166-L168) · [TicketSale.sol:195](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/TicketSale.sol#L195) · [RoyaltySplitter.sol:32-45](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/RoyaltySplitter.sol#L32-L45)

Se um organizer for um contrato que reverte ao receber ETH, `_payETH`/`_splitETH` reverte e derruba a transação inteira (aceitar swap, comprar ingresso, receber royalty). Organizer é semi-confiável, mas é um vetor de griefing.

**Fix:** padrão pull-payment (acumular saldo e `withdraw()`) em vez de push direto.

### 11. `auth/sync` sobrescreve a carteira a cada login + 500 em unique constraint

[auth/sync/route.ts:18-25](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/auth/sync/route.ts#L18-L25)

Pega o primeiro `type === "wallet"` (pode não ser a embedded) e regrava `walletAddress` a cada sync, quebrando queries por titularidade; `upsert` em email/wallet duplicado estoura Prisma 500.

### 12. QR de check-in replayável e comparação de HMAC não constante

[checkin/route.ts:21-33](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/checkin/route.ts#L21-L33)

Assina só `tokenId:window` com janela ±1 (~90s) e não vincula a evento/portador; print da tela permite replay até o primeiro scan. Comparação `sig !== expectedSig` não é constant-time → usar `crypto.timingSafeEqual`.

---

## 🟢 BAIXO / INFO

- **`dev/simulate-payment`** ([route.ts:13-15](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/dev/simulate-payment/%5BpurchaseId%5D/route.ts#L13-L15)): guardado só por `NODE_ENV === "production"`; em `staging`/unset vira segunda via de mint grátis. Use flag fail-closed (`ENABLE_DEV_ROUTES !== "true"` → 404).
- **`TicketSwap` não é deployado** no [Deploy.s.sol](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/script/Deploy.s.sol) — só USDC/NFT/Sale/Resale. Swap está inutilizável no estado atual; confirmar se é intencional.
- **Chave privada hardcoded** no deploy [Deploy.s.sol:67-68](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/script/Deploy.s.sol#L67-L68) — é a chave conhecida do Anvil (dev), mas garanta que nunca rode contra mainnet.
- **`_distributeFee` para `address(0)`**: ingresso sem `organizer` faz `_payETH(address(0), share)` — `.call` retorna `true` e a fatia é **queimada**. Validar organizer != 0.
- **`!event.onchainEventId`** em [admin/.../pause/route.ts:18](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/app/api/admin/events/%5Bid%5D/pause/route.ts#L18) trata `eventId === 0` (válido) como "não on-chain". Usar `=== null` (checkout e webhook já usam).
- **Indexer**: `getLastBlock` começa em `head-1` sem deploy block ([indexer.ts:12-17](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/worker/indexer.ts#L12-L17)) → perde eventos históricos; e o handler de `Transfer` grava o contrato de escrow como `ownerAddress` durante a listagem ([indexer.ts:90-98](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/app/worker/indexer.ts#L90-L98)).

---

## Resumo / ordem de ataque

1. **#1 webhook sem assinatura** — feche primeiro, é mint/settle grátis público.
2. **#2 freeze trava NFT em escrow** — perda permanente de ativo on-chain.
3. **#3 withdrawals sem saldo** + **#5 fees pelo organizer** + **#4 settler hot key** — núcleo de integridade financeira.
4. **#6/#7** corridas de checkout e numeração de ingresso.

O lado positivo: o uso de OpenZeppelin está correto (ReentrancyGuard + checks-effects-interactions nos contratos de pagamento, ERC-2981 com royalty imutável anti-manipulação em [TicketResale.sol:190](vscode-webview://0pq9c75jlufe4hmtsljtsf0f98iivk4qlnubsuggusnobqlpnch2/shaar/smart_contracts/src/TicketResale.sol#L190), SafeERC20, soulbound pós-freeze). Os problemas são de **interação entre contratos** (freeze×escrow), **confiança off-chain** (settler/webhook) e **autorização/validação no backend** — não de matemática de tokens.

Quer que eu **aplique as correções** de algum desses (sugiro começar por #1, #2 e #3), ou prefere que eu detalhe o patch de algum item específico antes?