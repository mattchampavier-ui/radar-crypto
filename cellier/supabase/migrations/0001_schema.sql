-- Cellier — schéma de base (section 7 de SPEC.md)
-- Une seule personne utilise l'app : chaque ligne porte un owner, rempli automatiquement
-- par auth.uid() côté app, ou par le propriétaire enregistré côté tâche Claude.


-- Propriétaire unique de l'app (premier compte connecté). Sert de valeur par défaut
-- quand la tâche Claude écrit sans session utilisateur.
create table if not exists app_owner (
  singleton boolean primary key default true check (singleton),
  owner uuid not null
);

create or replace function app_owner_id() returns uuid
language sql stable security definer set search_path = public as $$
  select owner from app_owner limit 1
$$;

-- security definer : le rôle de la tâche Claude n'a pas accès au schéma auth.
create or replace function current_owner() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid(), app_owner_id())
$$;

-- Enregistre le premier compte comme propriétaire ; refuse les suivants.
create or replace function claim_app() returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select owner into v from app_owner;
  if v is null then
    insert into app_owner(owner) values (auth.uid());
    insert into settings(owner) values (auth.uid()) on conflict do nothing;
    return auth.uid();
  end if;
  if v <> auth.uid() then raise exception 'Cellier est déjà rattaché à un autre compte'; end if;
  return v;
end $$;

-- Paramètres (section 2). Une ligne par propriétaire.
create table if not exists settings (
  owner uuid primary key default current_owner(),
  budget_min numeric not null default 300,
  budget_max numeric not null default 1000,
  zone text[] not null default array['Lyon','69','Rhône','Auvergne-Rhône-Alpes','Bourgogne','21','71','Jura','39','Savoie','73','74','01','38','42','26','07'],
  horizon_days int not null default 31,
  default_fees_rate numeric not null default 0.25,      -- 25 % TTC, à vérifier
  monthly_consumption numeric not null default 6,
  color_targets jsonb not null default '{}'::jsonb,     -- {"rouge":0.6,"blanc":0.3,...} ; vide = composition actuelle
  weights jsonb not null default '{"discount":40,"gap":30,"affinity":20,"info":10}'::jsonb,
  thresholds jsonb not null default '{"target":70,"watch":45}'::jsonb,
  affinity_min_score numeric not null default 16,
  ai_run_hours int[] not null default array[12,20],
  ai_batch_size int not null default 20,
  photo_link_ttl_hours int not null default 72,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  updated_at timestamptz not null default now()
);

