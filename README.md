# Shaar — Plataforma de Ingressos NFT

Stack: Next.js 16 · Prisma · PostgreSQL · viem · Privy · Solidity/Foundry · Base (EVM L2)

---

## Estrutura

```
shaar/
  smart_contracts/   Contratos Solidity + scripts Foundry
  app/               Next.js (App Router) + Prisma + API routes
```

---

## Dev local (Anvil)

Tudo roda localmente sem precisar de testnet, carteira real ou Privy.

### Pré-requisitos

- [Foundry](https://book.getfoundry.sh/) (`anvil`, `forge`)
- Node.js ≥ 20
- PostgreSQL rodando em `localhost:5432`

### 1. Chain local

```bash
cd smart_contracts
anvil
```

Deixa rodando. Abre em `http://127.0.0.1:8545` com 10 wallets pré-fundadas.

### 2. Deploy dos contratos

Novo terminal:

```bash
cd smart_contracts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

O script:
- Deploya MockUSDC e minta 1 M USDC para a tesouraria
- Deploya TicketNFT, TicketSale, TicketResale
- Concede roles (MINTER, OPERATOR)
- Pré-aprova o gasto de USDC da tesouraria
- Imprime os endereços e escreve `app/lib/contracts/addresses.local.json`

### 3. Configurar o `.env` da app

Copie os endereços impressos pelo deploy para `app/.env`:

```env
USDC_ADDRESS="<MockUSDC address>"
NEXT_PUBLIC_NFT_ADDRESS="<TicketNFT address>"
NEXT_PUBLIC_SALE_ADDRESS="<TicketSale address>"
NEXT_PUBLIC_RESALE_ADDRESS="<TicketResale address>"
```

As outras variáveis já têm defaults funcionais para dev local (`SIGNER_MODE=env`, chaves Anvil, `PSP_PROVIDER=mock`).

### 4. Banco de dados

```bash
cd app
npm install
npm run db:migrate
```

### 5. Rodar a app

```bash
npm run dev
```

Acesse `http://localhost:3000`.

---

## Fluxo de teste manual

### Venda primária

1. Faça login com qualquer email (Privy mock em dev)
2. Acesse `/admin` → aprove um organizador
3. O organizador cria um evento em `/organizer`
4. Admin aprova o evento em `/admin` → isso chama `createEvent` on-chain
5. Comprador acessa o catálogo → inicia checkout → clica em "Simular pagamento"
6. Ingresso aparece em `/my-tickets` com QR rotativo

### Check-in

1. Faça login como STAFF
2. Acesse `/checkin`
3. Escaneie o QR ou cole o conteúdo no campo de texto

### Revenda

1. Em `/my-tickets`, clique em "Vender"
2. Embedded wallet assina `approve` + `listTicket`
3. Listagem aparece em `/market`
4. Outro usuário faz checkout PIX → simula pagamento → NFT transferido

### Freeze pós-evento

```bash
curl -X POST http://localhost:3000/api/admin/events/<id>/freeze \
  -H "Authorization: Bearer <admin-token>"
```

---

## Testes dos contratos

```bash
cd smart_contracts
forge test           # roda todos (66 testes)
forge test -vvv      # com traces
forge test --match-contract TicketSaleTest
```

---

## Deploy em testnet (Base Sepolia)

Ver checklist completo no final do `STACK.md`. Resumo:

1. Criar 2 Server Wallets no Privy Dashboard → copiar IDs e endereços para `.env`
2. Exportar vars de ambiente: `CHAIN_ENV`, `PLATFORM_WALLET`, `TREASURY_WALLET`, `USDC_ADDRESS`, `BASE_URI`
3. Rodar `forge script` com uma chave throwaway que tenha ETH Sepolia
4. Copiar endereços do output para `.env` da app
5. Setar `SIGNER_MODE=privy` e chamar `POST /api/admin/setup-approvals` uma vez

> USDC na Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

---

## Docs detalhados

| Arquivo | Conteúdo |
|---|---|
| `STACK.md` | Stack completa, modelo de dados, decisões arquiteturais, roadmap |
| `smart_contracts/CONTRACTS.md` | Referência de todos os contratos — funções, roles, fluxos |
| `smart_contracts/CLAUDE.md` | Diretrizes de engenharia para os contratos |
