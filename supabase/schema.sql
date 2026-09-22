-- Blackjack Friends: Supabase schema
-- PLAY-MONEY ONLY. Do not use this schema for cash wagering.

create extension if not exists pgcrypto;

create table if not exists public.approved_users (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  balance integer not null default 5000 check (balance >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 32),
  invite_code text not null unique,
  host_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  starting_chips integer not null default 5000 check (starting_chips >= 100),
  game jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lobby_players (
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seat integer not null check (seat between 1 and 7),
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id),
  unique (lobby_id, seat)
);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  message text not null check (char_length(message) between 1 and 160),
  created_at timestamptz not null default now()
);

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.approved_users
    where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  approved boolean;
  chosen_name text;
begin
  select public.is_approved() into approved;
  if not approved then
    raise exception 'Your email is not approved for this private table';
  end if;

  chosen_name := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1));

  insert into public.profiles(id, email, display_name)
  values(new.id, new.email, left(chosen_name, 24));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists lobbies_updated_at on public.lobbies;
create trigger lobbies_updated_at before update on public.lobbies
for each row execute procedure public.touch_updated_at();

alter table public.approved_users enable row level security;
alter table public.profiles enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_players enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "approved own row" on public.approved_users;
create policy "approved own row" on public.approved_users
for select to authenticated
using (lower(email) = lower(coalesce(auth.jwt()->>'email','')));

drop policy if exists "read profiles if approved" on public.profiles;
create policy "read profiles if approved" on public.profiles
for select to authenticated
using (public.is_approved());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "read lobbies if approved" on public.lobbies;
create policy "read lobbies if approved" on public.lobbies
for select to authenticated
using (public.is_approved());

drop policy if exists "create lobby if approved" on public.lobbies;
create policy "create lobby if approved" on public.lobbies
for insert to authenticated
with check (public.is_approved() and host_id = auth.uid());

drop policy if exists "update own hosted lobby" on public.lobbies;
create policy "update own hosted lobby" on public.lobbies
for update to authenticated
using (host_id = auth.uid())
with check (host_id = auth.uid());

drop policy if exists "delete own hosted lobby" on public.lobbies;
create policy "delete own hosted lobby" on public.lobbies
for delete to authenticated
using (host_id = auth.uid());

drop policy if exists "read lobby players if approved" on public.lobby_players;
create policy "read lobby players if approved" on public.lobby_players
for select to authenticated
using (public.is_approved());

drop policy if exists "join own lobby" on public.lobby_players;
create policy "join own lobby" on public.lobby_players
for insert to authenticated
with check (public.is_approved() and user_id = auth.uid());

drop policy if exists "leave own lobby" on public.lobby_players;
create policy "leave own lobby" on public.lobby_players
for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "read chat if approved" on public.chat_messages;
create policy "read chat if approved" on public.chat_messages
for select to authenticated
using (public.is_approved());

drop policy if exists "send own chat" on public.chat_messages;
create policy "send own chat" on public.chat_messages
for insert to authenticated
with check (public.is_approved() and user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table public.lobbies;
alter publication supabase_realtime add table public.lobby_players;
alter publication supabase_realtime add table public.chat_messages;

-- Helpful index
create index if not exists lobby_players_lobby_idx on public.lobby_players(lobby_id);
create index if not exists chat_lobby_created_idx on public.chat_messages(lobby_id, created_at);