create table if not exists wines (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  producer text,
  cuvee text,
  appellation text,
  region text,
  country text,
  vintage int,
  color text check (color in ('rouge','blanc','rose','effervescent','liquoreux')),
  grapes text[] not null default '{}',
  bottle_size_cl int not null default 75,
  classification text,
  drink_from int,
  drink_peak int,
  drink_until int,
  serving_temp_c numeric,
  decant_min int,
  pairings text[] not null default '{}',
  confidence jsonb not null default '{}'::jsonb,    -- {"producer":0.9,"vintage":0.4,...} 0..1
  sources jsonb not null default '[]'::jsonb,       -- [{"url":...,"checked_at":...,"about":"garde"}]
  notes text,
  merge_candidate_id uuid references wines(id) on delete set null,
  status text not null default 'en_attente' check (status in ('en_attente','enrichi','a_verifier')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wines_owner_idx on wines(owner);

create table if not exists market_prices (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  wine_id uuid not null references wines(id) on delete cascade,
  low_eur numeric,
  high_eur numeric,
  confidence numeric check (confidence between 0 and 1),
  sources jsonb not null default '[]'::jsonb,       -- [{"url":...,"checked_at":"2026-10-27","label":"iDealwine"}]
  checked_at timestamptz not null default now()
);
create index if not exists market_prices_wine_idx on market_prices(wine_id, checked_at desc);

create table if not exists cabinet_shelves (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  shelf_number int not null,
  label text,
  capacity int,
  unique (owner, shelf_number)
);

create table if not exists stock_lots (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  wine_id uuid not null references wines(id) on delete cascade,
  shelf_id uuid references cabinet_shelves(id) on delete set null,
  quantity int not null default 1 check (quantity >= 0),
  label_photo_paths text[] not null default '{}',
  thumb_path text,
  fill_level text check (fill_level in ('goulot','haut_epaule','mi_epaule','bas_epaule')),
  label_condition text,
  capsule_cork_condition text,
  provenance text,
  added_at timestamptz not null default now()
);
create index if not exists stock_lots_wine_idx on stock_lots(wine_id);

create table if not exists hunt_lots (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  source text not null default 'lien' check (source in ('lien','interencheres','leboncoin')),
  url text,
  sale_house text,
  sale_date date,
  pickup_date date,
  location text,
  lot_number text,
  title text,
  description text,
  photos text[] not null default '{}',
  provenance text,
  estimate_low_eur numeric,
  estimate_high_eur numeric,
  fees_rate numeric,                 -- null = taux par défaut des réglages
  max_bid_eur numeric,               -- calculé : enchère max conseillée (hors frais)
  max_total_eur numeric,             -- calculé : prix max conseillé frais compris
  score numeric,
  score_detail jsonb not null default '{}'::jsonb,
  verdict text check (verdict in ('a_viser','a_surveiller','a_ignorer')),
  reason text,
  gap_filled text,
  hammer_price_eur numeric,
  status text not null default 'nouveau' check (status in ('nouveau','suivi','achete','ignore')),
  created_at timestamptz not null default now(),
  dedup_key text   -- même vente + même numéro de lot, ou même annonce (rempli par trigger)
);
create unique index if not exists hunt_lots_dedup on hunt_lots(owner, dedup_key);

create table if not exists hunt_lot_wines (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  hunt_lot_id uuid not null references hunt_lots(id) on delete cascade,
  producer text,
  cuvee text,
  appellation text,
  region text,
  vintage int,
  color text check (color in ('rouge','blanc','rose','effervescent','liquoreux')),
  bottle_size_cl int not null default 75,
  quantity int not null default 1,
  fill_level text check (fill_level in ('goulot','haut_epaule','mi_epaule','bas_epaule')),
  condition_notes text,
  cork_rising boolean not null default false,
  drink_from int,
  drink_until int,
  market_low_eur numeric,            -- prix unitaire
  market_high_eur numeric,
  market_confidence numeric check (market_confidence between 0 and 1),
  market_sources jsonb not null default '[]'::jsonb,
  wine_id uuid references wines(id) on delete set null
);
create index if not exists hunt_lot_wines_lot_idx on hunt_lot_wines(hunt_lot_id);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  wine_id uuid not null references wines(id) on delete cascade,
  stock_lot_id uuid references stock_lots(id) on delete set null,
  date date not null default current_date,
  quantity int not null default 1,
  unit_price_eur numeric,
  fees_eur numeric not null default 0,
  source text check (source in ('vente','caviste','cadeau','leboncoin','autre')),
  hunt_lot_id uuid references hunt_lots(id) on delete set null
);

create table if not exists movements (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  stock_lot_id uuid not null references stock_lots(id) on delete cascade,
  type text not null check (type in ('entree','sortie','deplacement')),
  quantity int not null default 1,
  date timestamptz not null default now(),
  reason text
);

create table if not exists tastings (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  wine_id uuid references wines(id) on delete set null,
  movement_id uuid references movements(id) on delete set null,
  date date not null default current_date,
  score_20 numeric check (score_20 between 0 and 20),
  notes text,
  occasion text,
  dish_type text
);

create table if not exists inbound_emails (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  received_at timestamptz not null default now(),
  sender text,
  subject text,
  body text,
  processed boolean not null default false
);

create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  type text not null check (type in ('label','enrich','lot_url','revalue','feasibility')),
  ref_id uuid,
  payload jsonb not null default '{}'::jsonb,   -- label : {"photo_urls":[...],"expires_at":...} ; lot_url : {"url":...}
  status text not null default 'en_attente' check (status in ('en_attente','en_cours','fait','erreur')),
  message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz
);
create index if not exists ai_jobs_pending_idx on ai_jobs(status, created_at);

create table if not exists cellar_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  date date not null default current_date,
  bottles int not null,
  value_low_eur numeric,
  value_high_eur numeric,
  purchase_value_eur numeric,
  unique (owner, date)
);

-- Ligne de test pour l'essai de faisabilité du Lot 0.
create table if not exists feasibility_checks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default current_owner(),
  created_at timestamptz not null default now(),
  written_by text not null,
  note text
);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists wines_touch on wines;
create trigger wines_touch before update on wines for each row execute function touch_updated_at();
drop trigger if exists settings_touch on settings;
create trigger settings_touch before update on settings for each row execute function touch_updated_at();

create or replace function hunt_lot_dedup() returns trigger language plpgsql as $$
begin
  new.dedup_key := coalesce(
    nullif(lower(trim(new.sale_house)),'') || '#' || coalesce(to_char(new.sale_date,'YYYY-MM-DD'),'') || '#' || nullif(trim(new.lot_number),''),
    nullif(trim(new.url),''),
    new.id::text);
  return new;
end $$;
drop trigger if exists hunt_lots_dedup_trg on hunt_lots;
create trigger hunt_lots_dedup_trg before insert or update of sale_house, sale_date, lot_number, url
  on hunt_lots for each row execute function hunt_lot_dedup();
