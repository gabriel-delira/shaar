# Descrição dos Contratos — Shaar

> Referência de funções, quem pode chamar cada uma, e o que acontece on-chain.
> Stack: Solidity ^0.8.20 · OpenZeppelin · Foundry · Base (EVM L2)

---

## Mapa de responsabilidades

| Contrato | Responsabilidade | Lida com pagamento? |
|---|---|---|
| `TicketNFTLocked` | Emite e gerencia os NFTs de ingresso; transfers restritos à plataforma | Não |
| `TicketSale` | Venda primária — cria eventos e minta ingressos | Sim |
| `TicketResale` | Mercado secundário — escrow + revenda + lock de checkout | Sim |
| `RoyaltySplitter` | Recebe royalties de marketplaces externos e distribui | Sim |

---

## TicketNFTLocked

> ERC-721 + ERC-2981 + AccessControl. Não processa pagamento; só emite e gerencia NFTs.
> Variante com transfers restritos: apenas contratos autorizados via `grantTransferor` podem mover NFTs (garante que royalties e taxas sejam sempre cobrados). O contrato original sem restrição está em `TicketNFT.sol`.

### Roles

| Role / Permissão | Quem recebe | O que permite |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Owner (plataforma) | Conceder/revogar MINTER, OPERATOR e transferors; setar `baseURI` |
| `MINTER_ROLE` | `TicketSale` (concedido no deploy) | Chamar `mint()` |
| `OPERATOR_ROLE` | Owner (concedido a si mesmo no deploy) | Chamar `freeze()` |
| `authorizedTransferor` | `TicketSale`, `TicketResale`, `TicketSwap` (concedido no deploy) | Executar `transferFrom`/`safeTransferFrom` — transfers diretos entre carteiras revertam |

### Funções

#### `mint(MintParams p)` — `onlyRole(MINTER_ROLE)`
Minta um novo token ERC-721 para `p.to`. Seta os metadados on-chain (`ticketData`) e configura royalty ERC-2981 para o token.
- **Quem chama:** `TicketSale` (chamada interna de `buyTicket`/`buyTicketFor`)
- **Emite:** `TicketMinted(tokenId, eventId, buyer)`

#### `freeze(tokenId, finalURI)` — `onlyRole(OPERATOR_ROLE)`
Fixa a URI de metadados do token a um CID IPFS imutável após o evento. O token continua transferível via contratos da plataforma (pode ser revendido como colecionável), mas os metadados ficam permanentemente bloqueados.
- **Quem chama:** Carteira operator da plataforma (job pós-evento)
- **Restrições:** Reverte se já congelado (`AlreadyFrozen`).
- **Emite:** `Frozen(tokenId, finalURI)`

#### `tokenURI(tokenId)` — view, público
Retorna a URI de metadados do token. Pré-freeze: `baseURI + tokenId` (servidor dinâmico). Pós-freeze: IPFS CID imutável.

#### `setBaseURI(baseURI_)` — `onlyRole(DEFAULT_ADMIN_ROLE)`
Define o prefixo de URI para tokens ainda não congelados. Aponta para a API Next.js (`/api/metadata/:tokenId`).
- **Quem chama:** Carteira admin da plataforma (no deploy e em atualizações de API)

#### `grantMinter(account)` / `revokeMinter(account)` — `onlyRole(DEFAULT_ADMIN_ROLE)`
Concede ou revoga `MINTER_ROLE`. Necessário após deploy de `TicketSale`.

#### `grantOperator(account)` / `revokeOperator(account)` — `onlyRole(DEFAULT_ADMIN_ROLE)`
Concede ou revoga `OPERATOR_ROLE`. Necessário para habilitar o job de freeze.

#### `grantTransferor(account)` / `revokeTransferor(account)` — `onlyRole(DEFAULT_ADMIN_ROLE)`
Autoriza ou desautoriza um endereço a executar `transferFrom`/`safeTransferFrom`. Concedido no deploy para `TicketSale`, `TicketResale` e `TicketSwap`. Qualquer outro chamador recebe `UnauthorizedTransfer`.
- **Emite:** `TransferorGranted(account)` / `TransferorRevoked(account)`

#### `getTicketData(tokenId)` — view, público
Retorna a struct `TicketMetadata` (eventId, nome do evento, número do ingresso, assento, etc.).

---

## TicketSale

> Venda primária. Ownable + Pausable + ReentrancyGuard.

### Carteiras relevantes

| Papel | Permissão |
|---|---|
| Owner (plataforma) | Criar eventos, pausar, alterar fees e capacidade |
| Tesouraria (plataforma) | Executar `buyTicketFor` no fluxo fiat |
| Comprador | Executar `buyTicket` no fluxo cripto-direto |

