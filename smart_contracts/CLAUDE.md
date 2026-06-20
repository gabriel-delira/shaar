# Arquitetura de Smart Contracts

## Diretriz Geral — OpenZeppelin

Sempre que possível, utilizar contratos e bibliotecas da **OpenZeppelin** como base de implementação. A OpenZeppelin é o padrão da indústria para smart contracts auditados e seguros, reduzindo a superfície de ataque e o tempo de desenvolvimento. Isso inclui, mas não se limita a:

- `Ownable` — controle de acesso por owner
- `ReentrancyGuard` — proteção contra ataques de reentrância
- `ERC-721` + `ERC-721URIStorage` — padrão NFT
- `ERC-2981` — padrão de royalties on-chain
- `IERC20` / `SafeERC20` — interação segura com tokens ERC-20
- `AccessControl` — controle de papéis (roles) mais granular que Ownable
- `Pausable` — capacidade de pausar o contrato em emergências

---

## Stack Tecnológica

- **Linguagem:** Solidity ^0.8.20
- **Biblioteca base:** OpenZeppelin Contracts
- **Redes alvo:** Ethereum Mainnet, Polygon, Base ou qualquer EVM-compatible L2
- **Tokens suportados:** ETH nativo + qualquer ERC-20 (configurável por contrato)
- **Testes:** Hardhat + Ethers.js ou Foundry
- **Auditoria externa obrigatória antes de qualquer deploy em mainnet**

---

## Caso 1 — Plataforma de Assinaturas para Analistas

### Descrição

Plataforma onde investidores pagam assinaturas periódicas (mensal ou anual) a analistas financeiros cadastrados. A plataforma atua como intermediária e retém uma taxa percentual configurável pelo owner, repassando o restante diretamente ao analista no ato do pagamento.

### Contratos

| Contrato | Função | Recebe Pagamento? | Chama Outro Contrato? |
|---|---|---|---|
| `SubscriptionSplit.sol` | Gerenciar assinaturas e distribuir pagamentos | Sim (ETH + ERC-20) | Não |

### Fluxo de Pagamento

1. Investidor chama `subscribe(analystAddress, period)` enviando ETH ou aprovando tokens ERC-20.
2. O contrato valida o valor mínimo exigido para o período escolhido.
3. Split automático: `X%` transferido imediatamente ao analista, `Y%` transferido à plataforma.
4. O contrato registra `subscriptionExpiry[investor][analyst]` com o timestamp de vencimento.
5. Evento `PaymentReceived` é emitido on-chain com todos os detalhes da transação.
6. Backend da plataforma escuta o evento e libera/mantém o acesso do investidor.
7. Ao vencer sem renovação, o evento `SubscriptionExpired` é emitido para notificação.

### Observação sobre Recorrência

Blockchains EVM não executam código de forma autônoma — não existe "cronjob" nativo on-chain. A recorrência é gerenciada da seguinte forma:

- O investidor renova manualmente antes do vencimento (padrão mais comum).
- O backend da plataforma monitora eventos e datas de expiração, notificando o usuário por e-mail/push e bloqueando o acesso em caso de não renovação.
- Opcionalmente, soluções como **Chainlink Automation** podem automatizar a verificação de vencimentos, porém com custo de gas adicional.

### Funcionalidades do `SubscriptionSplit.sol`

- Suporte a pagamento em ETH nativo e qualquer token ERC-20 (USDC, USDT etc.)
- Split configurável pelo owner: percentual do analista (`X%`) e da plataforma (`Y%`), onde `X + Y = 100%`
- Preço mínimo configurável por analista (evita assinaturas de valor zero)
- Registro de validade: `subscriptionExpiry[investor][analyst]` consultável por qualquer sistema externo
- Função `isActive(investor, analyst)` retorna booleano para verificação rápida de status
- Eventos: `SubscriptionRenewed`, `SubscriptionExpired`, `SplitUpdated`, `PriceUpdated`
- Proteção contra reentrância via `ReentrancyGuard` (OpenZeppelin)
- Controle de acesso via `Ownable` (OpenZeppelin)

---

## Caso 2 — Plataforma de Venda de Ingressos NFT

### Descrição

Plataforma B2B2C onde organizadores de eventos cadastrados emitem ingressos digitais como NFTs (ERC-721). Cada ingresso é único, representa o direito de acesso a um evento específico, e pode ser comprado, revendido ou trocado por outros ingressos dentro da própria plataforma — com split de receita automático em cada etapa.

### Contratos

| Contrato | Função | Recebe Pagamento? | Chama Outro Contrato? |
|---|---|---|---|
| `TicketNFT.sol` | Emitir e gerenciar NFTs de ingresso | Não | Não |
| `TicketSale.sol` | Venda primária de ingressos | Sim (ETH + ERC-20) | Sim → `TicketNFT.mint()` |
| `TicketResale.sol` | Mercado secundário peer-to-peer | Sim (ETH + ERC-20) | Sim → `TicketNFT.transferFrom()` |
| `TicketSwap.sol` | Troca atômica de ingressos + taxa | Sim (ETH + ERC-20) | Sim → `TicketNFT.transferFrom()` (2x) |

---

### Contrato 1/4 — `TicketNFT.sol`

**Responsabilidade:** Contrato base que define o ativo (o NFT). Não processa pagamentos. Todos os outros contratos do Caso 2 interagem com ele.

**Padrões OpenZeppelin implementados:**
- `ERC-721` — padrão NFT
- `ERC-721URIStorage` — armazena metadados on-chain por token
- `ERC-2981` — padrão de royalties; marketplaces externos como OpenSea respeitam automaticamente os royalties do organizador
- `Ownable` + `AccessControl` — apenas contratos autorizados (`TicketSale`, `TicketResale`) podem chamar `mint()`

