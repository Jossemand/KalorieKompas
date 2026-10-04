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

-- Én række pr. bruger med det daglige kaloriemål. Tidligere havde tabellen kun én fælles række (id = 1);
-- den omdannes i afsnittet om flere brugere nederst
create table if not exists indstillinger (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kalorie_maal numeric default 2000
);

-- Row Level Security: reglerne for, hvem der må se og ændre hvad, står i afsnittet om flere brugere nederst
alter table ingredienser enable row level security;
alter table madretter enable row level security;
alter table madret_ingredienser enable row level security;
alter table ugeplan enable row level security;
alter table indstillinger enable row level security;

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

-- Hvem der må uploade og slette billeder, står i afsnittet om flere brugere nederst

-- ============================================================
-- Portioner og mængder (tilføjet senere). Hele scriptet kan køres igen uden problemer.
-- ============================================================
-- Valgfri opdeling af en madret: antal portioner og vægten af den færdige ret.
-- Uden færdigvægt regner appen med ingrediensernes samlede (rå) vægt.
alter table madretter add column if not exists portioner numeric check (portioner > 0);
alter table madretter add column if not exists faerdig_vaegt_g numeric check (faerdig_vaegt_g > 0);

-- Hvor meget man spiser af retten i ugeplanen, i gram eller portioner. Tom = hele retten
alter table ugeplan add column if not exists maengde numeric check (maengde > 0);
alter table ugeplan add column if not exists enhed text check (enhed in ('g', 'portion'));
alter table ugeplan drop constraint if exists ugeplan_maengde_og_enhed;
alter table ugeplan add constraint ugeplan_maengde_og_enhed check ((maengde is null) = (enhed is null));

-- ============================================================
-- Kladder, producent og retter uden kategori (tilføjet senere). Hele scriptet kan køres igen.
-- ============================================================
-- Retter kan bruges til alle måltider, så kategori er ikke længere påkrævet (eksisterende værdier bevares)
alter table madretter alter column kategori drop not null;

-- Ufærdige retter gemmes som kladder. De vises kun i listen over madretter, ikke i ugeplanen
alter table madretter add column if not exists kladde boolean not null default false;

-- Producent/mærke, fx fra Open Food Facts
alter table ingredienser add column if not exists producent text;

-- Bed API'et om at opdage de nye kolonner med det samme
notify pgrst, 'reload schema';

-- ============================================================
-- Pris pr. ingrediens (tilføjet senere). Hele scriptet kan køres igen.
-- ============================================================
-- Hvad varen kostede, og hvor meget der var i pakken. Appen regner selv kr/100 g,
-- så prisen kan rettes uden at taste vægten igen. Begge felter udfyldes eller ingen af dem
alter table ingredienser add column if not exists pris numeric check (pris >= 0);
alter table ingredienser add column if not exists pris_maengde_g numeric check (pris_maengde_g > 0);
alter table ingredienser drop constraint if exists ingredienser_pris_og_maengde;
alter table ingredienser add constraint ingredienser_pris_og_maengde check ((pris is null) = (pris_maengde_g is null));

notify pgrst, 'reload schema';

-- ============================================================
-- Madretter som ingrediens (tilføjet senere). Hele scriptet kan køres igen.
-- ============================================================
-- En linje i en madret peger enten på en ingrediens eller på en anden madret (fx en stor portion
-- kødsovs, der bruges i flere retter). Mængden er gram af den færdige ret. Slettes den brugte ret,
-- forsvinder den også fra de retter, den indgår i – ligesom en slettet ingrediens
alter table madret_ingredienser add column if not exists under_madret_id uuid references madretter(id) on delete cascade;
alter table madret_ingredienser drop constraint if exists madret_ingredienser_ingrediens_eller_madret;
alter table madret_ingredienser add constraint madret_ingredienser_ingrediens_eller_madret
  check ((ingrediens_id is null) <> (under_madret_id is null) and under_madret_id is distinct from madret_id);

notify pgrst, 'reload schema';

-- ============================================================
-- Flere brugere (tilføjet senere). Hele scriptet kan køres igen.
-- ============================================================
-- Opret brugerne under Authentication -> Users, FØR scriptet køres (se README). Alt, der fandtes
-- før login (madretter, ugeplan og kaloriemål), tildeles den bruger, der blev oprettet først.
-- Ingredienser er fælles. Madretter kan ses af alle (så de kan importeres), men kun ændres af
-- ejeren. Ugeplan og kaloriemål er private.

-- Brugernes navne, så man kan se hinandens madretter. Navnet kan rettes i Table Editor
create table if not exists profiler (
  id uuid primary key references auth.users(id) on delete cascade,
  navn text not null
);
alter table profiler enable row level security;

-- Nye brugere får automatisk en profil med det, der står før @ i e-mailen
create or replace function public.opret_profil() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiler (id, navn) values (new.id, split_part(new.email, '@', 1))
    on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists opret_profil on auth.users;
create trigger opret_profil after insert on auth.users
  for each row execute function public.opret_profil();
insert into profiler (id, navn)
  select id, split_part(email, '@', 1) from auth.users
  on conflict (id) do nothing;

alter table madretter add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table ugeplan add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;

do $$
declare
  foerste uuid := (select id from auth.users order by created_at limit 1);
  gammel_indstilling boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'indstillinger' and column_name = 'id');
