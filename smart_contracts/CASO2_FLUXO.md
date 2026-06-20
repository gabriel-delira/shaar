# Caso 2 — Plataforma de Venda de Ingressos NFT

## Contratos envolvidos

```
TicketNFT.sol       → o ativo (o NFT em si)
RoyaltySplitter.sol → divide royalties externas entre organizer e plataforma
TicketSale.sol      → venda primária (lançamento)
TicketResale.sol    → mercado secundário (revenda)
TicketSwap.sol      → troca atômica entre holders
```

---

## Fluxo 1 — Criação de Evento

**Quem faz:** Owner da plataforma

```
Owner
  └─► TicketSale.createEvent(organizer, price, token, fees, maxTickets, royaltyBps, royaltyOrgShare%)
        │
        ├─ Valida parâmetros
        ├─ Faz deploy de um RoyaltySplitter exclusivo para esse evento
        │     └─ RoyaltySplitter guarda: organizer, platform, organizerShareBps
        └─ Salva o evento no mapping events[eventId]
              └─ royaltySplitter = endereço do splitter deployado
```

**Resultado:** Evento criado com ID incremental, splitter de royalties deployado e vinculado.

---

## Fluxo 2 — Venda Primária (Comprador → Plataforma)

**Quem faz:** Qualquer comprador

```
Comprador
  └─► TicketSale.buyTicket(eventId, tokenURI) + ETH ou aprovação ERC-20
        │
        ├─ Valida: evento ativo, não esgotado, valor correto
        ├─ Split imediato do pagamento:
        │     ├─ (100% - platformFee%) → Organizer
        │     └─ platformFee%          → Platform
        │
        └─► TicketNFT.mint(MintParams)
              ├─ Minta NFT direto para o comprador
              ├─ Grava metadados: eventId, ticketNumber, seat, facePrice, organizer...
              └─ Define royaltyReceiver = RoyaltySplitter do evento (não o organizer direto)
```

**Resultado:** Comprador recebe o NFT. Organizer e plataforma recebem pagamento. NFT carrega o splitter como destinatário de royalties.

---

## Fluxo 3 — Royalties em Marketplace Externo (OpenSea, Blur, etc.)

**Quem faz:** Marketplace externo automaticamente

```
Marketplace
  └─► TicketNFT.royaltyInfo(tokenId, salePrice)
        └─ Retorna: (endereço do RoyaltySplitter, valor da royalty)

Marketplace envia ETH da royalty → RoyaltySplitter.receive()
  └─ Split automático na mesma transação:
        ├─ organizerShareBps%          → Organizer
        └─ (100% - organizerShareBps)% → Platform
```

> Para royalties pagas em ERC-20 (ex: WETH), o token fica acumulado no splitter
> até alguém chamar `RoyaltySplitter.releaseERC20(token)` — função pública.

**Resultado:** Organizer e plataforma recebem suas partes automaticamente, sem intervenção manual.

---

## Fluxo 4 — Revenda (Mercado Secundário)

**Quem faz:** Holder do ingresso (vendedor) + Comprador

```
[1] Vendedor aprova TicketResale como operador do NFT
      └─► TicketNFT.approve(TicketResale, tokenId)

[2] Vendedor lista o ingresso
      └─► TicketResale.listTicket(tokenId, price, token, organizerRoyalty%, expiry)
            └─ Cria Listing com: seller, tokenId, price, organizerRoyaltyBps, expiresAt

[3] Comprador compra a listagem
      └─► TicketResale.buyListedTicket(listingId) + pagamento
            │
            ├─ Valida: listagem ativa, não expirada, seller ainda dono do NFT
            ├─ Split triplo do pagamento:
            │     ├─ sellerShare%         → Vendedor
            │     ├─ organizerRoyalty%    → Organizer do evento
            │     └─ platformFee%         → Platform
            │
            └─► TicketNFT.transferFrom(seller → buyer, tokenId)
```

> O vendedor pode cancelar a listagem a qualquer momento antes da venda.

**Resultado:** NFT transferido. Três partes recebem simultaneamente na mesma transação.

---

## Fluxo 5 — Troca Atômica entre Holders

**Quem faz:** Usuário A (propõe) + Usuário B (aceita)

```
[1] Usuário A aprova TicketSwap como operador do seu NFT
      └─► TicketNFT.approve(TicketSwap, tokenIdA)

[2] Usuário A calcula a taxa antes de propor (opcional)
      └─► TicketSwap.quoteFee(tokenIdA, tokenIdB)
            └─ Taxa = fixedFeeETH + (média dos facePrices × percentFeeBps%)

[3] Usuário A propõe o swap pagando a taxa
      └─► TicketSwap.proposeSwap(tokenIdA, tokenIdB) + taxa em ETH
            └─ Cria Proposal com: proposer, tokenIdA, tokenIdB, feeAmount, expiresAt (agora + TTL)

[4] Usuário B aprova TicketSwap como operador do seu NFT
      └─► TicketNFT.approve(TicketSwap, tokenIdB)

[5] Usuário B aceita o swap
      └─► TicketSwap.acceptSwap(proposalId)
            │
            ├─ Valida: proposta ativa, não expirada, B dono do tokenB
            ├─ Swap atômico (mesma transação):
            │     ├─► TicketNFT.transferFrom(A → B, tokenIdA)
            │     └─► TicketNFT.transferFrom(B → A, tokenIdB)
            │
            └─ Distribui a taxa:
                  ├─ platformShareBps%              → Platform
                  ├─ metade do restante             → Organizer do Evento A
                  └─ outra metade do restante       → Organizer do Evento B
```

> Se B não aceitar antes do TTL expirar, A pode cancelar e receber a taxa de volta.
> Se qualquer uma das transferências falhar, a transação inteira reverte — impossível perder um NFT sem receber o outro.

**Resultado:** NFTs trocados atomicamente. Taxa distribuída entre platform e os dois organizadores.

---

## Diagrama de interação entre contratos

```
                        ┌─────────────────┐
                        │   TicketSale    │──deploy──► RoyaltySplitter
                        │  (venda primária)│
                        └────────┬────────┘
                                 │ mint()
                                 ▼
                        ┌─────────────────┐
          approve ◄─────│    TicketNFT    │─────► royaltyInfo()
          transferFrom   │   (ERC-721 +   │         │
                        │  ERC-2981 +    │         ▼
                        │ AccessControl) │   RoyaltySplitter
                        └────────┬────────┘   (receive / releaseERC20)
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             TicketResale   TicketSwap   (marketplace externo)
            (revenda p2p)  (troca atômica)
```

---

## Resumo dos splits por fluxo

| Fluxo | Quem paga | Organizer | Vendedor | Platform | Org. Evento A/B |
|---|---|---|---|---|---|
| Venda primária | Comprador | ✓ | — | ✓ | — |
| Royalty externa | Marketplace | ✓ (via Splitter) | — | ✓ (via Splitter) | — |
| Revenda | Comprador | ✓ | ✓ | ✓ | — |
| Swap (taxa) | Usuário A | — | — | ✓ | ✓ / ✓ |
