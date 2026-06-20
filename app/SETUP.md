# Setup — Fase 0

## Pré-requisitos

- Node.js 20+
- Docker (para PostgreSQL local) ou PostgreSQL instalado
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`foundryup`)
- Anvil (incluído no Foundry)

## 1. Banco de dados

```bash
# Opção A: Docker
docker run -d --name shaar-pg \
  -e POSTGRES_DB=shaar \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16

# Opção B: Prisma local (sem Docker)
npx prisma dev
```

## 2. Configurar variáveis de ambiente

```bash
cp .env .env.local
# Preencher NEXT_PUBLIC_PRIVY_APP_ID e PRIVY_APP_SECRET com as chaves do dashboard Privy
# As demais variáveis já estão configuradas para Anvil local
```

## 3. Migrar banco e gerar client

```bash
npm run db:migrate    # cria as tabelas
npm run db:generate   # gera o Prisma Client
```

## 4. Deploy dos contratos no Anvil

```bash
# Terminal 1 — subir Anvil
anvil

# Terminal 2 — deploy
cd ../smart_contracts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# Copiar os endereços impressos no console para o .env.local:
# NEXT_PUBLIC_NFT_ADDRESS=0x...
# NEXT_PUBLIC_SALE_ADDRESS=0x...
# NEXT_PUBLIC_RESALE_ADDRESS=0x...
```

## 5. Seed

```bash
npm run db:seed
```

## 6. Rodar a aplicação

```bash
npm run dev
# http://localhost:3000
```

---

## Estrutura do projeto

```
app/
├── app/                  Next.js App Router
│   ├── api/
│   │   └── auth/sync/    POST — upsert de usuário após login Privy
│   ├── providers.tsx     PrivyProvider client-side
│   └── layout.tsx
├── lib/
│   ├── db.ts             Prisma Client singleton
│   ├── privy.ts          Privy Server Client singleton
│   ├── signer/           Interface Signer (env var → KMS)
│   ├── chain/            viem publicClient + chain config
│   └── contracts/        ABIs + addresses (gerado pelo deploy script)
└── prisma/
    ├── schema.prisma     Schema completo (9 modelos)
    └── seed.ts           Dados de dev local
```