### Funções

#### `createEvent(organizer, ticketPrice, paymentToken, platformFeeBps, maxTickets, eventName, eventTimestamp, defaultSeat, royaltyBps, royaltyOrgShareBps)` — `onlyOwner`
Registra um novo evento e faz deploy de um `RoyaltySplitter` dedicado para ele. O splitter é configurado com a divisão `royaltyOrgShareBps / (100% - royaltyOrgShareBps)` entre organizador e plataforma.
- **Quem chama:** Admin da plataforma via `POST /api/admin/events/:id/approve`
- **Emite:** `EventCreated(eventId, organizer, price, maxTickets, royaltySplitter)`

#### `buyTicket(eventId)` — payable, `whenNotPaused`
Fluxo cripto-direto: `msg.sender` paga e recebe o NFT. Distribui o pagamento (organizador + plataforma) e minta o token.
- **Quem chama:** Comprador com USDC/ETH próprio

#### `buyTicketFor(eventId, recipient)` — payable, `whenNotPaused`
Fluxo fiat-first: tesouraria paga, NFT vai para `recipient`. Mesmo split do `buyTicket`.
- **Quem chama:** Tesouraria da plataforma, após webhook PSP confirmar pagamento
- **Emite:** `TicketSold(eventId, recipient, tokenId, amount)`

#### `toggleEventPause(eventId)` — `onlyOwner`
Liga/desliga vendas de um evento específico. Independente do pause global do contrato.
- **Quem chama:** Admin da plataforma via `POST /api/admin/events/:id/pause`
- **Emite:** `EventPauseToggled(eventId, paused)`

#### `updatePlatformFee(eventId, newFeeBps)` — `onlyOwner`
Altera a taxa da plataforma para um evento. Só permitido se nenhum ingresso foi vendido ainda.

#### `updateMaxTickets(eventId, newMax)` — `onlyOwner`
Aumenta a capacidade máxima ou define ilimitada (`0`). Só permite aumentar, nunca diminuir.

#### `setPlatformWallet(wallet)` — `onlyOwner`
Atualiza a carteira que recebe as taxas primárias da plataforma.

---

## TicketResale

> Mercado secundário com escrow de NFT e lock de checkout. Ownable + ReentrancyGuard.

### Modelo de escrow

Ao chamar `listTicket`, o NFT é transferido para a custódia do contrato. O seller não pode transferi-lo enquanto o ingresso está listado. O NFT só volta ao seller via `cancelListing`, ou vai ao comprador via `buyListedTicket*` / `settleListedTicket`.

### Carteiras relevantes

| Papel | Permissão |
|---|---|
| Owner (plataforma) | Configurar fees, wallet e settler; cancelar listagens |
| Settler (tesouraria/backend) | Fazer lock/unlock e executar `settleListedTicket` |
| Seller (embedded wallet) | Listar e cancelar ingressos |
| Comprador | Comprar via cripto-direto |

### Funções

#### `listTicket(tokenId, price, paymentToken, expiresAt)` — público (seller)
Transfere o NFT para escrow no contrato e registra a listagem. O seller deve ter aprovado o contrato antes (`approve` ou `setApprovalForAll`). `expiresAt = 0` significa sem expiração.
- **Quem chama:** Seller (embedded wallet, gas via paymaster)
- **Emite:** `TicketListed(listingId, seller, tokenId, price)`

#### `cancelListing(listingId)` — público (seller ou owner)
Cancela a listagem e devolve o NFT ao seller. Reverte se a listagem estiver **locked** (checkout em progresso).
- **Quem chama:** Seller ou owner da plataforma
- **Restrição:** Reverte com `"Listing locked"` se um checkout PSP está em andamento
- **Emite:** `ListingCancelled(listingId)`

#### `lockListing(listingId)` — `onlySettler`
Bloqueia cancelamento da listagem. Chamado pelo backend **imediatamente antes** de criar a cobrança no PSP, garantindo que o seller não consiga cancelar enquanto o comprador está pagando.
- **Quem chama:** Backend (tesouraria/settler), ao iniciar o checkout
- **Emite:** `ListingLocked(listingId)`

#### `unlockListing(listingId)` — `onlySettler`
Desbloqueia a listagem. Chamado pelo backend se o PSP falhar ou o pagamento expirar.
- **Quem chama:** Backend (tesouraria/settler), em caso de falha/timeout do PSP
- **Emite:** `ListingUnlocked(listingId)`

