-- PASSO 1 de 3 — Execute no SQL Editor do Supabase (Project > SQL Editor > New query)
-- Cria as tabelas necessárias para notificações push de verdade.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users manage their own push subscriptions" on public.push_subscriptions;
create policy "Users manage their own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Controla quais lembretes já foram enviados, pra não repetir o mesmo aviso
-- a cada execução do agendamento (roda a cada 1 minuto).
create table if not exists public.sent_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, reminder_key)
);

alter table public.sent_reminders enable row level security;
-- Sem política de acesso: só a função do servidor (service_role) acessa essa tabela.
