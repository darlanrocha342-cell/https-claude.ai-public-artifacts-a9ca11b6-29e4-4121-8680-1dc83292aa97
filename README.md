# ATLAS

Seu assessor financeiro com inteligência artificial. Não é só um controle de
gastos — o app pensa antes de você: gera orçamento automático a partir da sua
renda, projeta suas metas, prioriza suas dívidas e te dá recomendações a cada
lançamento.

100% local-first: todos os dados ficam salvos apenas no seu dispositivo
(`localStorage`), sem servidor, sem cadastro, sem conta.

## Funcionalidades

- **Onboarding inteligente** — informe nome e renda mensal e o app já gera um
  orçamento por envelopes (Moradia, Alimentação, Transporte, Lazer, Saúde,
  Assinaturas, Outros) proporcional à sua renda.
- **Dashboard** — saldo do mês, receitas x despesas, taxa de economia, valor
  recomendado para gastar por dia, score financeiro (0–100) e insights
  automáticos.
- **Orçamento por envelopes** — cada categoria muda de cor (verde → amarelo →
  laranja → vermelho) em 80% / 90% / 100% do limite.
- **Metas** — defina valor alvo e prazo; o app calcula o aporte mensal
  necessário e avisa se você está adiantado ou atrasado.
- **Central de dívidas** — gerenciador completo de financiamentos, empréstimos,
  cartões parcelados, consórcios e compras parceladas: categoria, instituição,
  valor original, parcelas pagas/restantes, linha do tempo mês a mês, insight
  automático de quando a dívida termina, simulador "e se eu pagar R$X a mais",
  botões **Pagar parcela** e **Quitar**, além das estratégias *Snowball*
  (menor saldo primeiro) e *Avalanche* (maior juros primeiro). Com **débito
  automático** ligado, o ATLAS lança a parcela como despesa sozinho na
  próxima vez que o app é aberto após o vencimento (não é um débito bancário
  de verdade — é o ATLAS mantendo o controle atualizado pra você).
- **Relatórios** — receitas x despesas dos últimos 6 meses e gastos por
  categoria no mês, com tabela de dados acessível.
- **Gamificação** — nível, XP, sequência diária (streak) e medalhas para
  incentivar disciplina financeira.
- **Motor de insights** — compara gastos por categoria com a média dos meses
  anteriores e sugere economias concretas em R$/ano.
- **Privacidade** — botão para ocultar todos os valores na tela (blur) e PIN
  de acesso opcional.
- **Tema** — Claro / Sistema / Escuro, além de um editor de cores
  personalizadas (faixas, cards e fundo) no menu lateral.

## Rodar localmente

Site 100% estático (um único `index.html`), sem build:

```
python3 -m http.server 8000
```

e acessar `http://localhost:8000`.

## Deploy no Netlify

