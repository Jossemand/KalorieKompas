-- Kør dette script i Supabase: Project -> SQL Editor -> New query -> Run
-- Opretter alle tabeller til madplan-appen

create extension if not exists "pgcrypto";

create table if not exists ingredienser (
  id uuid primary key default gen_random_uuid(),
  navn text not null,
  barcode text,
  kcal_100g numeric not null default 0,
  protein_100g numeric default 0,
  fedt_100g numeric default 0,
  kulhydrat_100g numeric default 0,
  created_at timestamptz default now()
);

create table if not exists madretter (
  id uuid primary key default gen_random_uuid(),
  navn text not null,
  kategori text not null check (kategori in ('Morgenmad','Frokost','Aftensmad','Snack')),
  created_at timestamptz default now()
);

create table if not exists madret_ingredienser (
  id uuid primary key default gen_random_uuid(),
  madret_id uuid references madretter(id) on delete cascade,
  ingrediens_id uuid references ingredienser(id) on delete cascade,
  maengde_g numeric not null
);

create table if not exists ugeplan (
  id uuid primary key default gen_random_uuid(),
  dag text not null check (dag in ('Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag','Søndag')),
  maaltid text not null check (maaltid in ('Morgenmad','Frokost','Aftensmad','Snack')),
  madret_id uuid references madretter(id) on delete set null,
  unique (dag, maaltid)
);

create table if not exists indstillinger (
  id int primary key default 1,
  kalorie_maal numeric default 2000
);
insert into indstillinger (id, kalorie_maal)
  values (1, 2000)
  on conflict (id) do nothing;

-- Row Level Security: åbnet helt op, fordi appen bruges med den offentlige
-- "anon key" og kun er tiltænkt dig selv. Del ikke linket til appen offentligt,
-- da alle med linket kan læse og skrive i databasen.
alter table ingredienser enable row level security;
alter table madretter enable row level security;
alter table madret_ingredienser enable row level security;
alter table ugeplan enable row level security;
alter table indstillinger enable row level security;

drop policy if exists "allow all ingredienser" on ingredienser;
create policy "allow all ingredienser" on ingredienser for all using (true) with check (true);

drop policy if exists "allow all madretter" on madretter;
create policy "allow all madretter" on madretter for all using (true) with check (true);

drop policy if exists "allow all madret_ingredienser" on madret_ingredienser;
create policy "allow all madret_ingredienser" on madret_ingredienser for all using (true) with check (true);

drop policy if exists "allow all ugeplan" on ugeplan;
create policy "allow all ugeplan" on ugeplan for all using (true) with check (true);

drop policy if exists "allow all indstillinger" on indstillinger;
create policy "allow all indstillinger" on indstillinger for all using (true) with check (true);