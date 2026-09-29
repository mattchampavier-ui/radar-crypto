"""Scoring sur un historique synthétique : un narratif de niche qui accélère (prix plat)
et un narratif déjà arrivé sur Reddit et CoinGecko trending."""
import random
from datetime import date, datetime, timedelta, timezone

from radar.db import upsert_post
from radar.scoring import run_scoring

END = date(2026, 9, 28)


def ts(d: date, hour=12) -> int:
    return int(datetime(d.year, d.month, d.day, hour, tzinfo=timezone.utc).timestamp())


def post(conn, pid, d, narrative, source, tier, author, post_type="analysis", hour=12):
    upsert_post(conn, {"id": pid, "source": source, "tier": tier, "channel": "c", "author": author,
                       "title": f"post {pid}", "body": "", "created_at": ts(d, hour)})
    conn.execute("UPDATE posts SET classified=1, post_type=?, matched='{}' WHERE id=?", (post_type, pid))
    if narrative:
        conn.execute("INSERT INTO post_narratives VALUES (?, ?)", (pid, narrative))


def build_history(conn):
    rnd = random.Random(42)
    start = END - timedelta(days=140)
    i = 0
    for k in range((END - start).days + 1):
        d = start + timedelta(days=k)
        recent = (END - d).days < 7
        # Bruit de fond hors narratif (dénominateur de la part de voix).
        for _ in range(30):
            i += 1
            post(conn, f"bg{i}", d, None, "reddit", "retail", f"u{rnd.randint(0, 500)}")
        # Restaking : 1 post de niche/jour, puis 6/jour sur les 7 derniers jours, auteurs variés.
        for _ in range(6 if recent else rnd.choice([0, 1, 1, 2])):
            i += 1
            post(conn, f"rs{i}", d, "restaking", "github", "niche", f"dev{rnd.randint(0, 400)}")
        # Memecoins : Reddit stable puis pic Reddit.
        for _ in range(25 if recent else rnd.choice([3, 4, 5])):
            i += 1
            post(conn, f"mc{i}", d, "memecoins", "reddit", "retail", f"r{rnd.randint(0, 900)}")
        # Prix : restaking plat, memecoins en hausse avec bruit.
        for coin, base in (("eigenlayer", 0.0), ("pepe", 3.0)):
            chg = base + rnd.uniform(-2, 2) + (40 if coin == "pepe" and recent else 0)
            conn.execute("INSERT INTO market_snapshots (date, coin_id, change_7d) VALUES (?, ?, ?)",
                         (d.isoformat(), coin, chg))
    conn.execute("INSERT INTO trending_snapshots VALUES (?, ?, 'coin', 'pepe', 'PEPE', 1)",
                 (ts(END), END.isoformat()))
    conn.commit()


def test_scoring_end_to_end(cfg, conn):
    build_history(conn)
    results = run_scoring(conn, cfg, END - timedelta(days=30), END)
    today = results[END]
    rs, mc = today["restaking"], today["memecoins"]

    # Restaking : vélocité > 1 (accélération), 100 % niche -> phase 1, divergence positive, alerte.
    assert rs["v"] > 2 and rs["q"] == 1.0
    assert rs["phase"] == 1
    assert rs["d"] > 0
    assert rs["alert"], rs
    # Memecoins : pic Reddit + trending -> phase 3, jamais d'alerte d'entrée (alarme seulement).
    assert mc["phase"] == 3 and mc["flags"].get("reddit_spike") and mc["flags"].get("coingecko_trending")
    assert not mc["alert"]
    assert mc["flags"].get("no_niche_source")
    # Narratif sans aucune mention : sous le plancher.
    assert today["depin"]["flags"].get("below_floor") and today["depin"]["score"] <= 0

    alerts = {(r["narrative"], r["kind"]) for r in conn.execute("SELECT * FROM alerts WHERE date=?", (END.isoformat(),))}
    assert ("restaking", "entry") in alerts
    # Memecoins : passage en phase 3 -> alerte de retard, une seule fois, au 3e jour du pic
    # (MA7/MA30 des mentions Reddit franchit 2 : (4x4 + 3x25)/7 / ((27x4 + 3x25)/30) = 2,1).
    late = conn.execute("SELECT date FROM alerts WHERE narrative='memecoins' AND kind='late'").fetchall()
    assert [r[0] for r in late] == [(END - timedelta(days=4)).isoformat()]
    assert conn.execute("SELECT count(*) FROM scores").fetchone()[0] == 31 * len(cfg.narratives)


def test_max_alerts_per_day(cfg, conn):
    build_history(conn)
    cfg.settings["alerts"]["max_per_day"] = 0
    run_scoring(conn, cfg, END, END)
    assert conn.execute("SELECT count(*) FROM alerts WHERE kind='entry'").fetchone()[0] == 0


def test_concentration_penalty(cfg, conn):
    """5 comptes qui font toutes les mentions : B pénalisé et drapeau 'concentrated'."""
    start = END - timedelta(days=100)
    i = 0
    for k in range(101):
        d = start + timedelta(days=k)
        for a in range(5):
            i += 1
            post(conn, f"p{i}", d, "depin", "github", "niche", f"shill{a}")
    conn.commit()
    r = run_scoring(conn, cfg, END, END)[END]["depin"]
    assert r["flags"].get("concentrated") == 1.0
    assert r["b"] == 0.0
