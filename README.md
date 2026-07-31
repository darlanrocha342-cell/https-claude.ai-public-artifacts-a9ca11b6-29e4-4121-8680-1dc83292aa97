# ÓRBITA

App de agenda, tarefas, hábitos e metas com login e sincronização via Supabase.

## Configurar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (ou use um já existente).
2. Em **Project Settings > API**, pegue a **Project URL** e a chave **anon/public**.
3. No arquivo `index.html`, procure por `SUPABASE_URL` e `SUPABASE_ANON_KEY` (dentro da tag `<script>`) e cole os seus valores.
4. Em **SQL Editor**, rode o conteúdo de `supabase_setup.sql` para criar a tabela `app_state` com as permissões corretas (cada usuário só acessa os próprios dados).
5. (Opcional) Em **Authentication > Providers > Email**, desative "Confirm email" se quiser que novas contas entrem direto, sem precisar clicar num link de confirmação por e-mail.

## Deploy no Netlify

Este é um site 100% estático (um único `index.html`), então não precisa de build:

1. Crie um site novo no [Netlify](https://app.netlify.com).
2. Conecte este repositório do GitHub (deploy automático a cada push) **ou** arraste a pasta do projeto direto na tela de deploy do Netlify.
3. Build command: (vazio) — Publish directory: `.`
4. Pronto — o link do Netlify já serve o app com login e sincronização funcionando.

## Rodar localmente

Basta abrir `index.html` num servidor estático simples, por exemplo:

```
python3 -m http.server 8000
```

e acessar `http://localhost:8000`.
