-- Suivi des paris : tickets de chaque compte (page /suivi). À lancer une fois dans Supabase > SQL Editor.
-- Chaque utilisateur ne voit et ne modifie que ses propres tickets (sécurité au niveau des lignes).

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('simple', 'combine')),
  stake numeric(10, 2) not null check (stake > 0),
  odds numeric(10, 3) not null check (odds >= 1),
  legs jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  settled_at timestamptz,
  seen boolean not null default true
);

create index if not exists tickets_user_created on public.tickets (user_id, created_at desc);

alter table public.tickets enable row level security;

drop policy if exists "tickets lecture" on public.tickets;
drop policy if exists "tickets ajout" on public.tickets;
drop policy if exists "tickets mise a jour" on public.tickets;
drop policy if exists "tickets suppression" on public.tickets;
create policy "tickets lecture" on public.tickets for select to authenticated using (auth.uid() = user_id);
create policy "tickets ajout" on public.tickets for insert to authenticated with check (auth.uid() = user_id);
create policy "tickets mise a jour" on public.tickets for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tickets suppression" on public.tickets for delete to authenticated using (auth.uid() = user_id);

-- Droits de la table pour les comptes connectés (certains projets ne les donnent pas d'office). Rien pour les visiteurs.
grant select, insert, update, delete on public.tickets to authenticated;
