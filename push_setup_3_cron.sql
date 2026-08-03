-- PASSO 3 de 3 — Execute no SQL Editor do Supabase, DEPOIS de criar a Edge
-- Function "send-reminders" (passo 2) e configurar os 3 secrets dela.
--
-- Antes de rodar, troque COLE_AQUI_A_SERVICE_ROLE_KEY pela sua Service Role
-- Key, que fica em: Project Settings > API > Project API keys > service_role
-- (é diferente da chave "anon" que já usamos no app — essa é secreta, nunca
-- coloque no código do app, só aqui no SQL do seu próprio projeto).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminders-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://iltmpucfxbrdelimtvyf.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer COLE_AQUI_A_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para conferir se está agendado:
-- select * from cron.job;

-- Para remover o agendamento no futuro, se precisar:
-- select cron.unschedule('send-reminders-every-minute');