#### `settleListedTicket(listingId, recipient)` — `onlySettler`
**Fluxo fiat-first:** o pagamento já foi distribuído em BRL via PSP split (seller, organizador e plataforma receberam direto). Esta função apenas transfere o NFT em escrow para o `recipient`.
- **Quem chama:** Backend (tesouraria/settler), após webhook PSP confirmar pagamento
- **Nenhum token/ETH se move** — só o NFT
- **Emite:** `TicketSettled(listingId, recipient, tokenId)`

#### `buyListedTicket(listingId)` — payable, público
**Fluxo cripto-direto:** `msg.sender` paga on-chain (ETH ou ERC-20) e recebe o NFT. Split triplo automático: seller recebe sua parte, royalty vai para o `RoyaltySplitter` do evento (ERC-2981), plataforma recebe sua taxa.
- **Quem chama:** Comprador com USDC/ETH próprio
- **Emite:** `TicketResold(listingId, buyer, tokenId, sellerAmount, royaltyAmount, royaltyReceiver, platformAmount)`

#### `buyListedTicketFor(listingId, recipient)` — payable, público
Mesmo fluxo do `buyListedTicket`, mas o NFT vai para `recipient` em vez de `msg.sender`. Permite que a tesouraria execute a compra on-chain com USDC enquanto o NFT vai direto ao comprador.
- **Quem chama:** Tesouraria (fluxo USDC pago pelo comprador via tesouraria)

#### `setPlatformFee(bps)` — `onlyOwner`
Altera a taxa de revenda da plataforma.

#### `setPlatformWallet(wallet)` — `onlyOwner`
Atualiza a carteira que recebe as taxas de revenda.

#### `setSettler(settler)` — `onlyOwner`
Define a carteira autorizada a chamar `lockListing`, `unlockListing` e `settleListedTicket`. Normalmente a carteira tesouraria do backend.

---

## RoyaltySplitter

> Contrato imutável, sem owner. Um deploy por evento, feito automaticamente pelo `TicketSale.createEvent`. Endereço setado como `royaltyReceiver` no ERC-2981 do token.

### Como funciona

Marketplaces externos (OpenSea, Blur etc.) respeitam ERC-2981 e enviam royalties para este contrato. Ao receber, o contrato distribui automaticamente entre organizador e plataforma conforme `organizerShareBps` definido no deploy.

### Funções

#### `receive()` — payable, automático
Chamado automaticamente ao receber ETH. Faz o split imediatamente: `organizerShareBps%` para o organizador, o restante para a plataforma.
- **Quem chama:** Marketplace externo (implicitamente)
- **Emite:** `RoyaltyReceived(address(0), total, toOrganizer, toPlatform)`

#### `releaseERC20(token)` — público
Distribui o saldo de um token ERC-20 acumulado no contrato (ex.: WETH de royalties). Pode ser chamado por qualquer um — não há risco pois a distribuição é fixa e imutável.
- **Quem chama:** Qualquer endereço (backend, organizador, qualquer pessoa)
- **Emite:** `RoyaltyReceived(token, balance, toOrganizer, toPlatform)`

---

## Fluxos resumidos

### Venda primária (fiat)
```
Admin → createEvent()                          [TicketSale, onlyOwner]
Comprador paga PIX → PSP webhook
Backend → buyTicketFor(eventId, comprador)     [TicketSale, tesouraria]
  └─ NFT mintado direto pro comprador
  └─ USDC split: organizador + plataforma
```

### Revenda (fiat — PSP split)
```
Seller → approve() + listTicket()              [TicketNFT + TicketResale, seller]
  └─ NFT vai para escrow no TicketResale
Backend → lockListing(listingId)               [TicketResale, settler]
Comprador paga PIX → PSP split automático
  └─ Seller recebe BRL direto no PIX
  └─ Organizador recebe royalty BRL no PIX
  └─ Plataforma recebe fee BRL
Backend → settleListedTicket(listingId, comp.) [TicketResale, settler]
  └─ NFT transferido do escrow pro comprador
```

### Revenda (cripto-direto)
```
Seller → approve() + listTicket()              [TicketNFT + TicketResale, seller]
Comprador → buyListedTicket()                  [TicketResale, comprador]
  └─ USDC split on-chain: seller + RoyaltySplitter + plataforma
  └─ NFT transferido do escrow pro comprador
```

### Freeze pós-evento
```
Job backend → snapshot metadados → pin Pinata (IPFS CID)
Operator → freeze(tokenId, "ipfs://CID")       [TicketNFT, onlyRole(OPERATOR_ROLE)]
  └─ tokenURI passa a retornar o CID imutável (token permanece transferível)
```
