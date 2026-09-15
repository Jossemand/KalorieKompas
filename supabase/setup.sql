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

-- ============================================================
-- Billeder af madretter (tilføjet senere). Hele scriptet kan køres igen uden problemer.
-- ============================================================
alter table madretter add column if not exists billede_sti text; -- sti i storage-bucketten

-- Offentlig bucket: billederne kan vises via en almindelig URL. Maks. 5 MB og kun billedformater
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('madret-billeder', 'madret-billeder', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Samme åbne adgang som tabellerne: alle med anon key kan uploade og slette billeder i bucketten
drop policy if exists "madret-billeder: læs" on storage.objects;
create policy "madret-billeder: læs" on storage.objects
  for select to anon, authenticated using (bucket_id = 'madret-billeder');

drop policy if exists "madret-billeder: upload" on storage.objects;
create policy "madret-billeder: upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'madret-billeder');

drop policy if exists "madret-billeder: slet" on storage.objects;
create policy "madret-billeder: slet" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'madret-billeder');