**Face value** = o preço original de venda definido pelo organizador. A ideia do teto seria: "ninguém pode revender por mais de, ex., 200% do face value" — se o ingresso custou R$100, o teto seria R$200. Evita que cambistas marquem por 5x. Você quer esse teto ou deixa o mercado livre?

**Float USDC** = toda vez que alguém compra ingresso em BRL, a Shaar precisa de USDC para pagar as operações on-chain (gas, mint). A questão é: você mantém um saldo de USDC pré-comprado e monitora manualmente quando está baixo, ou cria uma rotina automática que recompra USDC quando o saldo cai abaixo de X? É uma questão operacional de tesouraria. Para MVP pode ser manual; em escala vira automático.

**PSP** — minha recomendação é **Pagar.me**. Razão: tem PIX nativo, tem API de marketplace com split de pagamento (você repassa direto para o organizador na mesma transação, sem precisar fazer transferência manual depois). Stone tem rates bons mas a API de marketplace é menos madura. Stripe não é ideal para MVP com foco em PIX. Alguma restrição com Pagar.me?

**React Native** — faz sentido se o web for React. Minha sugestão é usar **Expo** como camada em cima do React Native — acelera o MVP (OTA updates, sem precisar de build nativo para tudo), e você pode ejetar para bare React Native quando precisar de mais controle.

**Custódia — questão legal** — é um ponto real. A Lei 14.478/2022 (Marco Legal dos Criptoativos) regulamentou VASPs (prestadores de serviços de ativos virtuais) e o BACEN ficou responsável por autorizar. Ser custodiante de ativos de terceiros pode exigir autorização. O argumento do seu lado é que o usuário está comprando _ingresso_, não _cripto_ — o NFT é detalhe de implementação. Mas isso precisa de parecer jurídico antes de ir a produção. Já tem advogado de fintech/cripto no radar?

Agora atualizo o doc com tudo que foi decidido:

| PONTO                             | Decisão                                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teto de revenda (face value)      | podemos colocar limite configuravel por evento? Caso o organizador queira limitar ele poderia, caso contrario n tem limite.                                                                              |
| Custódia / VASP                   | Tenho uma pergunta, entregar a chave para o cliente e manter uma copia de backup pode ser considerado q a custodia é do cliente? Q ai na validação ele conseguiria validar na hora sem depender de rede. |
| Nota fiscal                       | Não entendi o problema aqui                                                                                                                                                                              |
| KYC do organizador                | Isso aqui será necessário sim. Precisamos solicitar o KYC dos organizadores.                                                                                                                             |
| LGPD                              | Acho justo ser problema do juridico. Mas tenho uma pergunta, se guardarmos somente o q precisamos do organizador e dos compradores de ingresso, a gente precisa se preocupar com isso?                   |
| Float USDC                        | Acho melhor termos isso implementado sim, pra já ficar automatico                                                                                                                                        |
| Primeiro organizador âncora       | Go-to-market                                                                                                                                                                                             |
| Verticais de entrada              | Go-to-market. O q significa isso?                                                                                                                                                                        |
| Modelo de cobrança do organizador | Qual a pratica de mercado? Pq a principio n ia cobrar nada especifico do organizador, só tinha pensado na fee cobrada na compra do ingresso.                                                             |
| Canal de aquisição                | Go-to-market                                                                                                                                                                                             |
Vou responder os pontos que precisam de explicação antes de atualizar.

**Nota fiscal** — em toda venda de produto/serviço no Brasil precisa emitir NF. A questão é: quem é o "vendedor" na transação? Duas opções:

- **Shaar emite**: Shaar é o vendedor, coleta e paga ISS/PIS/COFINS de cada ingresso. Mais simples pro organizador, mas todo o peso fiscal cai na Shaar.
- **Organizador emite**: organizador é o vendedor, Shaar é intermediário. Organizador emite NF do ingresso, Shaar emite NF só da sua taxa de 8%. É como a Sympla funciona — mais correto fiscalmente mas exige que o organizador tenha CNPJ e regime fiscal ativo.

**Custódia / VASP** — A ideia de entregar a chave pro usuário e manter backup _ainda_ te enquadra como custodiante pelo BACEN, porque você conseguiria movimentar o ativo sem consentimento do usuário (você tem a cópia). Não resolve o problema legal. Mas a validação offline que você quer resolver **não precisa envolver a chave privada do NFT** — são duas coisas separadas:

- **Chave do NFT** (controla o ativo on-chain) → fica no AWS KMS, usuário nunca vê
- **Credencial de validação** (prova que pode entrar no evento) → é um JWT de curta duração assinado pelo backend da Shaar, que o app pode cachear localmente e usar offline

O scanner da portaria valida o JWT offline com a chave pública da Shaar gravada nele. Sem precisar de rede, sem precisar dar a chave privada pro usuário.

**LGPD** — minimização de dados é um princípio central da LGPD e reduz sua exposição sim. Se você coleta só CPF (fiscal), email (comunicação), histórico de compra (prestação do serviço) e tem base legal clara para cada um — você está bem posicionado. Mas ainda precisa de: política de privacidade publicada, prazo de retenção definido, e acima de certo volume de dados pessoais, indicação de um DPO (pode ser externo). Não é uma preocupação de desenvolvimento agora, mas precisa estar pronto antes do lançamento.

**Verticais de entrada** — "vertical" = segmento específico em que você foca primeiro. Ex: shows de médio porte, teatro, festivais universitários, eventos corporativos. A ideia é escolher um nicho para validar o produto antes de expandir — é mais fácil virar referência num segmento do que tentar atender tudo desde o início.

**Modelo de cobrança** — prática de mercado em ticketing é _success fee_ puro, sem mensalidade. Sympla, Eventbrite, Ingresso.com funcionam assim. Sua abordagem (8% primária + 5% revenda) está alinhada com o mercado. Se quiser no futuro, pode criar um tier premium para organizadores com dashboard avançado, aprovação prioritária e taxa menor — mas pro MVP success fee é o certo.
