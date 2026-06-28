# Testes — Shaar

Cobre as duas camadas testáveis do Shaar: os **smart contracts** (Foundry) e o
**app** Next.js/Prisma (Vitest, infra mockada). O diretório `platform/` é só
mockup HTML estático — sem testes.

## Como rodar

```bash
# Smart contracts (Foundry)
cd smart_contracts && forge test

# App (Next.js) — Vitest, sem banco/Privy/chain (tudo mockado)
cd app && npm test
```

---

## 1. App (`app/`) — Vitest

Stack: **Vitest** (`app/vitest.config.ts`, alias `@/*` → raiz do app),
`app/tests/setup.ts` define env determinístico (`QR_SECRET`, `PSP_WEBHOOK_SECRET`,
`FX_MID_RATE/SPREAD`). Prisma (`@/lib/db`), auth/Privy (`@/lib/auth`) e o PSP são
mockados — **nada conecta em banco, chain ou Privy**.

**22 testes / 3 arquivos** (`npm test` → `3 passed (3) / 22 passed (22)`).

### Mapa teste → regra de domínio

| Arquivo | Regra / invariante (CONTEXT.md) |
|---|---|
| `tests/unit/fx.test.ts` | **Câmbio BRL/USDC travado no checkout.** Usuário paga em BRL, on-chain é USDC; `getBrlPerUsdc` aplica spread sobre o mid; `usdcToBrl` arredonda a 2 casas, `brlToUsdc` a 6; `lockRate` devolve a taxa ask; round-trip dentro da tolerância. |
| `tests/unit/psp.test.ts` | **Webhook do PSP é o motor do state machine + verificação fail-closed.** `verifyWebhook` valida HMAC-SHA256 sobre o **rawBody** contra `x-psp-signature` em tempo constante; rejeita header ausente, assinatura errada, corpo adulterado e **segredo não configurado** (fail-closed). Também: `createPixCharge` gera cobrança com expiração futura. |
| `tests/e2e/checkin.e2e.test.ts` | **Fluxo de check-in com QR rotativo** (handler real `POST /api/checkin`). QR `shaar:v1:{tokenId}:{window}:{userId}:{sig}` validado por HMAC + janela de 30s com **tolerância ±1**; **vínculo ao dono atual** do ticket (QR de dono anterior é rejeitado); só **STAFF/ADMIN** fazem check-in; máquina de estados `VALID → CHECKED_IN` (409 se já checkado / não-VALID, 404 sem ticket, 422 QR inválido/expirado). |

### Lacunas conhecidas (app)
- Webhook `POST /api/webhooks/psp`: idempotência (`processPspPayment` só processa `PENDING`) — alvo natural seguindo o padrão do `checkin.e2e`.
- Checkout primário/revenda (`lib/onchain.ts`): exige mock de viem/transações.

---

## 2. Smart contracts (`smart_contracts/`) — Foundry

Já havia suíte para `TicketNFT`, `TicketSale`, `TicketResale`, `TicketSwap`.
Foi adicionada a suíte **dedicada** que faltava:

| Arquivo | Regra / invariante |
|---|---|
| `test/RoyaltySplitter.t.sol` | **Split de royalties ERC-2981 com pull-payment.** Construtor valida endereços e share ≤ 100%; `receive()` divide ETH por BPS (70/30) e **acumula** em `pendingWithdrawals`; `withdraw` transfere e zera; **um destinatário que reverte não bloqueia o outro** (isolamento do pull-payment); espelho em ERC-20 (`releaseERC20`/`withdrawERC20`), incluindo `releaseERC20` chamável por qualquer um. **14 testes, todos passando.** |

### ⚠️ Achado: suítes existentes quebradas (pré-existente, NÃO causado por estes testes)

Ao rodar `forge test` completo: **75 passam, 8 falham**. As 8 falhas estão em
`TicketSale.t.sol`, `TicketResale.t.sol` e `TicketSwap.t.sol` (arquivos que **não
foram tocados**). O padrão é sempre o mesmo — o teste espera um **push** direto
(ex.: saldo do organizador +0.7 ETH) mas recebe 0:

```
[FAIL] test_RoyaltySplitter_SplitsETH()  -> 0 != 700000000000000000
[FAIL] test_BuyTicketETH()               -> 0 != 900000000000000000
[FAIL] test_BuyListedTicket_Split()      -> 0 != 70000000000000000
... (8 no total)
```

**Causa provável:** o `RoyaltySplitter` (e o caminho de split de `TicketSale`/
`TicketResale`) foi migrado para **pull-payment** (credita `pendingWithdrawals`
em vez de transferir na hora), mas essas suítes antigas continuam afirmando o
comportamento push antigo. Precisam ser atualizadas para sacar via `withdraw()`
antes de checar saldos. **Fora do escopo desta tarefa** (são testes pré-existentes),
mas é uma dívida real a corrigir — avise se quiser que eu ajuste.
