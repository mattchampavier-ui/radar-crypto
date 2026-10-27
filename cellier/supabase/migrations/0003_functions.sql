-- Fonctions métier : manque, score du chasseur (section 6), mouvements de cave, valeur.

-- Dernier prix de marché connu par vin.
create or replace view wine_latest_price with (security_invoker = true) as
select distinct on (wine_id) wine_id, owner, low_eur, high_eur, confidence, sources, checked_at
from market_prices order by wine_id, checked_at desc;

-- Bouteilles en fenêtre pour chacune des dix années à venir, comparées au rythme de consommation.
create or replace function cellar_gap(p_owner uuid default current_owner())
returns table(yr int, bottles int, target int, deficit int)
language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce((select monthly_consumption from settings where owner = p_owner), 6) * 12 as t
  ), yrs as (
    select generate_series(extract(year from current_date)::int, extract(year from current_date)::int + 9) as yr
  )
  select y.yr,
         coalesce(sum(sl.quantity) filter (where w.drink_from <= y.yr and w.drink_until >= y.yr), 0)::int,
         (select t from s)::int,
         greatest((select t from s) - coalesce(sum(sl.quantity) filter (where w.drink_from <= y.yr and w.drink_until >= y.yr), 0), 0)::int
  from yrs y
  left join stock_lots sl on sl.owner = p_owner and sl.quantity > 0
  left join wines w on w.id = sl.wine_id
  group by y.yr order by y.yr
$$;

