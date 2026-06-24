# Shaar — Brainstorm & Descrição do Projeto

> Documento vivo para alinhar visão, explorar ideias e registrar decisões de produto ainda em aberto.

---

## Descrição do projeto

**O que é:**
Shaar é uma plataforma de ingressos digitais para eventos ao vivo. Organizadores cadastram shows, festivais e peças; compradores pagam com PIX ou cartão como em qualquer outra plataforma — só que por baixo os ingressos existem on-chain, o que torna a revenda auditável, os royalties automáticos e o ingresso imune a fraude.

**O que diferencia:**
- **Anti-cambismo com royalty automático:** toda revenda repassa uma % configurável ao organizador, sem que a plataforma precise policiar nada — o contrato garante.
- **Sem taxa de conveniência escondida:** o organizador vê exatamente o que a plataforma retém.
- **Ingresso vira lembrança:** após o evento, o ingresso se torna um colecionável digital do comprador — metadata congelada em IPFS, transferível como qualquer NFT (pode ser vendido como memória do evento).
- **Blockchain invisível:** o comprador só vê PIX, QR code e R$. A infraestrutura é interna.

**One-liner:**
> *Ingressos digitais com revenda justa e royalty automático para organizadores — sem cripto visível.*

---

## Personas

### Comprador (B2C)
- Vai a shows, festivais, teatro, eventos esportivos
- Já comprou em Ingresso.com / Sympla / Eventbrite
- Frustração: cambistas, ingressos falsos, taxa de conveniência absurda
- Não sabe o que é blockchain e não precisa saber

### Organizador (B2B — cliente principal)
- Produtoras independentes, casas de show, festivais
- Dor: repasse demorado (D+30), sem controle sobre revenda, sem royalty quando ingresso muda de mão
- Quer: dashboard simples, aprovação rápida, receber na hora da venda

### Plataforma (nós)
- Receita: 8% da venda primária + 5% de toda revenda
- Diferencial operacional: sem necessidade de equipe de combate ao cambismo

---

## Modelo de receita

| Fonte | % | Quando entra |
|---|---|---|
| Taxa de venda primária | 8% do preço original | Na compra do ingresso |
| Taxa de revenda | 5% de cada transação no mercado | Na revenda |
| Spread BRL/USDC | Configurável (ex.: 1%) | Na conversão de câmbio |
| Taxa de saque PIX | 1% | Quando vendedor saca |

---

## Perguntas abertas de produto

### Go-to-market
- [ ] Qual o primeiro organizador? (precisa de 1 âncora pra validar o fluxo completo)
- [ ] Verticais de entrada: qual segmento focar primeiro? (vertical = nicho específico — ex: shows de médio porte, teatro, festivais universitários, eventos corporativos)
- **Decisão:** modelo de cobrança do organizador é *success fee* puro (8% venda primária + 5% revenda) — sem mensalidade; alinhado com prática de mercado (Sympla, Eventbrite)
- [ ] Como adquirimos o organizador: inbound (SEO, content) ou outbound (equipe comercial)?

### Produto
- **Decisão:** split de revenda exibe "X vai para você, Y é comissão" — sem detalhar internamente quanto vai para o organizador vs. plataforma
- **Decisão:** arte do ingresso-lembrança é personalizada por evento; organizador pode fornecer a própria arte ou aceitar sugestão/geração da plataforma; arte padrão como fallback se nenhuma opção for escolhida
- **Decisão:** limite de ingressos por CPF implementado — ver seção "Controle de Ingressos por CPF"
- **Decisão:** teto de revenda é **configurável por evento** pelo organizador — se definido, nenhuma revenda pode superar X% do preço original (preço original = preço original de venda); se não configurado, sem limite