begin
  if foerste is null and (
    exists (select 1 from madretter where user_id is null)
    or exists (select 1 from ugeplan where user_id is null)
    or gammel_indstilling and exists (select 1 from indstillinger)
  ) then
    raise exception 'Opret først din bruger under Authentication -> Users og kør scriptet igen – de eksisterende data skal have en ejer';
  end if;

  update madretter set user_id = foerste where user_id is null;
  update ugeplan set user_id = foerste where user_id is null;

  -- Den fælles række (id = 1) bliver den første brugers kaloriemål
  if gammel_indstilling then
    alter table indstillinger add column if not exists user_id uuid references auth.users(id) on delete cascade;
    update indstillinger set user_id = foerste where id = 1;
    delete from indstillinger where user_id is null;
    alter table indstillinger drop column id; -- fjerner også den gamle primærnøgle
    alter table indstillinger add primary key (user_id);
    alter table indstillinger alter column user_id set default auth.uid();
  end if;
end $$;

alter table madretter alter column user_id set not null;
alter table ugeplan alter column user_id set not null;

-- Hver bruger har sin egen uge
alter table ugeplan drop constraint if exists ugeplan_dag_maaltid_key;
alter table ugeplan drop constraint if exists ugeplan_bruger_dag_maaltid;
alter table ugeplan add constraint ugeplan_bruger_dag_maaltid unique (user_id, dag, maaltid);

-- Er madretten den indloggede brugers egen? Bruges af reglerne herunder
create or replace function public.egen_madret(madret text) returns boolean
  language sql stable set search_path = '' as $$
  select exists (select 1 from public.madretter where id::text = madret and user_id = (select auth.uid()))
$$;

-- Den gamle, helt åbne adgang fjernes. Kun indloggede brugere har adgang til noget
drop policy if exists "allow all ingredienser" on ingredienser;
drop policy if exists "allow all madretter" on madretter;
drop policy if exists "allow all madret_ingredienser" on madret_ingredienser;
drop policy if exists "allow all ugeplan" on ugeplan;
drop policy if exists "allow all indstillinger" on indstillinger;
drop policy if exists "madret-billeder: læs" on storage.objects;
drop policy if exists "madret-billeder: upload" on storage.objects;

drop policy if exists "ingredienser: fælles" on ingredienser;
create policy "ingredienser: fælles" on ingredienser
  for all to authenticated using (true) with check (true);

drop policy if exists "madretter: læs" on madretter;
create policy "madretter: læs" on madretter
  for select to authenticated using (true);
drop policy if exists "madretter: opret" on madretter;
create policy "madretter: opret" on madretter
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "madretter: ret" on madretter;
create policy "madretter: ret" on madretter
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "madretter: slet" on madretter;
create policy "madretter: slet" on madretter
  for delete to authenticated using (user_id = (select auth.uid()));

-- En linje må kun pege på ens egne retter, så en importeret ret aldrig afhænger af en andens
drop policy if exists "madret_ingredienser: læs" on madret_ingredienser;
create policy "madret_ingredienser: læs" on madret_ingredienser
  for select to authenticated using (true);
drop policy if exists "madret_ingredienser: opret" on madret_ingredienser;
create policy "madret_ingredienser: opret" on madret_ingredienser
  for insert to authenticated
  with check (public.egen_madret(madret_id::text) and (under_madret_id is null or public.egen_madret(under_madret_id::text)));
drop policy if exists "madret_ingredienser: ret" on madret_ingredienser;
create policy "madret_ingredienser: ret" on madret_ingredienser
  for update to authenticated
  using (public.egen_madret(madret_id::text))
  with check (public.egen_madret(madret_id::text) and (under_madret_id is null or public.egen_madret(under_madret_id::text)));
drop policy if exists "madret_ingredienser: slet" on madret_ingredienser;
create policy "madret_ingredienser: slet" on madret_ingredienser
  for delete to authenticated using (public.egen_madret(madret_id::text));

drop policy if exists "ugeplan: egen" on ugeplan;
create policy "ugeplan: egen" on ugeplan
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (madret_id is null or public.egen_madret(madret_id::text)));

drop policy if exists "indstillinger: egen" on indstillinger;
create policy "indstillinger: egen" on indstillinger
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "profiler: læs" on profiler;
create policy "profiler: læs" on profiler
  for select to authenticated using (true);
drop policy if exists "profiler: ret eget navn" on profiler;
create policy "profiler: ret eget navn" on profiler
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Billeder ligger i en mappe pr. madret (<madret-id>/<tid>.jpg). Bucketten er offentlig, så alle med
-- en billed-URL kan se billedet; kun rettens ejer kan uploade. Slet må også den, der uploadede
-- filen, fordi retten kan være slettet, før billedet ryddes op
drop policy if exists "madret-billeder: se" on storage.objects;
create policy "madret-billeder: se" on storage.objects
  for select to authenticated using (bucket_id = 'madret-billeder');
drop policy if exists "madret-billeder: upload egen ret" on storage.objects;
create policy "madret-billeder: upload egen ret" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'madret-billeder' and public.egen_madret((storage.foldername(name))[1]));
drop policy if exists "madret-billeder: slet" on storage.objects;
create policy "madret-billeder: slet" on storage.objects
  for delete to authenticated
  using (bucket_id = 'madret-billeder'
    and (owner_id = (select auth.uid())::text or public.egen_madret((storage.foldername(name))[1])));

notify pgrst, 'reload schema';
