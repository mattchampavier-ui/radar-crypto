"""Base SQLite versionnée dans le dépôt (data/radar.db)."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
    id            TEXT PRIMARY KEY,          -- "<source>:<id natif>"
    source        TEXT NOT NULL,             -- reddit | github | farcaster | rss
    tier          TEXT NOT NULL,             -- niche | influencer | retail | mainstream
    channel       TEXT,                      -- subreddit, flux RSS, canal Farcaster, requête GitHub
    author        TEXT,
    title         TEXT,
    body          TEXT,
    url           TEXT,
    created_at    INTEGER NOT NULL,          -- epoch UTC
    collected_at  INTEGER NOT NULL,
    engagement    REAL DEFAULT 0,            -- upvotes, étoiles, likes...
    extra         TEXT,                      -- JSON libre
    matched       TEXT,                      -- JSON {narratif: [mots-clés]} du pré-filtre
    classified    INTEGER DEFAULT 0,         -- 0 = à classer, 1 = LLM, 2 = fallback mots-clés
    post_type     TEXT,                      -- analysis | announcement | promotion | spam | unclassified
    promo_flag    INTEGER DEFAULT 0,
    dup_of        TEXT                       -- id du post canonique si quasi-doublon
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_classified ON posts(classified);

CREATE TABLE IF NOT EXISTS post_narratives (
    post_id   TEXT NOT NULL,
    narrative TEXT NOT NULL,
    PRIMARY KEY (post_id, narrative)
);
CREATE INDEX IF NOT EXISTS idx_pn_narrative ON post_narratives(narrative);

CREATE TABLE IF NOT EXISTS post_tokens (
    post_id  TEXT NOT NULL,
    token_id TEXT NOT NULL,
    PRIMARY KEY (post_id, token_id)
);

CREATE TABLE IF NOT EXISTS authors (
    source      TEXT NOT NULL,
    author      TEXT NOT NULL,
    created_at  INTEGER,                     -- date de création du compte (epoch) si connue
    karma       REAL,
    followers   INTEGER,
    following   INTEGER,
    suspect     INTEGER DEFAULT 0,
    fetched_at  INTEGER,
    PRIMARY KEY (source, author)
);

CREATE TABLE IF NOT EXISTS market_snapshots (
    date        TEXT NOT NULL,               -- YYYY-MM-DD (UTC)
    coin_id     TEXT NOT NULL,
    price       REAL, market_cap REAL, volume REAL,
    circulating REAL, total_supply REAL, max_supply REAL,
    change_7d   REAL,
    PRIMARY KEY (date, coin_id)
);

CREATE TABLE IF NOT EXISTS trending_snapshots (
    ts        INTEGER NOT NULL,
    date      TEXT NOT NULL,
    kind      TEXT NOT NULL,                 -- coin | category
    item_id   TEXT NOT NULL,
    name      TEXT,
    rank      INTEGER,
    PRIMARY KEY (ts, kind, item_id)
);

CREATE TABLE IF NOT EXISTS category_snapshots (
    date        TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name        TEXT,
    market_cap  REAL, change_24h REAL, volume_24h REAL,
    PRIMARY KEY (date, category_id)
);

CREATE TABLE IF NOT EXISTS defillama_snapshots (
    date        TEXT NOT NULL,
    category    TEXT NOT NULL,
    tvl         REAL, tvl_change_7d REAL, revenue_24h REAL, fees_24h REAL, n_protocols INTEGER,
    PRIMARY KEY (date, category)
);

CREATE TABLE IF NOT EXISTS term_candidates (
    term        TEXT PRIMARY KEY,
    first_seen  INTEGER, last_seen INTEGER,
    count       INTEGER DEFAULT 0,
    narrative_hint TEXT,
    status      TEXT DEFAULT 'new'           -- new | accepted | rejected
);

CREATE TABLE IF NOT EXISTS scores (
    date      TEXT NOT NULL,
    narrative TEXT NOT NULL,
    m REAL, m_niche REAL, m_reddit REAL, m_mainstream REAL, posts INTEGER,
    ma7 REAL, ma30 REAL,
    v REAL, a REAL, b REAL, q REAL, sov REAL, r7 REAL, d REAL,
    z_v REAL, z_a REAL, z_b REAL, z_q REAL,
    penalties REAL, score REAL, phase INTEGER,
    flags TEXT,                              -- JSON
    PRIMARY KEY (date, narrative)
);

CREATE TABLE IF NOT EXISTS alerts (
    date      TEXT NOT NULL,
    narrative TEXT NOT NULL,
    kind      TEXT NOT NULL,                 -- entry | late
    score     REAL, phase INTEGER,
    payload   TEXT,
    PRIMARY KEY (date, narrative, kind)
);

CREATE TABLE IF NOT EXISTS email_log (
    kind    TEXT NOT NULL,                   -- daily | weekly
    date    TEXT NOT NULL,
    sent_at INTEGER,
    PRIMARY KEY (kind, date)
);

CREATE TABLE IF NOT EXISTS runs (
    ts        INTEGER NOT NULL,
    step      TEXT NOT NULL,
    status    TEXT NOT NULL,                 -- ok | skipped | error
    n_items   INTEGER DEFAULT 0,
    message   TEXT
);
"""


def connect(path: Path | str) -> sqlite3.Connection:
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    # Journal classique (pas de WAL) : un seul fichier à commiter dans le dépôt.
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.executescript(SCHEMA)
    return conn


def upsert_post(conn: sqlite3.Connection, post: dict) -> bool:
    """Insère un post ; s'il existe déjà, met à jour l'engagement. Retourne True si nouveau."""
    now = int(time.time())
    cur = conn.execute("SELECT 1 FROM posts WHERE id = ?", (post["id"],))
    if cur.fetchone():
        conn.execute(
            "UPDATE posts SET engagement = ?, extra = COALESCE(?, extra) WHERE id = ?",
            (post.get("engagement", 0), _json(post.get("extra")), post["id"]),
        )
        return False
    conn.execute(
        """INSERT INTO posts (id, source, tier, channel, author, title, body, url,
                              created_at, collected_at, engagement, extra)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (post["id"], post["source"], post["tier"], post.get("channel"), post.get("author"),
         post.get("title"), post.get("body"), post.get("url"), int(post["created_at"]), now,
         post.get("engagement", 0), _json(post.get("extra"))),
    )
    return True


def log_run(conn: sqlite3.Connection, step: str, status: str, n_items: int = 0, message: str = "") -> None:
    conn.execute("INSERT INTO runs (ts, step, status, n_items, message) VALUES (?, ?, ?, ?, ?)",
                 (int(time.time()), step, status, n_items, message[:500]))
    conn.commit()


def _json(value) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False)
