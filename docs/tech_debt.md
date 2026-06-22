# Tech Debt — shaar

> Auditoria automatizada (BUG/FLOW/DOC + GAP cross-tier) — 2026-06-21.
> Formato: `[TIPO] caminho:linha — descrição — SEVERIDADE`. Ordenado por severidade.
> **GAP** = lacuna de fluxo front↔back: _órfão_ (back existe, nada chama) · _front-sem-back_ (UI chama o que não existe) · _ação-solta_ (infra pronta nas duas pontas, botão não ligado).

## HIGH

- **[GAP]** `app/app/providers.tsx` × `app/app/api/auth/sync/route.ts:21` — _[órfão]_ `POST /api/auth/sync` (faz `prisma.user.upsert` após login Privy) **nunca é chamado pelo front**. `PrivyProvider` não tem `onSuccess`/`useLogin` que dispare o sync. Como `getAuthUser` (lib/auth.ts:17) só faz `findUnique({privyId})` e retorna null se não existir, **todo usuário recém-logado nunca entra no banco → toda rota autenticada (checkout, /api/me/tickets, organizer/apply, checkin, listings) responde 401**. Quebra o produto inteiro pós-login. Doc esperado: fluxos.md:66-67. — HIGH
- **[GAP]** `app/app/organizer/page.tsx` × `app/app/api/withdrawals/route.ts:10` — _[órfão]_ saque/off-ramp do organizador (`POST /api/withdrawals` USDC→BRL via PIX, `GET` para listar) **não tem NENHUMA UI**. A página só tem candidatura, criação de evento e tabela read-only — sem botão "Sacar", campo pixKey/amount ou listagem. Capacidade central paga inalcançável. Doc: fluxos.md:103-106,149,151. — HIGH
- **[BUG]** `app/app/api/webhooks/psp/route.ts:20-39` — idempotência de `processPspPayment` é read-then-write não-atômico; webhooks duplicados/concorrentes do PSP passam ambos pelo check PENDING e mintam/transferem o ingresso duas vezes. O checkout de revenda usa mutex atômico (`updateMany` ACTIVE→LOCKED), mas o webhook não usa o equivalente (`updateMany` PENDING→PAID). Viola a invariante "processPspPayment é idempotente". — HIGH
- **[BUG]** `app/worker/indexer.ts:172-203` — `reconcileStuckMinting` reembolsa compras que podem já ter sido mintadas on-chain. Se `buyTicketOnChain` sucede mas o processo morre antes do commit do `$transaction`, a compra fica MINTING/mintTxHash null e o reconciler reembolsa o BRL do comprador que ainda detém o NFT. Nunca re-checa a chain (receipt/balance) antes de reembolsar. — HIGH

## MEDIUM

- **[BUG]** `app/app/api/withdrawals/route.ts:35-49` — checagem de saldo de saque é TOCTOU sem reserva atômica, apesar do comentário alegar prevenir double-withdrawal. Duas requisições concorrentes leem o mesmo saldo e a mesma soma "committed" (nenhuma criou a row ainda), ambas passam e criam saques REQUESTED que somados excedem o saldo. Sem lock/insert condicional/constraint. — MEDIUM
- **[BUG]** `app/app/api/listings/[id]/cancel/route.ts:39-42` — `cancelListing` marca a Listing como CANCELLED e o Ticket como VALID antes do seller submeter o tx on-chain (a rota só devolve calldata). Se o seller nunca submete, o NFT fica em escrow e a listing on-chain ativa, mas o DB mostra VALID — permitindo relistar (listing fantasma) um token que o seller não custodia. Viola "a chain é a fonte da verdade". — MEDIUM
- **[FLOW]** `app/app/api/listings/route.ts:36-38` — ingresso congelado fica permanentemente não-relistável no app: a rota de freeze seta `Ticket.status=FROZEN` e o endpoint de listing rejeita tudo que não seja VALID, contradizendo a invariante "continua transferível / colecionável". O contrato permite a transferência; o app bloqueia o caminho documentado de revenda. — MEDIUM
- **[FLOW]** `app/app/api/listings/route.ts` — docs (fluxos.md "Leituras públicas" e front) documentam `GET /api/market` e `GET /api/listings`, mas listings/route.ts só exporta POST; um GET retorna 405. A única leitura de mercado funcional é `GET /api/market`. — MEDIUM
- **[GAP]** `app/app/market/page.tsx` × `app/app/api/listings/[id]/cancel/route.ts:10` — _[órfão]_ `POST /api/listings/:id/cancel` não tem botão na UI. A market/page.tsx só mostra "Comprar"; o vendedor não tem como cancelar sua própria listagem pela interface. Doc: fluxos.md:44-48. — MEDIUM
- **[GAP]** `app/app/admin/page.tsx:146` × `app/app/api/admin/events/[id]/freeze/route.ts:9` — _[órfão]_ `POST /api/admin/events/:id/freeze` não tem botão no painel admin (só Aprovar/Rejeitar/Pausar). Doc: fluxos.md:99,154,156. — MEDIUM

## LOW

- **[DOC]** `app/app/api/admin/events/[id]/freeze/route.ts:7` — comentário da rota de freeze diz que torna cada NFT "soulbound", contradizendo o contrato (`TicketNFT.freeze` só fixa a URI; "remains freely transferable"), o CONTEXT.md e fluxos.md:53. O contrato nunca torna o token soulbound. — LOW
- **[GAP]** `app/app/organizer/page.tsx` × `app/app/api/organizer/events/[id]/route.ts:5` — _[órfão]_ `PATCH /api/organizer/events/:id` (editar evento em DRAFT/PENDING) não tem UI; a tabela de eventos é read-only. Doc: fluxos.md:151. — LOW
- **[GAP]** `smart_contracts/src/TicketSwap.sol:86` × `app/` — _[órfão]_ o contrato TicketSwap (proposeSwap/acceptSwap/...) está deployado e documentado como "Swap atômico" (fluxos.md:56-57), mas não há rota /api nem UI de troca de ingressos. Capacidade on-chain inalcançável. — LOW