-- Score et verdict d'un lot (section 6.3). Déterministe : ne dépend que des données en base
-- et de la date du jour.
create or replace function score_hunt_lot(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l hunt_lots%rowtype;
  s settings%rowtype;
  y int := extract(year from current_date)::int;
  fees numeric;
  w_disc numeric; w_gap numeric; w_aff numeric; w_info numeric; full_at numeric;
  t_target numeric; t_watch numeric;
  n int; priced int; mkt_low numeric; mkt_high numeric; conf numeric;
  cost numeric; mid numeric; d numeric;
  bad_window int; bad_cond int;
  elim text[] := '{}';
  p_disc numeric := 0; p_gap numeric := 0; p_aff numeric := 0; p_info numeric := 0;
  filled numeric; possible numeric; gap_years text;
  lot_color text; share_now numeric; share_target numeric; color_factor numeric := 1;
  fill_known numeric;
  total numeric; v text; why text[] := '{}';
  max_total numeric;
begin
  select * into l from hunt_lots where id = p_id;
  if not found then return; end if;
  if auth.uid() is not null and l.owner <> auth.uid() then raise exception 'Accès refusé'; end if;

  insert into settings(owner) values (l.owner) on conflict do nothing;
  select * into s from settings where owner = l.owner;

  fees := coalesce(l.fees_rate, s.default_fees_rate, 0);
  w_disc := coalesce((s.weights->>'discount')::numeric, 40);
  w_gap  := coalesce((s.weights->>'gap')::numeric, 30);
  w_aff  := coalesce((s.weights->>'affinity')::numeric, 20);
  w_info := coalesce((s.weights->>'info')::numeric, 10);
  full_at := coalesce((s.weights->>'discount_full_at')::numeric, 0.35);
  t_target := coalesce((s.thresholds->>'target')::numeric, 70);
  t_watch  := coalesce((s.thresholds->>'watch')::numeric, 45);

  select coalesce(sum(quantity),0),
         coalesce(sum(quantity) filter (where market_low_eur is not null),0),
         sum(market_low_eur * quantity), sum(coalesce(market_high_eur, market_low_eur) * quantity),
         sum(coalesce(market_confidence,0.3) * quantity) filter (where market_low_eur is not null)
           / nullif(sum(quantity) filter (where market_low_eur is not null),0),
         coalesce(sum(quantity) filter (where drink_until < y or drink_from > y + 10),0),
         coalesce(sum(quantity) filter (where fill_level = 'bas_epaule' or cork_rising),0),
         coalesce(sum(quantity) filter (where fill_level is not null),0)::numeric / nullif(sum(quantity),0)
    into n, priced, mkt_low, mkt_high, conf, bad_window, bad_cond, fill_known
  from hunt_lot_wines where hunt_lot_id = p_id;

  if n = 0 then
    update hunt_lots set score = null, verdict = null, reason = 'Vins du lot pas encore extraits',
      score_detail = '{}'::jsonb, max_bid_eur = null, max_total_eur = null, gap_filled = null where id = p_id;
    return;
  end if;
  conf := coalesce(conf, 0) * priced::numeric / n;   -- couverture partielle = confiance réduite

  cost := l.estimate_low_eur * (1 + fees);

  -- Filtres éliminatoires
  if cost is not null and cost > s.budget_max then
    elim := elim || format('Coût probable %s € frais compris, au-dessus du budget de %s €', round(cost), round(s.budget_max));
  end if;
  if l.location is not null and not exists (
    select 1 from unnest(s.zone) z where l.location ~* ('\m' || regexp_replace(z, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M')
  ) then
    elim := elim || format('Retrait à %s, hors zone', l.location);
  end if;
  if l.sale_date is not null and l.sale_date > current_date + s.horizon_days then
    elim := elim || format('Vente le %s, au-delà de l''horizon de %s jours', to_char(l.sale_date,'DD/MM/YYYY'), s.horizon_days);
  end if;
  if bad_window * 2 > n then
    elim := array_append(elim, 'Vins passés ou pas buvables avant 10 ans'::text);
  end if;
  if bad_cond * 2 > n then
    elim := array_append(elim, 'État rédhibitoire (bas d''épaule ou bouchon qui remonte)'::text);
  end if;

  -- Décote (40)
  if cost is not null and mkt_low is not null then
    mid := (mkt_low + mkt_high) / 2;
    d := 1 - cost / nullif(mid, 0);
    p_disc := w_disc * least(greatest(coalesce(d,0), 0) / full_at, 1) * (0.5 + 0.5 * conf);
    why := why || format('Coût probable %s € pour un marché de %s–%s € (%s %%)', round(cost), round(mkt_low), round(mkt_high),
      case when d >= 0 then '-' else '+' end || abs(round(d * 100)));
  elsif mkt_low is null then
    why := array_append(why, 'Prix de marché pas encore trouvé'::text);
  else
    why := array_append(why, 'Pas d''estimation de la maison'::text);
  end if;

  -- Manque comblé (30)
  with g as (select * from cellar_gap(l.owner)),
  lw as (
    select g.yr, g.deficit,
      coalesce(sum(h.quantity) filter (where h.drink_from <= g.yr and h.drink_until >= g.yr), 0) as lot_b
    from g left join hunt_lot_wines h on h.hunt_lot_id = p_id
    group by g.yr, g.deficit
  )
  select sum(least(lot_b, deficit)), sum(lot_b),
         string_agg(yr::text, ', ' order by yr) filter (where deficit > 0 and lot_b > 0)
    into filled, possible, gap_years
  from lw;

  select color into lot_color from hunt_lot_wines where hunt_lot_id = p_id and color is not null
    group by color order by sum(quantity) desc limit 1;
  if lot_color is not null then
    select coalesce(sum(sl.quantity) filter (where w.color = lot_color),0)::numeric / nullif(sum(sl.quantity),0)
      into share_now
    from stock_lots sl join wines w on w.id = sl.wine_id where sl.owner = l.owner and sl.quantity > 0;
    share_target := (s.color_targets->>lot_color)::numeric;
    if share_target is not null and share_now is not null and share_now > share_target + 0.02 then
      color_factor := 0.6;
    end if;
  end if;
  if coalesce(possible,0) > 0 then
    p_gap := w_gap * filled / possible * color_factor;
  end if;

  -- Affinité (20) : producteur 1, appellation 0,6, région + couleur 0,3
  with liked as (
    select distinct lower(w.producer) producer, lower(w.appellation) appellation, lower(w.region) region, w.color
    from tastings t join wines w on w.id = t.wine_id
    where t.owner = l.owner and t.score_20 >= s.affinity_min_score
  ), m as (
    select h.quantity, greatest(
      coalesce((select max(1) from liked where liked.producer = lower(h.producer)), 0),
      coalesce((select max(0.6) from liked where liked.appellation = lower(h.appellation)), 0),
      coalesce((select max(0.3) from liked where liked.region = lower(h.region) and liked.color = h.color), 0)) as a
    from hunt_lot_wines h where h.hunt_lot_id = p_id
  )
  select w_aff * coalesce(sum(a * quantity) / nullif(sum(quantity),0), 0) into p_aff from m;

  -- Qualité de l'information (10)
  p_info := w_info * (
      case when cardinality(l.photos) > 0 then 0.3 else 0 end
    + case when l.provenance is not null or l.description ~* '(provenance|conserv|cave)' then 0.3 else 0 end
    + 0.4 * coalesce(fill_known, 0));

  total := round(p_disc + p_gap + p_aff + p_info);

  if mkt_low is not null then
    max_total := least(mkt_low, s.budget_max);
  end if;

  if cardinality(elim) > 0 then
    v := 'a_ignorer';
  elsif total > t_target then v := 'a_viser';
  elsif total >= t_watch then v := 'a_surveiller';
  else v := 'a_ignorer';
  end if;

  if gap_years is not null then
    why := why || format('Comble des années en manque : %s', gap_years);
  end if;
  if p_aff > 0 then why := array_append(why, format('Proche de vins que tu as notés %s+', s.affinity_min_score)); end if;

  update hunt_lots set
    score = total,
    verdict = v,
    reason = array_to_string(case when cardinality(elim) > 0 then elim else why end, ' · '),
    gap_filled = gap_years,
    max_total_eur = round(max_total),
    max_bid_eur = round(max_total / (1 + fees)),
    score_detail = jsonb_build_object(
      'discount', round(p_disc,1), 'gap', round(p_gap,1), 'affinity', round(p_aff,1), 'info', round(p_info,1),
      'eliminated', to_jsonb(elim), 'fees_rate', fees, 'cost', round(cost), 'market_low', round(mkt_low),
      'market_high', round(mkt_high), 'confidence', round(conf,2), 'bottles', n)
  where id = p_id;
end $$;

create or replace function trg_score_from_wines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform score_hunt_lot(coalesce(new.hunt_lot_id, old.hunt_lot_id));
  return null;
end $$;
drop trigger if exists hunt_lot_wines_score on hunt_lot_wines;
create trigger hunt_lot_wines_score after insert or update or delete on hunt_lot_wines
  for each row execute function trg_score_from_wines();

create or replace function trg_score_from_lot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform score_hunt_lot(new.id);
  return null;
end $$;
drop trigger if exists hunt_lots_score on hunt_lots;
create trigger hunt_lots_score after insert or update of estimate_low_eur, estimate_high_eur, fees_rate,
  sale_date, location, photos, description, provenance on hunt_lots
  for each row execute function trg_score_from_lot();

-- Recalcul de tous les lots non clos (après un changement de réglages ou de cave).
create or replace function rescore_hunt_lots() returns int
language plpgsql security definer set search_path = public as $$
declare r record; c int := 0;
begin
  for r in select id from hunt_lots where owner = current_owner() and status in ('nouveau','suivi') loop
    perform score_hunt_lot(r.id); c := c + 1;
  end loop;
  return c;
end $$;

-- Sortir des bouteilles : décrémente le lot et trace le mouvement. Renvoie l'id du mouvement.
create or replace function take_bottle(p_stock_lot uuid, p_qty int default 1, p_reason text default 'dégustation')
returns uuid language plpgsql as $$
declare m uuid; q int;
begin
  select quantity into q from stock_lots where id = p_stock_lot for update;
  if q is null then raise exception 'Bouteille introuvable'; end if;
  if q < p_qty then raise exception 'Il ne reste que % bouteille(s)', q; end if;
  update stock_lots set quantity = quantity - p_qty where id = p_stock_lot;
  insert into movements(stock_lot_id, type, quantity, reason) values (p_stock_lot, 'sortie', p_qty, p_reason) returning id into m;
  return m;
end $$;

-- Déplacer des bouteilles vers une autre clayette.
create or replace function move_bottles(p_stock_lot uuid, p_shelf uuid, p_qty int) returns uuid
language plpgsql as $$
declare src stock_lots%rowtype; dst uuid;
begin
  select * into src from stock_lots where id = p_stock_lot for update;
  if src.id is null then raise exception 'Bouteille introuvable'; end if;
  if p_qty >= src.quantity then
    update stock_lots set shelf_id = p_shelf where id = p_stock_lot;
    dst := p_stock_lot;
  else
    update stock_lots set quantity = quantity - p_qty where id = p_stock_lot;
    insert into stock_lots(wine_id, shelf_id, quantity, label_photo_paths, thumb_path, fill_level, label_condition,
      capsule_cork_condition, provenance, added_at)
    values (src.wine_id, p_shelf, p_qty, src.label_photo_paths, src.thumb_path, src.fill_level, src.label_condition,
      src.capsule_cork_condition, src.provenance, src.added_at)
    returning id into dst;
  end if;
  insert into movements(stock_lot_id, type, quantity, reason) values (dst, 'deplacement', p_qty, 'changement de clayette');
  return dst;
end $$;

-- Fusion d'une fiche en attente avec un vin déjà en cave (proposée par la tâche Claude).
create or replace function merge_wine(p_from uuid, p_into uuid) returns void
language plpgsql as $$
begin
  if p_from = p_into then return; end if;
  update stock_lots set wine_id = p_into where wine_id = p_from;
  update purchases set wine_id = p_into where wine_id = p_from;
  update tastings set wine_id = p_into where wine_id = p_from;
  update hunt_lot_wines set wine_id = p_into where wine_id = p_from;
  update ai_jobs set status = 'fait', message = 'Fiche fusionnée', done_at = now()
    where ref_id = p_from and status in ('en_attente','en_cours');
  delete from wines where id = p_from;
end $$;

-- Lot de chasse acheté → bouteilles en cave, avec prix payé (frais inclus) et état déclaré.
create or replace function convert_hunt_lot(p_lot uuid, p_hammer numeric, p_shelf uuid) returns int
language plpgsql as $$
declare
  l hunt_lots%rowtype; h record; wid uuid; sid uuid; fees numeric; n int; unit numeric; c int := 0;
begin
  select * into l from hunt_lots where id = p_lot for update;
  if l.id is null then raise exception 'Lot introuvable'; end if;
  if l.status = 'achete' then raise exception 'Lot déjà transformé en bouteilles'; end if;
  fees := coalesce(l.fees_rate, (select default_fees_rate from settings where owner = l.owner), 0);
  select sum(quantity) into n from hunt_lot_wines where hunt_lot_id = p_lot;
  if coalesce(n,0) = 0 then raise exception 'Le lot ne contient aucun vin'; end if;
  unit := p_hammer / n;   -- prix d'adjudication réparti à la bouteille

  for h in select * from hunt_lot_wines where hunt_lot_id = p_lot loop
    wid := h.wine_id;
    if wid is null then
      select id into wid from wines
       where owner = l.owner and lower(coalesce(producer,'')) = lower(coalesce(h.producer,''))
         and lower(coalesce(appellation,'')) = lower(coalesce(h.appellation,''))
         and coalesce(cuvee,'') = coalesce(h.cuvee,'')
         and vintage is not distinct from h.vintage and bottle_size_cl = h.bottle_size_cl
       limit 1;
    end if;
    if wid is null then
      insert into wines(owner, producer, cuvee, appellation, region, vintage, color, bottle_size_cl, drink_from, drink_until, status)
      values (l.owner, h.producer, h.cuvee, h.appellation, h.region, h.vintage, h.color, h.bottle_size_cl, h.drink_from, h.drink_until, 'en_attente')
      returning id into wid;
      if h.market_low_eur is not null then
        insert into market_prices(owner, wine_id, low_eur, high_eur, confidence, sources)
        values (l.owner, wid, h.market_low_eur, h.market_high_eur, h.market_confidence, h.market_sources);
      end if;
      insert into ai_jobs(owner, type, ref_id) values (l.owner, 'enrich', wid);
    end if;
    insert into stock_lots(owner, wine_id, shelf_id, quantity, fill_level, label_condition, provenance)
    values (l.owner, wid, p_shelf, h.quantity, h.fill_level, h.condition_notes,
            coalesce(l.provenance, l.sale_house) || coalesce(' — lot ' || l.lot_number, ''))
    returning id into sid;
    insert into movements(owner, stock_lot_id, type, quantity, reason) values (l.owner, sid, 'entree', h.quantity, 'achat aux enchères');
    insert into purchases(owner, wine_id, stock_lot_id, date, quantity, unit_price_eur, fees_eur, source, hunt_lot_id)
    values (l.owner, wid, sid, coalesce(l.sale_date, current_date), h.quantity, round(unit, 2), round(unit * fees * h.quantity, 2),
            case when l.source = 'leboncoin' then 'leboncoin' else 'vente' end, p_lot);
    update hunt_lot_wines set wine_id = wid where id = h.id;
    c := c + h.quantity;
  end loop;

  update hunt_lots set status = 'achete', hammer_price_eur = p_hammer where id = p_lot;
  return c;
end $$;

-- Photo instantanée de la valeur de la cave (appelée par la tâche après « revalue »).
create or replace function take_cellar_snapshot() returns cellar_snapshots
language plpgsql security definer set search_path = public as $$
declare r cellar_snapshots; o uuid := current_owner();
begin
  insert into cellar_snapshots(owner, date, bottles, value_low_eur, value_high_eur, purchase_value_eur)
  select o, current_date,
    coalesce(sum(sl.quantity),0),
    round(sum(sl.quantity * p.low_eur)),
    round(sum(sl.quantity * coalesce(p.high_eur, p.low_eur))),
    round(sum(sl.quantity * pu.unit_cost))
  from stock_lots sl
  left join wine_latest_price p on p.wine_id = sl.wine_id
  left join lateral (
    select sum((coalesce(unit_price_eur,0) * quantity + fees_eur)) / nullif(sum(quantity),0) as unit_cost
    from purchases where wine_id = sl.wine_id
  ) pu on true
  where sl.owner = o and sl.quantity > 0
  on conflict (owner, date) do update set bottles = excluded.bottles, value_low_eur = excluded.value_low_eur,
    value_high_eur = excluded.value_high_eur, purchase_value_eur = excluded.purchase_value_eur
  returning * into r;
  return r;
end $$;

-- Crée la demande « revalue » du mois si elle n'existe pas encore. Appelée par l'app à l'ouverture.
create or replace function ensure_monthly_revalue() returns boolean
language plpgsql as $$
begin
  if exists (select 1 from ai_jobs where owner = current_owner() and type = 'revalue'
             and created_at >= date_trunc('month', now())) then
    return false;
  end if;
  if not exists (select 1 from stock_lots where owner = current_owner() and quantity > 0) then
    return false;
  end if;
  insert into ai_jobs(type) values ('revalue');
  return true;
end $$;

-- Réservation des demandes par la tâche Claude : au plus p_limit, les plus anciennes d'abord.
create or replace function claim_ai_jobs(p_limit int default 20) returns setof ai_jobs
language sql as $$
  update ai_jobs set status = 'en_cours', started_at = now()
  where id in (select id from ai_jobs where status = 'en_attente' order by created_at limit p_limit for update skip locked)
  returning *
$$;

-- Les demandes restées « en cours » plus de 6 h (passage interrompu) repartent en attente.
create or replace function release_stale_ai_jobs() returns int
language sql as $$
  with u as (update ai_jobs set status = 'en_attente', message = 'Reprise après interruption'
             where status = 'en_cours' and started_at < now() - interval '6 hours' returning 1)
  select count(*)::int from u
$$;

grant execute on all functions in schema public to authenticated, cellier_agent;
grant select on wine_latest_price to authenticated, cellier_agent;
