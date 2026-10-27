// Vérifie les migrations et les fonctions métier sur un Postgres embarqué (PGlite),
// avec des bouchons minimaux pour les schémas auth et storage de Supabase.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
const OWNER = '11111111-1111-1111-1111-111111111111'

await db.exec(`
  create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;
  -- Comme sur Supabase : les droits de table viennent des privilèges par défaut, l'accès réel des règles RLS.
  alter default privileges in schema public grant all on tables to authenticated;
`)

const dir = new URL('../supabase/migrations/', import.meta.url)
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(new URL(f, dir), 'utf8'))
  } catch (e) {
    console.error(`✗ ${f} : ${e.message}`, e.where ?? '')
    process.exit(1)
  }
  console.log('✓ migration', f)
}

const q = async (sql, params) => {
  try {
    return (await db.query(sql, params)).rows
  } catch (e) {
    const err = new Error(`${e.message} ${e.where ?? ''}`)
    throw err
  }
}
const one = async (sql, params) => (await q(sql, params))[0]
const asUser = () => db.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false)`)
const asAgent = () => db.exec(`select set_config('request.jwt.claim.sub', '', false)`)

await asUser()
assert.equal((await one('select claim_app() as o')).o, OWNER)
const y = new Date().getFullYear()

// Cave : 12 bouteilles en fenêtre cette année seulement → les années suivantes sont en manque.
const shelf = (await one(`insert into cabinet_shelves(shelf_number, label, capacity) values (1,'Haut',20) returning id`)).id
const w1 = (await one(`insert into wines(producer, appellation, region, vintage, color, drink_from, drink_until, status, pairings)
  values ('Domaine Jamet','Côte-Rôtie','Rhône',2015,'rouge',${y - 2},${y},'enrichi','{viande_rouge}') returning id`)).id
const lot1 = (await one(`insert into stock_lots(wine_id, shelf_id, quantity) values ($1,$2,12) returning id`, [w1, shelf])).id
await q(`insert into purchases(wine_id, stock_lot_id, quantity, unit_price_eur, source) values ($1,$2,12,40,'caviste')`, [w1, lot1])
await q(`insert into market_prices(wine_id, low_eur, high_eur, confidence) values ($1, 60, 80, 0.8)`, [w1])
await q(`insert into tastings(wine_id, score_20) values ($1, 17)`, [w1])

const gap = await q('select * from cellar_gap()')
assert.equal(gap.length, 10)
assert.equal(gap[0].bottles, 12)
assert.equal(gap[0].deficit, 60)
assert.equal(gap[1].bottles, 0)
console.log('✓ cellar_gap')

// Lot intéressant : dans la zone, vente proche, décote, affinité producteur, comble des années en manque.
const saleSoon = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)
await asAgent()
await db.exec('set role cellier_agent')
const good = (await one(`insert into hunt_lots(url, sale_house, sale_date, lot_number, location, estimate_low_eur, estimate_high_eur,
  photos, description) values ('https://ex/1','De Baecque','${saleSoon}','12','Lyon (69)',300,400,'{https://ex/p.jpg}',
  'Belle provenance, cave enterrée') returning id`)).id
await q(`insert into hunt_lot_wines(hunt_lot_id, producer, appellation, region, vintage, color, quantity, fill_level,
  drink_from, drink_until, market_low_eur, market_high_eur, market_confidence)
  values ($1,'Domaine Jamet','Côte-Rôtie','Rhône',2017,'rouge',6,'goulot',${y + 1},${y + 8},90,120,0.9)`, [good])
let g = await one('select * from hunt_lots where id = $1', [good])
console.log('  lot bon :', g.score, g.verdict, '|', g.reason, g.score_detail)
assert.equal(g.verdict, 'a_viser')
assert.ok(g.max_bid_eur > 0 && g.max_total_eur <= 1000)

// Doublon : même vente + même numéro de lot.
await assert.rejects(q(`insert into hunt_lots(url, sale_house, sale_date, lot_number) values ('https://ex/autre','de baecque','${saleSoon}','12')`))
console.log('✓ dédoublonnage')

// Lot hors zone → ignoré.
const far = (await one(`insert into hunt_lots(url, sale_date, location, estimate_low_eur) values ('https://ex/2','${saleSoon}','Bordeaux (33)',200) returning id`)).id
await q(`insert into hunt_lot_wines(hunt_lot_id, producer, vintage, quantity, drink_from, drink_until, market_low_eur, market_high_eur, market_confidence)
  values ($1,'X',2018,6,${y},${y + 5},60,80,0.7)`, [far])
g = await one('select * from hunt_lots where id = $1', [far])
assert.equal(g.verdict, 'a_ignorer'); assert.match(g.reason, /hors zone/)

// Lot trop cher → ignoré.
const dear = (await one(`insert into hunt_lots(url, sale_date, location, estimate_low_eur) values ('https://ex/3','${saleSoon}','Villeurbanne (69)',2000) returning id`)).id
await q(`insert into hunt_lot_wines(hunt_lot_id, producer, vintage, quantity, drink_from, drink_until) values ($1,'Y',2016,12,${y},${y + 5})`, [dear])
g = await one('select * from hunt_lots where id = $1', [dear])
assert.equal(g.verdict, 'a_ignorer'); assert.match(g.reason, /budget/)

// État rédhibitoire → ignoré.
const bad = (await one(`insert into hunt_lots(url, sale_date, location, estimate_low_eur) values ('https://ex/4','${saleSoon}','Beaune (21)',100) returning id`)).id
await q(`insert into hunt_lot_wines(hunt_lot_id, producer, vintage, quantity, fill_level, drink_from, drink_until) values ($1,'Z',2000,6,'bas_epaule',${y},${y + 3})`, [bad])
g = await one('select * from hunt_lots where id = $1', [bad])
assert.equal(g.verdict, 'a_ignorer'); assert.match(g.reason, /rédhibitoire/)
console.log('✓ filtres éliminatoires')

// L'agent ne peut pas supprimer, ni modifier la quantité en cave.
await assert.rejects(q('delete from wines where id = $1', [w1]))
await assert.rejects(q('update stock_lots set quantity = 0 where id = $1', [lot1]))
await q(`update stock_lots set fill_level = 'haut_epaule' where id = $1`, [lot1])
const jobs = await q(`insert into ai_jobs(type, payload) values ('lot_url','{"url":"https://ex"}') returning owner`)
assert.equal(jobs[0].owner, OWNER)
const claimed = await q('select * from claim_ai_jobs(20)')
assert.equal(claimed.length, 1); assert.equal(claimed[0].status, 'en_cours')
await q('select take_cellar_snapshot()')
console.log('✓ rôle cellier_agent')
await db.exec('reset role')

// Utilisateur : sortie, conversion de lot, fusion.
await asUser()
await db.exec('set role authenticated')
const mv = (await one('select take_bottle($1, 2) as m', [lot1])).m
assert.ok(mv)
assert.equal((await one('select quantity from stock_lots where id = $1', [lot1])).quantity, 10)
await assert.rejects(q('select take_bottle($1, 50)', [lot1]))
const n = (await one('select convert_hunt_lot($1, 320, $2) as n', [good, shelf])).n
assert.equal(n, 6)
const conv = await q(`select sl.quantity, sl.fill_level, w.producer, pu.unit_price_eur, pu.fees_eur from stock_lots sl
  join wines w on w.id = sl.wine_id join purchases pu on pu.stock_lot_id = sl.id where pu.hunt_lot_id = $1`, [good])
assert.equal(conv.length, 1); assert.equal(Number(conv[0].unit_price_eur), 53.33); assert.equal(conv[0].fill_level, 'goulot')
const pending = (await one(`insert into wines(status) values ('en_attente') returning id`)).id
const pl = (await one(`insert into stock_lots(wine_id, quantity) values ($1, 2) returning id`, [pending])).id
await q('select merge_wine($1, $2)', [pending, w1])
assert.equal((await one('select wine_id from stock_lots where id = $1', [pl])).wine_id, w1)
const snap = await one('select * from take_cellar_snapshot()')
console.log('  snapshot :', snap)
assert.equal(snap.bottles, 18)
assert.equal((await one('select rescore_hunt_lots() as c')).c >= 3, true)
assert.equal((await one('select ensure_monthly_revalue() as r')).r, true)
assert.equal((await one('select ensure_monthly_revalue() as r')).r, false)
console.log('✓ fonctions utilisateur')

// RLS : un autre compte ne voit rien.
await db.exec(`select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false)`)
assert.equal((await q('select * from wines')).length, 0)
await assert.rejects(q('select claim_app()'))
console.log('✓ règles d\'accès par ligne')
console.log('\nTous les tests SQL passent.')
