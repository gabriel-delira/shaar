# Smart Contracts — Plataforma de Assinaturas e Ingressos NFT

Dois sistemas de pagamento on-chain construídos em Solidity com OpenZeppelin.

## Stack

| | |
|---|---|
| Linguagem | Solidity ^0.8.20 |
| Framework | [Foundry](https://book.getfoundry.sh/) (Forge + Anvil) |
| Biblioteca base | OpenZeppelin Contracts |
| Redes alvo | Ethereum Mainnet, Polygon, Base (qualquer EVM L2) |
| Tokens suportados | ETH nativo + qualquer ERC-20 |

## Contratos

### Caso 1 — Plataforma de Assinaturas para Analistas (`src/SubscriptionSplit.sol`)

Investidores pagam assinaturas periódicas a analistas financeiros. O pagamento é distribuído automaticamente no ato: uma fatia vai ao analista, outra à plataforma.

```
Investidor → subscribe(analystAddress, period)
               ├─ X% → Analista (imediato)
               └─ Y% → Plataforma (imediato)
```

- Suporte a ETH e qualquer ERC-20
- Split configurável em basis points pelo owner
- `subscriptionExpiry[investor][analyst]` consultável on-chain
- Função `isActive(investor, analyst)` para verificação rápida
- `ReentrancyGuard` + `Ownable` (OpenZeppelin)

---

### Caso 2 — Plataforma de Ingressos NFT

Quatro contratos com responsabilidades separadas:

| Contrato | Responsabilidade | Paga? |
|---|---|---|
| `TicketNFT.sol` | Emite e gerencia os NFTs (ERC-721 + ERC-2981) | Não |
| `TicketSale.sol` | Venda primária — split Organizador + Plataforma | Sim |
| `TicketResale.sol` | Mercado secundário — split Vendedor + Organizador + Plataforma | Sim |
| `TicketSwap.sol` | Troca atômica de ingressos entre dois usuários | Sim (taxa) |

**Fluxo simplificado:**
```
Venda primária:   Comprador → TicketSale → mint(NFT) + split(Org / Plataforma)
Revenda:          Comprador → TicketResale → transfer(NFT) + split(Vendedor / Org / Plataforma)
Swap:             Usuário A + B → TicketSwap → transfer atômico (ou reverte tudo) + taxa
```

## Estrutura

```
smart_contracts/
  src/
    SubscriptionSplit.sol
    TicketNFT.sol
    TicketSale.sol
    TicketResale.sol
    TicketSwap.sol
    RoyaltySplitter.sol
  test/
    SubscriptionSplit.t.sol
    TicketNFT.t.sol
    TicketSale.t.sol
    TicketResale.t.sol
    TicketSwap.t.sol
  script/          ← scripts de deploy (a implementar)
  lib/
    forge-std/
    openzeppelin-contracts/
  foundry.toml
```

## Como rodar

### Pré-requisito — instalar Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup
```

### Build

```bash
forge build
```

### Testes

```bash
forge test

# Com verbosidade (ver logs e traces)
forge test -vvv

# Apenas um contrato
forge test --match-contract TicketSaleTest
```

### Testnet local

```bash
anvil
# Abre um node local em http://127.0.0.1:8545 com 10 wallets pré-fundadas
```

### Deploy

```bash
forge script script/Deploy.s.sol \
  --rpc-url <RPC_URL> \
  --private-key <PRIVATE_KEY> \
  --broadcast
```

> **Atenção:** auditoria de segurança externa é obrigatória antes de qualquer deploy em mainnet.

## Padrões OpenZeppelin usados

| Padrão | Onde |
|---|---|
| `ERC-721` + `ERC-721URIStorage` | `TicketNFT` |
| `ERC-2981` (royalties) | `TicketNFT` |
| `Ownable` | Todos |
| `AccessControl` | `TicketNFT` (controla quem pode fazer mint) |
| `ReentrancyGuard` | Contratos que recebem pagamento |
| `Pausable` | `TicketSale` (pausa de emergência por evento) |
| `SafeERC20` | Todos que lidam com tokens ERC-20 |