### Estrutura jurídica / fiscal
- **CNAE principal:** 7490-1/04 — Atividades de intermediação e agenciamento de serviços e negócios em geral
- **Regime tributário sugerido:** Simples Nacional (alíquota consolidada a partir de ~6% para serviços; simplifica ISS, PIS/COFINS, IRPJ, CSLL)
- **Base de receita da Shaar:** somente a taxa de 8% (não o valor total do ingresso) — organizer é o vendedor, Shaar emite NF só da taxa de serviço
- [ ] Confirmar com contador se intermediação de ingressos + infraestrutura blockchain se enquadra no Simples sem restrição

### Regulatório / Compliance
- [ ] Enquadramento da recompra de USDC (off-ramp do vendedor) — obriga licença de câmbio?
- [ ] Custódia de ativos digitais / VASP — **levar para o jurídico:** Lei 14.478/2022 pode exigir autorização do BACEN como VASP; argumento central: usuário compra *ingresso* e nunca interage com ativo digital — NFT é detalhe de implementação interno (blockchain invisível), portanto Shaar é plataforma de ingressos, não custodiante de criptoativos; usar Turnkey ou AWS KMS não transfere a custódia legal (KMS é sub-processador técnico, custódia regulatória continua com Shaar independente de onde as chaves ficam); o argumento jurídico é de modelo de negócio, não de arquitetura técnica
- **Decisão:** organizador é o vendedor — emite NF de cada ingresso; Shaar emite NF apenas da taxa de 8% como intermediário; CNPJ ativo passa a ser requisito do KYC do organizador
- **Decisão:** KYC do organizador é obrigatório antes de ativar repasse — nível mínimo a definir (CNPJ, dados bancários, documentação societária)
- **Decisão:** LGPD — ToS + Política de Privacidade publicada antes do lançamento; coletar somente CPF, email e histórico de compra com finalidade explícita; DPO e auditoria formal podem aguardar escala
- **Feature obrigatória (pré-lançamento):** solicitação de exclusão de dados — `DELETE /account` na API (anonimiza/deleta CPF, email, dados pessoais; mantém registros fiscais pelo prazo legal) + tela de "excluir minha conta" no front dentro das configurações do usuário

### Técnico / Operacional
- **Decisão:** PSP → **Pagar.me** (PIX nativo + API de marketplace com split de pagamento direto ao organizador)
- **Decisão:** gestão de float USDC automática desde o início — rotina monitora saldo mínimo e dispara recompra automaticamente
- **Decisão:** KMS → **AWS KMS** no MVP (sem limite de chaves, sem lock-in); abstraction layer no código para migração futura para MPC se necessário
- **Decisão:** App mobile → **React Native + Expo** na fase 2 (compartilha ecossistema com web React; Expo para agilidade no MVP mobile)

---

## Diferenciadores vs. incumbentes

| | Ingresso.com | Sympla | **Shaar** |
|---|---|---|---|
| Revenda oficial | Não | Não | Sim — com royalty automático |
| Royalty para organizador na revenda | Não | Não | Sim — configurável |
| Repasse ao organizador | D+30 | D+14 | Na hora da venda |
| Anti-cambismo técnico | Não | Não | Teto de preço + royalty desincentiva |
| Ingresso-lembrança | Não | Não | Sim — pós-evento |
| Blockchain visível ao usuário | — | — | Não (invisível) |

---

## Ideias para explorar

### Curto prazo (antes do MVP)
- **Arte do ingresso gerada por IA** — cada evento tem um visual único gerado com base no nome do artista/evento. Diferencia visualmente a lembrança.
- **QR dinâmico com cooldown** — impossível fazer print circular; o QR expira em 60s e o app mostra o timer. Simples de comunicar pro usuário.
- **"Ingresso garantido"** — se o evento esgotar antes da confirmação do PIX, fila de espera automática com prioridade para quem já digitou os dados.

### Médio prazo (fase 2)
- **Swap de ingressos** — troca direta entre compradores (contrato já existe: `TicketSwap.sol`). Permite transferir ingresso sem passar pelo mercado se for um favor/presente.
- **Planos de fidelidade para organizadores** — organizadores com histórico na plataforma têm taxa menor, aprovação automática.
- **Ingresso corporativo** — empresa compra lote de ingressos, distribui internamente com controle de quem usou cada um.
- **Integração com calendário** — ingresso aparece no Google Calendar / Apple Calendar automaticamente após a compra.