1. Crie um site novo no [Netlify](https://app.netlify.com).
2. Conecte este repositório do GitHub (deploy automático a cada push) **ou**
   arraste a pasta do projeto direto na tela de deploy do Netlify.
3. Build command: (vazio) — Publish directory: `.`

## Portão de acesso (chave compartilhada)

Antes de chegar na tela de login, dá pra exigir uma chave de acesso única
(a mesma para todo mundo que você autorizar) — útil pra manter o app fora
do alcance de quem não deveria estar testando ainda.

**Como ativar:** abra `index.html`, procure `const ACCESS_KEY` (perto do
bloco do Supabase) e troque o valor padrão pela sua chave, por exemplo:
`const ACCESS_KEY = 'atlas2026';`. Salve — pronto, agora a primeira tela
que qualquer pessoa vê é o portão com a logo do ATLAS pedindo essa chave.
Quem digitar certo uma vez fica liberado naquele aparelho/navegador (não
precisa repetir a cada visita). Enquanto o valor for o padrão de fábrica, o
portão fica desligado e o app abre direto, como hoje.

**Importante:** isso é um filtro simples, não segurança de verdade — como o
ATLAS é um arquivo estático sem servidor, a chave fica visível a quem abrir
o código-fonte da página (Ctrl+U). Serve pra manter curiosos/buscadores de
fora durante um teste fechado, não pra proteger dados de alguém disposto a
inspecionar o código. Pra controle de acesso robusto, o caminho seria
desativar cadastro público no Supabase Auth e criar as contas manualmente.

## Banco de dados e login (Supabase) — integrado

O ATLAS já fala com o Supabase: login/cadastro por e-mail e senha, e todo
lançamento, envelope, meta e dívida é salvo na nuvem (com `localStorage`
como cache local). `supabase_schema.sql` tem as tabelas: `profiles` (perfil,
preferências, tema, PIN com hash, gamificação — 1 linha por usuário) e
`envelopes`, `transactions`, `goals`, `goal_contributions`, `debts`, todas
com `user_id` e Row Level Security — cada pessoa só acessa os próprios dados.

**Como ativar (3 passos):**
1. Crie um projeto em [supabase.com](https://supabase.com), vá em **SQL
   Editor > New query**, cole o conteúdo de `supabase_schema.sql` e rode.
   Confira em **Table Editor** se as 6 tabelas foram criadas com RLS ativo
   (ícone de cadeado).
2. Em **Project Settings > API**, copie a **Project URL** e a chave
   **anon / public** (não é secreta — pode ficar no código do front-end).
3. Abra o ATLAS no navegador: a primeira tela pede exatamente esses dois
   valores (Project URL + chave anon). Cole e toque em **Conectar** —
   nada de editar código. O app entra sozinho com uma sessão anônima do
   Supabase Auth (é preciso ativar **Authentication > Providers >
   Anonymous Sign-ins** no painel do projeto para isso funcionar).

Enquanto não conectar, ou se tocar em "Usar sem nuvem por enquanto", o
ATLAS continua funcionando 100% local, como antes. Por não usar
e-mail/senha, cada aparelho que conecta cria sua própria sessão —
não há como acessar os mesmos dados de dois aparelhos diferentes.

**Já rodou o schema antes (versão antiga da tabela `debts`)?** A tabela de
dívidas ganhou colunas novas (categoria, instituição, parcelas, débito
automático etc.). Vá no final de `supabase_schema.sql` e rode só o bloco
"MIGRAÇÃO" — é seguro rodar mesmo se as colunas já existirem.

**Confirmação de e-mail:** por padrão o Supabase Auth exige confirmar o
e-mail antes do primeiro login — pode desligar isso em **Authentication >
Providers > Email > Confirm email** se quiser testar mais rápido.

**Limitação conhecida:** Exportar/Importar dados (em Configurações) ainda
trabalha só com o cache local (`localStorage`), não lê/escreve na nuvem.

## Notificações push (avisos no celular)

O ATLAS manda uma notificação push de verdade — aparece no celular mesmo
com o app fechado — um dia antes de uma parcela de dívida ou de uma
despesa fixa vencer. Precisa de nuvem conectada (usa a mesma tabela de
usuários) e de uma peça de servidor: uma Edge Function do Supabase que
roda uma vez por dia e dispara os avisos.

**O que já está pronto no projeto** (não precisa mexer):
- `sw.js` — o Service Worker já sabe receber a notificação e mostrá-la.
- `index.html` — tela de Configurações com o botão "Ativar notificações"
  (só aparece com a nuvem conectada), que pede permissão ao navegador e
  salva a inscrição na tabela `push_subscriptions`.
- `supabase_schema.sql` — já tem a tabela `push_subscriptions` com RLS.
- `supabase/functions/send-due-notifications/index.ts` — o código da
  Edge Function que verifica os vencimentos e envia os avisos.

**O que só você consegue fazer (painel do Supabase), passo a passo:**

1. **Rode o SQL da tabela nova** (se já rodou o schema antes): abra
   `supabase_schema.sql`, ache a tabela `push_subscriptions` e rode esse
   bloco no SQL Editor (é seguro, usa `create table if not exists`).

2. **Instale a Supabase CLI** no seu computador (uma vez só):
   `npm install -g supabase` (ou veja outras opções em
   [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)).

3. **Faça login e vincule o projeto**, dentro da pasta do ATLAS:
   ```
   supabase login
   supabase link --project-ref SEU_PROJECT_REF
   ```
   (o `PROJECT_REF` é o trecho antes de `.supabase.co` na sua Project URL).

4. **Configure os segredos da função** — a chave VAPID *privada* nunca
   pode ir no código do app, só aqui:
   ```
   supabase secrets set VAPID_PUBLIC_KEY=BMDSm8Ewf2-xDPTCRu9rd6dr3WIanWQsJtObsMikwJ9Ow23WsH0Ho69zQgm3sIbJo8_5RHOGHOd8YVIL5EFo-fo
   supabase secrets set VAPID_PRIVATE_KEY=ztqfkhiE0QBIlNASanT65CahUOr1rqRMs-1H2R9NaHc
   ```
   (esse par já está pronto e é o mesmo usado em `index.html` — se quiser
   gerar um novo par, qualquer gerador de chaves VAPID serve, só troque
   nos dois lugares.)

5. **Publique a função**:
   ```
   supabase functions deploy send-due-notifications
   ```

6. **Agende para rodar todo dia**, no SQL Editor do painel:
   ```sql
   create extension if not exists pg_cron with schema extensions;
   create extension if not exists pg_net with schema extensions;

   select cron.schedule(
     'atlas-send-due-notifications',
     '0 12 * * *', -- 12:00 UTC = 09:00 em Brasília
     $$
     select net.http_post(
       url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/send-due-notifications',
       headers := jsonb_build_object('Authorization', 'Bearer SUA_SERVICE_ROLE_KEY', 'Content-Type', 'application/json')
     );
     $$
   );
   ```
   Troque `SEU_PROJECT_REF` pelo mesmo da Project URL, e
   `SUA_SERVICE_ROLE_KEY` pela chave em **Project Settings > API >
   service_role** (essa sim é secreta — nunca cole no `index.html`).

7. **Ative no app**: abra o ATLAS, vá em **Configurações > Notificações
   push > Ativar notificações**, e aceite a permissão do navegador.
   No iPhone, o Safari só permite push depois de "Adicionar à Tela de
   Início" (compartilhar → Adicionar à Tela de Início) — abra o ATLAS
   pelo ícone criado, não pelo Safari direto, antes de ativar.

**Testar sem esperar um dia de verdade:** com a CLI logada, rode
`supabase functions invoke send-due-notifications` a qualquer momento —
ele já verifica os vencimentos de "amanhã" na hora.

## Relatório semanal por WhatsApp

O ATLAS manda, toda semana, um resumo financeiro (receitas, despesas,
envelopes no limite, progresso das metas e contas vencendo nos próximos
7 dias) direto no WhatsApp. O envio usa o [Twilio](https://twilio.com),
que tem um modo "Sandbox" gratuito — dá pra testar hoje mesmo, sem
cadastro de negócio.

**O que já está pronto no projeto** (não precisa mexer):
- `supabase_schema.sql` — colunas `whatsapp_number` e
  `whatsapp_reports_enabled` na tabela `profiles`.
- `index.html` — tela de Configurações com o card "Relatório semanal
  por WhatsApp", onde você cadastra seu número.
- `supabase/functions/send-weekly-report/index.ts` — a Edge Function
  que monta o resumo e envia via Twilio.

**O que só você consegue fazer, passo a passo:**

1. **Rode o SQL das colunas novas** (se já rodou o schema antes): abra
   `supabase_schema.sql`, ache o bloco "MIGRAÇÃO" no final e rode no
   SQL Editor (é seguro, usa `add column if not exists`).

2. **Crie uma conta grátis no [Twilio](https://www.twilio.com/try-twilio)**.
   No Console (painel inicial), copie o **Account SID** e o **Auth
   Token** — ficam visíveis assim que você entra.

3. **Ative o WhatsApp Sandbox**: no menu lateral do Twilio, vá em
   **Messaging > Try it out > Send a WhatsApp message**. Vai aparecer
   um número do Twilio e um código tipo `join palavra-exemplo`.

4. **Do seu celular, mande esse `join ...` pelo WhatsApp** para o
   número do sandbox mostrado na tela. Isso libera o SEU número a
   receber mensagens do sandbox — sem esse passo, nada chega.
   **Atenção:** no modo sandbox (grátis), esse "join" expira depois de
   alguns dias de inatividade — se as mensagens pararem de chegar,
   é só mandar o `join ...` de novo.

5. **Configure os segredos da função**, no painel do Supabase em
   **Edge Functions > Secrets** (ou via CLI):
   ```
   supabase secrets set TWILIO_ACCOUNT_SID=SEU_ACCOUNT_SID
   supabase secrets set TWILIO_AUTH_TOKEN=SEU_AUTH_TOKEN
   supabase secrets set TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   ```
   (o número `+14155238886` é o padrão do sandbox do Twilio — troque
   pelo que aparecer na sua tela do passo 3, se for diferente.)

6. **Publique a função `send-weekly-report`**: pela CLI
   (`supabase functions deploy send-weekly-report`) ou copiando o
   conteúdo de `supabase/functions/send-weekly-report/index.ts` no
   editor web do painel do Supabase (Edge Functions > Create a new
   function), mesmo processo já usado para `send-due-notifications`.

7. **Agende para rodar toda segunda-feira**, no SQL Editor:
   ```sql
   select cron.schedule(
     'atlas-send-weekly-report',
     '0 12 * * 1', -- 12:00 UTC de segunda = 09:00 em Brasília
     $$
     select net.http_post(
       url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/send-weekly-report',
       headers := jsonb_build_object('Authorization', 'Bearer SUA_SERVICE_ROLE_KEY', 'Content-Type', 'application/json')
     );
     $$
   );
   ```
   Troque `SEU_PROJECT_REF` e `SUA_SERVICE_ROLE_KEY` do mesmo jeito
   feito para o cron das notificações push.

8. **Ative no app**: abra o ATLAS, vá em **Configurações > Relatório
   semanal por WhatsApp**, digite seu número com DDI e DDD (formato
   `+5511912345678`) e toque em **Ativar relatório semanal**.

**Testar sem esperar até segunda:** no painel do Supabase, abra
**Edge Functions > send-weekly-report > Test** e clique em enviar —
ele já manda o resumo na hora pra quem estiver com o relatório
ativado (mesmo fluxo de teste já usado nas notificações push).

**Importante — sandbox x produção:** o modo sandbox do Twilio é
gratuito e ótimo pra uso pessoal (é literalmente o seu caso: você
mandando relatório pro seu próprio WhatsApp), mas tem essas
limitações: só entrega pra números que deram "join" no sandbox, e o
Twilio mostra um aviso de "sandbox" nas primeiras mensagens de cada
sessão. Pra tirar essas limitações (número de WhatsApp Business
próprio, sem aviso de sandbox), o Twilio exige aprovação de um
número comercial — não é necessário pra este uso, só vale a pena se
um dia isso virar um produto pra outras pessoas usarem.

## Roadmap sugerido

- Calendário financeiro (contas a vencer, parcelas, assinaturas)
- Módulo de investimentos (renda fixa, ações, cripto, rentabilidade)
- Simulador "e se" (alterar renda, gastos, metas e ver o impacto na hora)
- Biometria / Face ID via WebAuthn
