-- =====================================================================
-- ATLAS — Schema Supabase
-- =====================================================================
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase
-- (supabase.com > seu projeto > SQL Editor > New query > colar > Run).
--
-- Modelo: uma linha de "profiles" por usuário (1:1 com auth.users) +
-- tabelas normalizadas para envelopes, lançamentos, metas, aportes de
-- meta e dívidas — cada uma com user_id e Row Level Security, então
-- cada pessoa só enxerga e altera os próprios dados.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Função utilitária: mantém updated_at sempre em dia
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- profiles — 1 linha por usuário autenticado (perfil, preferências,
-- segurança e estado de gamificação)
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  currency text not null default 'BRL',
  monthly_income numeric(14,2) not null default 0,
  onboarded boolean not null default false,

  -- privacidade e segurança
  hide_values boolean not null default false,
  pin_hash text, -- SHA-256 do PIN, calculado no cliente; nunca texto puro

  -- aparência
  theme text not null default 'dark' check (theme in ('light','dark','system')),
  custom_colors jsonb not null default '{}'::jsonb,

  -- gamificação
  streak integer not null default 0,
  last_active_date date,
  ever_had_debt boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: select own" on profiles
  for select using (auth.uid() = id);
create policy "profiles: insert own" on profiles
  for insert with check (auth.uid() = id);
create policy "profiles: update own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles: delete own" on profiles
  for delete using (auth.uid() = id);

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Cria o profile automaticamente quando alguém se cadastra
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- envelopes — categorias de orçamento
-- ---------------------------------------------------------------------
create table if not exists envelopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default 'box',
  color text not null default '#3987e5',
  budget numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table envelopes enable row level security;

create policy "envelopes: select own" on envelopes
  for select using (auth.uid() = user_id);
create policy "envelopes: insert own" on envelopes
  for insert with check (auth.uid() = user_id);
create policy "envelopes: update own" on envelopes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "envelopes: delete own" on envelopes
  for delete using (auth.uid() = user_id);

create trigger trg_envelopes_updated_at
  before update on envelopes
  for each row execute function set_updated_at();

create index if not exists idx_envelopes_user_id on envelopes(user_id);

-- ---------------------------------------------------------------------
-- transactions — lançamentos (receitas e despesas)
-- ---------------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  envelope_id uuid references envelopes(id) on delete set null,
  type text not null check (type in ('income','expense')),
  amount numeric(14,2) not null check (amount >= 0),
  category text not null default 'Outros',
  note text not null default '',
  date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table transactions enable row level security;

create policy "transactions: select own" on transactions
  for select using (auth.uid() = user_id);
create policy "transactions: insert own" on transactions
  for insert with check (auth.uid() = user_id);
create policy "transactions: update own" on transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions: delete own" on transactions
  for delete using (auth.uid() = user_id);

create index if not exists idx_transactions_user_id on transactions(user_id);
create index if not exists idx_transactions_envelope_id on transactions(envelope_id);
create index if not exists idx_transactions_date on transactions(user_id, date);

-- ---------------------------------------------------------------------
-- goals — metas financeiras
-- ---------------------------------------------------------------------
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default 'flag',
  target numeric(14,2) not null default 0,
  saved numeric(14,2) not null default 0,
  deadline date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table goals enable row level security;

create policy "goals: select own" on goals
  for select using (auth.uid() = user_id);
create policy "goals: insert own" on goals
  for insert with check (auth.uid() = user_id);
create policy "goals: update own" on goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals: delete own" on goals
  for delete using (auth.uid() = user_id);

create trigger trg_goals_updated_at
  before update on goals
  for each row execute function set_updated_at();

create index if not exists idx_goals_user_id on goals(user_id);

-- ---------------------------------------------------------------------
-- goal_contributions — histórico de aportes de cada meta
-- (RLS aqui é indireta: valida dono via join com goals)
-- ---------------------------------------------------------------------
create table if not exists goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table goal_contributions enable row level security;

create policy "goal_contributions: select own" on goal_contributions
  for select using (
    exists (select 1 from goals g where g.id = goal_id and g.user_id = auth.uid())
  );
create policy "goal_contributions: insert own" on goal_contributions
  for insert with check (
    exists (select 1 from goals g where g.id = goal_id and g.user_id = auth.uid())
  );
create policy "goal_contributions: delete own" on goal_contributions
  for delete using (
    exists (select 1 from goals g where g.id = goal_id and g.user_id = auth.uid())
  );

create index if not exists idx_goal_contributions_goal_id on goal_contributions(goal_id);

-- ---------------------------------------------------------------------
-- debts — dívidas (Central de Dívidas / Snowball & Avalanche)
-- ---------------------------------------------------------------------
create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'outros', -- financiamento | emprestimo | cartao | parcelado | consorcio | outros
  institution text not null default '',
  original_amount numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  rate numeric(6,3) not null default 0, -- juros ao mês, em %
  contract_date date,
  first_due_date date,
  due_day smallint,
  total_installments integer not null default 1,
  paid_installments integer not null default 0,
  installment_amount numeric(14,2) not null default 0,
  min_payment numeric(14,2) not null default 0, -- mantido por compatibilidade (= installment_amount)
  auto_debit boolean not null default false,
  already_debited boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table debts enable row level security;

create policy "debts: select own" on debts
  for select using (auth.uid() = user_id);
create policy "debts: insert own" on debts
  for insert with check (auth.uid() = user_id);
create policy "debts: update own" on debts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "debts: delete own" on debts
  for delete using (auth.uid() = user_id);

create trigger trg_debts_updated_at
  before update on debts
  for each row execute function set_updated_at();

create index if not exists idx_debts_user_id on debts(user_id);

-- =====================================================================
-- MIGRAÇÃO — já rodou o schema antes (versão anterior da tabela debts)?
-- Rode só o bloco abaixo, é seguro executar mais de uma vez (idempotente).
-- Se está criando o projeto do zero, o "create table if not exists" acima
-- já cria a tabela completa e você pode ignorar este bloco.
-- =====================================================================
alter table debts add column if not exists category text not null default 'outros';
alter table debts add column if not exists institution text not null default '';
alter table debts add column if not exists original_amount numeric(14,2) not null default 0;
alter table debts add column if not exists contract_date date;
alter table debts add column if not exists first_due_date date;
alter table debts add column if not exists due_day smallint;
alter table debts add column if not exists total_installments integer not null default 1;
alter table debts add column if not exists paid_installments integer not null default 0;
alter table debts add column if not exists installment_amount numeric(14,2) not null default 0;
alter table debts add column if not exists already_debited boolean not null default true;
alter table debts add column if not exists auto_debit boolean not null default false;
update debts set installment_amount = min_payment where installment_amount = 0 and min_payment > 0;
update debts set original_amount = balance where original_amount = 0 and balance > 0;

-- =====================================================================
-- Fim do schema. Próximo passo (fora deste arquivo): configurar o
-- cliente Supabase no app (URL + anon key), trocar as leituras/escritas
-- de localStorage por chamadas à API, e decidir o fluxo de login
-- (hoje o ATLAS não pede conta — isso precisa de uma tela de
-- autenticação antes da sincronização funcionar de fato).
-- =====================================================================
