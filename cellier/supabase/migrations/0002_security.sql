-- Règles d'accès par ligne (section 9.2) et rôle dédié à la tâche Claude.

do $$
declare t text;
begin
  foreach t in array array['settings','wines','market_prices','cabinet_shelves','stock_lots','hunt_lots',
    'hunt_lot_wines','purchases','movements','tastings','inbound_emails','ai_jobs','cellar_snapshots',
    'feasibility_checks','app_owner']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists owner_all on %I', t);
    execute format('create policy owner_all on %I for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;

-- Rôle de la tâche Claude. Le connecteur Supabase exécute du SQL ; chaque requête de la tâche
-- commence par « set role cellier_agent; » pour rester dans ce périmètre.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'cellier_agent') then
    create role cellier_agent nologin;
  end if;
  -- Le connecteur se connecte en « postgres » : il doit pouvoir endosser le rôle.
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    grant cellier_agent to postgres;
  end if;
end $$;

grant usage on schema public to cellier_agent;
-- Lecture seule
grant select on settings, cabinet_shelves, purchases, movements, tastings, app_owner to cellier_agent;
-- Lecture + écriture (jamais de suppression)
grant select, insert, update on wines, market_prices, stock_lots, hunt_lots, hunt_lot_wines,
  ai_jobs, cellar_snapshots, inbound_emails, feasibility_checks to cellier_agent;

do $$
declare t text;
begin
  foreach t in array array['settings','cabinet_shelves','purchases','movements','tastings','app_owner',
    'wines','market_prices','stock_lots','hunt_lots','hunt_lot_wines','ai_jobs','cellar_snapshots',
    'inbound_emails','feasibility_checks']
  loop
    execute format('drop policy if exists agent_all on %I', t);
    execute format('create policy agent_all on %I for all to cellier_agent using (true) with check (owner = app_owner_id())', t);
  end loop;
end $$;

-- L'agent ne doit pas toucher à la saisie de l'utilisateur sur stock_lots (quantité, clayette) :
-- seules les colonnes d'état déclaré peuvent être complétées.
revoke update on stock_lots from cellier_agent;
grant update (fill_level, label_condition, capsule_cork_condition, provenance) on stock_lots to cellier_agent;
