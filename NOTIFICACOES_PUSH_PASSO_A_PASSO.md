# Notificações push de verdade — passo a passo

Isso faz o lembrete aparecer na tela do celular com o toque padrão de
notificação, **mesmo com o app fechado**. São 4 passos no painel do Supabase
+ 1 passo no Netlify. Sem isso, os lembretes continuam existindo só como
aviso dentro do app aberto.

## Passo 1 — Criar as tabelas

`Project > SQL Editor > New query`, cole e rode o arquivo `push_setup_1_tables.sql`.

## Passo 2 — Criar a Edge Function

1. No menu lateral do Supabase, vá em **Edge Functions**.
2. Clique em **Deploy a new function** (ou **Create a function**).
3. Nome da função: `send-reminders`
4. Cole o conteúdo do arquivo `supabase-function/send-reminders/index.ts` no editor e salve/faça o deploy.

## Passo 3 — Configurar os "secrets" da função

Ainda em **Edge Functions**, entre em `send-reminders` > **Secrets** (ou
**Settings**) e adicione estas 3 variáveis:

| Nome | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | `BM6FLzGs8j31a3Ktmfy1pXbK7XpnE66OOABF5xA7L5saFxTTNXlkFn6twlOoKKEvO9SJsnP6DM1UUfjvy7lbheY` |
| `VAPID_PRIVATE_KEY` | `iD4U7hLTaLJy_BLEVUisJHijlORomTPXWbo4Gi55TyQ` |
| `VAPID_SUBJECT` | `mailto:darlanrocha342@gmail.com` |

⚠️ A `VAPID_PRIVATE_KEY` é secreta — só entra aqui nos secrets da função, nunca no código do app.

(`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o próprio Supabase já injeta
automaticamente em toda Edge Function — não precisa configurar essas duas.)

## Passo 4 — Agendar a função para rodar todo minuto

1. Pegue sua **Service Role Key** em `Project Settings > API > Project API keys > service_role`.
2. Abra o arquivo `push_setup_3_cron.sql`, troque `COLE_AQUI_A_SERVICE_ROLE_KEY` pela chave copiada.
3. Rode esse SQL no SQL Editor.

## Passo 5 — Subir o app atualizado no Netlify

Arraste a pasta `orbita-deploy` (dentro do zip) por cima do deploy atual, como das outras vezes.

## Como testar

1. Abra o app no celular (instalado ou pelo navegador), entre na conta.
2. Vá em **Ajustes** e clique em **Ativar** notificações — o celular vai pedir permissão, aceite.
3. Crie um compromisso para **daqui uns 12-15 minutos**.
4. Feche o app completamente.
5. Espere: a notificação deve aparecer sozinha na tela ~10 minutos antes do horário, com o som/vibração padrão do celular.

## O que eu já verifiquei por aqui

- Testei o login, a inscrição de notificação e o Service Worker num navegador de verdade — tudo registra e funciona sem erros.
- Validei toda a lógica de "quando disparar o lembrete" (fuso horário, recorrência diária/semanal/mensal/anual, janela dos 10 minutos) com testes automatizados — todos passaram.
- Não consigo testar a entrega final da notificação **daqui de dentro** porque este ambiente de testes não tem acesso à conexão que os navegadores usam pra falar com o serviço de push do Google/Apple (é uma limitação da minha "sandbox", não do seu app). Por isso o teste real no passo "Como testar" acima é importante — se algo não funcionar exatamente assim, me avisa com o que aconteceu que eu ajusto.