### Longo prazo / especulativo
- **API para outros marketplaces** — deixar a infraestrutura de ingresso on-chain como serviço para outras plataformas (B2B puro).
- **Seguro de ingresso** — parceria com seguradora para cobrir não comparecimento por doença/emergência (premium pago no checkout).
- **Pré-venda tokenizada** — organizador vende "direito de compra" antes de anunciar preços. Interessante para artistas com base fiel.

---

## Especificações Técnicas — Features em Desenvolvimento

### Vendas por Lotes (Ticket Tiers)

Organizador pode configurar múltiplos lotes por evento, cada um com preço, quantidade e janela de tempo próprios.

**Modelo de dados:**
```
ticket_tiers:
  event_id
  name        → "1º Lote", "2º Lote", etc.
  price       → preço desse lote
  quantity    → quantidade disponível (null = ilimitado)
  sold_count  → vendidos até agora
  starts_at   → quando abre (opcional)
  ends_at     → quando fecha (opcional)
```

Lote ativo = `starts_at <= agora <= ends_at` E `sold_count < quantity`. Ao esgotar quantidade, próximo lote ativa automaticamente. Checkout busca o lote ativo sem o comprador escolher.

**Decisões:**
- `max_per_cpf` conta o total de ingressos em **todos os lotes**, não por lote
- Waiting room ativa automaticamente na abertura de cada lote; se a fila esvazia rápido (demanda baixa), desativa automaticamente — organizer não configura isso

---

### Fila de Espera Virtual (Waiting Room)

Feature on/off por evento — ativa para alta demanda, desligada para eventos pequenos. Feature flag `waiting_room_enabled: bool` no registro do evento.

**Decisões de design:**

- **Identificação:** usuário precisa estar logado para entrar na fila — sem auth, sem posição garantida. Fluxo: se não autenticado ao tentar comprar ingresso de evento com fila ativa → redireciona para login → retorna para a fila após auth.
- **Anti-replay (jumping the queue):** JWT de admissão com `valid_until` curto (15 min) + campo `jti` (UUID único por emissão) armazenado como `SET jti:<jti> 1 EX 900` no Redis. Checkout consome o `jti` na primeira validação bem-sucedida (`DEL`) — uso duplo é rejeitado.
- **Alta disponibilidade:** serviço de fila deployado em infra completamente separada da origem — container e domínio próprios (ex: `queue.shaar.com.br`), Redis exclusivo, Cloudflare na frente para absorver o spike inicial. Se a origem cair durante um evento, o waiting room continua exibindo posições e admitindo usuários; eles só encontram erro ao tentar prosseguir para o checkout.
- **Fairness / aba fechada-reaberta:** ao reconectar, cliente reenvia `user_id` → backend executa `ZRANK queue:{event_id} <user_id>` — se já está na fila, retorna posição existente sem re-adicionar. Posição só é perdida se o usuário for admitido e o JWT expirar sem uso (aí volta ao final da fila).

**Steps de implementação:**

1. **Entrada na fila**
   - `POST /queue/{event_id}/join` (requer auth)
   - Verifica se `user_id` já existe no sorted set com `ZSCORE`; se sim, retorna posição atual sem re-adicionar
   - `ZADD queue:{event_id} NX <unix_timestamp_ms> <user_id>` (flag `NX` garante idempotência)
   - Retorna posição via `ZRANK`

2. **Stream de posição**
   - `GET /queue/{event_id}/position` — SSE endpoint (requer auth)
   - Ao (re)conectar: envia posição atual imediatamente
   - Publica atualização após cada batch de admissão do worker

3. **Worker de admissão**
   - Loop com intervalo configurável; taxa: `admissions_per_minute` editável em runtime por evento
   - `ZPOPMIN queue:{event_id} <batch_size>` → lista de `user_id` admitidos
   - Para cada admitido: emite JWT `{ event_id, user_id, valid_until: now+15min, jti: uuid4 }` + `SET jti:<jti> 1 EX 900` no Redis da fila

