-- Execute no SQL Editor do seu projeto Supabase (Project > SQL Editor > New query)

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "Users manage their own app state"
  on public.app_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Notificações push: um dispositivo (endpoint) por linha, várias linhas por usuário
-- (celular, notebook, etc. contam como inscrições separadas).
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "Users manage their own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