**Metadados do NFT por ingresso:**
- ID e nome do evento
- Número do ingresso (`#N de M total`)
- Assento ou área (caso aplicável)
- Data e hora do evento
- Endereço do organizador
- URI da imagem/arte do ingresso

---

### Contrato 2/4 — `TicketSale.sol`

**Responsabilidade:** Gerencia a venda primária (lançamento) dos ingressos. O owner da plataforma cria os eventos e define as regras. Quando um comprador paga, o contrato distribui o valor e aciona o mint do NFT.

**Fluxo de Venda Primária:**

1. Owner chama `createEvent(orgAddress, price, platformFee%, maxTickets, paymentToken)`.
2. Comprador chama `buyTicket(eventId)` enviando o valor exato em ETH ou aprovando ERC-20.
3. Split: `(100% - platformFee%)` → organizador / `platformFee%` → plataforma.
4. Contrato chama `TicketNFT.mint(buyer, eventId, metadata)` — NFT enviado diretamente ao comprador.
5. Evento `TicketSold` emitido com `eventId`, `buyer`, `tokenId` e valores distribuídos.

**Funcionalidades:**
- Controle de capacidade: rejeita compras após esgotar o `maxTickets`
- Suporte a múltiplos tokens de pagamento por evento
- Possibilidade de pausar vendas de um evento específico via `Pausable` (OpenZeppelin)
- Owner pode atualizar `platformFee%` antes do início das vendas

---

### Contrato 3/4 — `TicketResale.sol`

**Responsabilidade:** Mercado secundário — permite que holders de ingressos NFT listem seus ingressos para venda. A plataforma e o organizador do evento recebem royalties em cada revenda.

**Fluxo de Revenda:**

1. Vendedor aprova o contrato `TicketResale` como operador do seu NFT.
2. Vendedor chama `listTicket(tokenId, price, paymentToken)`.
3. Comprador chama `buyListedTicket(listingId)` pagando o valor listado.
4. Split triplo: `sellerShare%` → vendedor / `organizerRoyalty%` → organizador / `platformFee%` → plataforma.
5. Contrato chama `TicketNFT.transferFrom(seller, buyer, tokenId)`.
6. Evento `TicketResold` emitido com todos os detalhes.

**Regras de Split na Revenda:**
- `platformFee%` — definido globalmente pelo owner da plataforma
- `organizerRoyalty%` — configurável por evento; pode ser `0%` se não houver acordo com o organizador
- `sellerShare%` — o que sobra: `100% - platformFee% - organizerRoyalty%`

**Funcionalidades adicionais:**
- Vendedor pode cancelar listagem a qualquer momento antes da venda
- Proteção: apenas o owner do NFT pode listar
- Listagens com expiração opcional via timestamp
- Proteção contra reentrância via `ReentrancyGuard` (OpenZeppelin)

---

### Contrato 4/4 — `TicketSwap.sol`

**Responsabilidade:** Permite que dois usuários troquem seus ingressos entre si de forma atômica — ou os dois NFTs são transferidos simultaneamente, ou a transação inteira é revertida. Uma taxa é cobrada do iniciador do swap.

**Fluxo de Intercâmbio:**

1. Usuário A propõe o swap: `proposeSwap(myTokenId, targetTokenId, paymentToken)`.
2. Usuário B aceita a proposta: `acceptSwap(proposalId)` — ambos devem ter aprovado o contrato como operador.
3. Contrato calcula a taxa total: `taxaFixa (ETH)` + `percentual sobre o valor médio dos dois ingressos`.
4. Split da taxa: `gasBuffer%` → reserva de gas / `organizerEvent1%` → organizador evento 1 / `organizerEvent2%` → organizador evento 2 / `platformFee%` → plataforma.
5. Swap atômico: `TicketNFT.transferFrom(A → B, tokenA)` e `TicketNFT.transferFrom(B → A, tokenB)` na mesma transação.
6. Evento `TicketsSwapped` emitido com ambos os `tokenIds`, endereços e taxa distribuída.

**Atomicidade e Segurança:**
- Se qualquer transferência falhar, toda a transação é revertida — impossível perder um ingresso sem receber o outro
- Proposta de swap tem validade configurável (ex.: 24h ou 7 dias)
- Usuário A pode cancelar a proposta antes de Usuário B aceitar
- Taxa fixa configurável pelo owner para cobrir variações de gas
- Taxa percentual calculada sobre o preço de face dos ingressos registrado na venda primária

---

## Resumo Geral

| Contrato | Caso | Quem Paga | Quem Recebe o Split |
|---|---|---|---|
| `SubscriptionSplit.sol` | Caso 1 | Investidor | Analista + Plataforma |
| `TicketNFT.sol` | Caso 2 | — | — (mint/transfer apenas) |
| `TicketSale.sol` | Caso 2 | Comprador (venda primária) | Organizador + Plataforma |
| `TicketResale.sol` | Caso 2 | Comprador (revenda) | Vendedor + Organizador + Plataforma |
| `TicketSwap.sol` | Caso 2 | Iniciador do swap (taxa) | Org. Evento 1 + Org. Evento 2 + Plataforma |

## Próximos Passos

1. Revisão e aprovação deste documento de escopo.
2. Definição dos percentuais iniciais de split para cada contrato.
3. Implementação dos contratos em Solidity com testes unitários.
4. Deploy em testnet (Sepolia ou Mumbai) para validação.
5. Auditoria de segurança externa antes do lançamento em produção.