4. **Validação no checkout (origem)**
   - Verifica assinatura JWT (chave pública compartilhada entre serviços)
   - `EXISTS jti:<jti>` no Redis da fila — ausente = token já usado ou expirado → rejeita com 403
   - `DEL jti:<jti>` na primeira validação bem-sucedida (one-time-use)
   - Se `waiting_room_enabled = false` no evento: ignora JWT, segue fluxo normal

---

### Smart Contract — Limites e Data do Evento (TicketSale.sol)

**maxTickets opcional:**
- `maxTickets = 0` → ilimitado (sem cap de supply no contrato)
- `maxTickets > 0` → limite fixo; mint bloqueado ao atingir
- Organizer (via plataforma) pode aumentar o limite após início das vendas via `updateMaxTickets` — redução não é permitida

**Bloqueio de mint após data do evento:**
- `_buyTicket` rejeita compras quando `block.timestamp >= eventTimestamp + 2 hours`
- Janela de 2h cobre compras legítimas feitas momentos antes do início
- `eventTimestamp` é obrigatório na criação do evento (`require(eventTimestamp > 0)`)

---

### Controle de Ingressos por CPF

Organizador configura dois limites independentes por evento:

- `max_per_cpf` — total de ingressos que um CPF pode comprar (ex: 4)
- `max_half_price_per_cpf` — sub-limite de meia-entrada dentro do total (ex: 2; deve ser ≤ `max_per_cpf`)

Ambos opcionais — se não configurados, sem restrição.

**Enforcement no checkout (application layer, dentro de transação com lock):**

```sql
-- dentro de BEGIN ... COMMIT com SELECT FOR UPDATE
SELECT COUNT(*) FROM purchases
  WHERE cpf = ? AND event_id = ? AND status != 'cancelled'
-- deve ser < max_per_cpf

SELECT COUNT(*) FROM purchases
  WHERE cpf = ? AND event_id = ? AND half_price = true AND status != 'cancelled'
-- deve ser < max_half_price_per_cpf
```

Lock necessário para evitar race condition em compras simultâneas do mesmo CPF (dois tabs abertos, por exemplo). Ingressos cancelados ou estornados decrementam os contadores (`status = 'cancelled'`).

**Decisões fechadas:**
- **Revenda:** limites de `max_per_cpf` e `max_half_price_per_cpf` se aplicam **somente à venda primária** — revenda não tem restrição por CPF
- **Comprovante de meia-entrada:** validado **na portaria**, não no checkout — reduz fricção na compra e suporta modalidades sociais (doação de alimentos, parceria com empresa, etc.) onde não existe documento formal a apresentar antes do evento
- **Tipos de meia-entrada:** o organizador define o tipo ao configurar o evento (ex: estudante, idoso, doação de alimento, parceria XYZ) — o ingresso registra qual tipo foi selecionado, mas não exige prova digital na compra

**Decisão:** organizador pode **aumentar** `max_per_cpf` e `max_half_price_per_cpf` após início das vendas; redução não é permitida.

---

## Nome (em definição)

Nome de trabalho atual: **Shaar** (hebraico — "portão/entrada")

> Ver `nomes.md` para lista completa de candidatos.

Próximos passos no naming:
- [ ] Verificar disponibilidade de domínio (`shaar.com.br`, `shaar.io`)
- [ ] Verificar registro no INPI
- [ ] Testar pronunciabilidade com pessoas fora do projeto

---

## Pitch de 30 segundos (rascunho)

> "A gente vende ingresso como qualquer outra plataforma — PIX, cartão, QR code. A diferença é que cada ingresso é verificável e único, o que elimina fraude e torna a revenda auditável. Quando alguém revende, o organizador recebe um royalty automático sem precisar fazer nada. E depois do show, o ingresso vira uma lembrança digital permanente. O comprador não sabe que tem blockchain. O organizador não precisa. A gente cuida disso."
