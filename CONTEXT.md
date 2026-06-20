# Context: Shaar

## Domain Vocabulary
| Term | Definition |
|------|------------|
| Ingresso / Ticket | NFT ERC-721 (`TicketNFT`) que representa o direito de acesso a um evento. Carrega metadata on-chain (evento, número, assento, organizador, face price). |
| Event (on-chain) | Estrutura em `TicketSale` criada por `createEvent`; tem `onchainEventId` numérico, distinto do `id` (cuid) do `Event` no Postgres. |
| Organizer | Entidade B2B que cria eventos. Passa por aprovação (`PENDING`→`APPROVED`) e tem uma `payoutWallet` que recebe a receita. |
| Owner | Conta admin da plataforma on-chain (cria eventos, freeze, setBaseURI). No `signer`, é `ownerAccount`. |
| Treasury | Conta que paga o mint no fluxo fiat (`buyTicketFor`) e age como `settler` na revenda. No `signer`, é `treasuryAccount`. |
| Settler | Endereço (a treasury) autorizado a `lockListing`/`settleListedTicket`/`unlockListing` no `TicketResale`. |
| Venda primária | Primeira venda de um ingresso, mintado via `TicketSale`. Split organizador + plataforma. |
| Revenda / Resale | Mercado secundário via `TicketResale`. NFT fica em escrow no contrato. Split vendedor + royalty + plataforma. |
| RoyaltySplitter | Contrato deployado por evento; recebe royalties ERC-2981 e divide organizador/plataforma. |
| PSP | Payment Service Provider (gateway PIX/cartão). Abstraído em `lib/psp` com providers `mock`/`pagarme`/`stripe`. |
| Purchase | Registro no Postgres do ciclo de pagamento. State machine: `PENDING`→`PAID`→`MINTING`→`COMPLETED` (ou `REFUNDING`/`REFUNDED`/`FAILED`). |
| Freeze | Ato de fixar a URI de metadata de um token a um CID IPFS imutável após o evento. O ingresso vira colecionável; continua transferível. |
| Indexer | Worker de polling (`app/worker/indexer.ts`) que sincroniza o Postgres com eventos da chain e reconcilia compras travadas. |
| BPS | Basis points (1 bps = 0,01%). Unidade de todos os fees e royalties. `BPS = 10_000`. |
| Server Wallet | Carteira gerenciada server-side pela Privy, usada para assinar transações on-chain em testnet/mainnet (`SIGNER_MODE=privy`). |

## Key Invariants
- Pagamento do usuário é em **BRL (fiat via PSP)**; o on-chain opera em **USDC** (6 decimais) ou ETH. O câmbio é travado (`lockRate`) no checkout e gravado em `Purchase.fxRate`.
- O usuário **nunca assina o mint**: a treasury paga (`buyTicketFor`/`settleListedTicket`) e o NFT é mintado/transferido para a carteira embutida (Privy) do comprador.
- O **webhook PSP** é o único motor que avança a `Purchase` para mint/settle. Por isso a assinatura HMAC sobre o corpo cru é obrigatória — uma chamada não autenticada mintaria/transferiria ingressos de graça.
- `processPspPayment` é **idempotente**: status `COMPLETED`/`REFUNDED` retorna cedo; só processa `PENDING`.
- A reserva de listing no checkout de revenda é um **mutex real** via `updateMany(status: ACTIVE → LOCKED)` — só um checkout concorrente vence.
- `lockListing(buyer)` fixa o destinatário do NFT: `settleListedTicket` só entrega ao `lockedBuyer`, blindando contra chave de settler comprometida.
- A **chain é a fonte da verdade**; o Postgres é cache. O `ticketNumber` autoritativo vem de `getOnchainTicketNumber` (não de `count()+1`), evitando corrida com o indexador.
- Capacidade do evento é checada no app (mintados + compras em voo) e reforçada on-chain (`maxTickets`, `0` = ilimitado). O grace period de venda é `eventTimestamp + 2h`.
- Em não-local, o deployer **renuncia** ao `DEFAULT_ADMIN_ROLE` e transfere ownership para a `platformWallet` (Server Wallet).
- Royalty de revenda é enforçado on-chain via ERC-2981 — o vendedor não consegue manipular.
- O QR de check-in é **rotativo** (janela HMAC de 30s) e amarrado ao dono atual do ticket; um ex-dono não consegue gerar QR válido.

## What this project is NOT
- **Não** é a plataforma de assinaturas (`SubscriptionSplit.sol`) descrita no `smart_contracts/CLAUDE.md`. Esse contrato não existe no `src/`; o que está implementado é apenas a plataforma de ingressos NFT (Caso 2).
- **Não** usa KMS/Turnkey para custódia. A assinatura on-chain consolida tudo em **Privy Server Wallets** (modo `privy`) ou chave privada local (modo `env`, só dev).
- **Não** cobra o usuário em cripto no fluxo principal — o pagamento é fiat (PIX/cartão). O fluxo direto em USDC ainda é stub (`501`).
- **Não** depende de cronjob on-chain. Recorrência/expiração e reconciliação são feitas pelo indexador/jobs off-chain.
- **Não** é um marketplace genérico de NFT: ingressos só circulam dentro dos contratos da plataforma (`TicketResale`/`TicketSwap`), com escrow e splits obrigatórios.
- O **indexador não é a via primária** de criação de tickets/listings — é safety-net; o webhook PSP é o caminho principal.
