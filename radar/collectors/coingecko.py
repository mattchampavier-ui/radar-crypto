"""CoinGecko : prix des paniers de tokens, trending (alarme phase 3) et catégories.

API publique ; une clé "Demo" gratuite (COINGECKO_API_KEY) donne des limites plus confortables.
Les instantanés sont stockés par jour UTC (le dernier passage de la journée fait foi).
"""
from __future__ import annotations

import logging
import time

from ..config import Config, env
from ..http import HttpError, get_json, make_session
from .base import CollectResult, today_utc

log = logging.getLogger(__name__)

API = "https://api.coingecko.com/api/v3"


def collect(conn, cfg: Config) -> CollectResult:
    res = CollectResult("coingecko")
    headers = {"accept": "application/json"}
    if env("COINGECKO_API_KEY"):
        headers["x-cg-demo-api-key"] = env("COINGECKO_API_KEY")
    session = make_session(headers)
    date, ts = today_utc(), int(time.time())
    pause = 2.5 if "x-cg-demo-api-key" in headers else 6.0

    # 1. Trending : tokens et catégories déjà repérés par la foule.
    try:
        trending = get_json(session, f"{API}/search/trending")
        for rank, c in enumerate(trending.get("coins", []), 1):
            item = c.get("item", {})
            conn.execute("INSERT OR REPLACE INTO trending_snapshots VALUES (?, ?, 'coin', ?, ?, ?)",
                         (ts, date, item.get("id"), item.get("symbol"), rank))
            res.new += 1
        for rank, cat in enumerate(trending.get("categories", []), 1):
            conn.execute("INSERT OR REPLACE INTO trending_snapshots VALUES (?, ?, 'category', ?, ?, ?)",
                         (ts, date, cat.get("slug") or str(cat.get("id")), cat.get("name"), rank))
            res.new += 1
    except HttpError as exc:
        res.errors.append(f"trending: {exc}")
    time.sleep(pause)

    # 2. Catégories : capitalisation et variation 24 h (contrôle au niveau du narratif).
    wanted = {cid for n in cfg.narratives.values() for cid in n.coingecko_categories}
    try:
        for cat in get_json(session, f"{API}/coins/categories"):
            if cat.get("id") in wanted:
                conn.execute("INSERT OR REPLACE INTO category_snapshots VALUES (?, ?, ?, ?, ?, ?)",
                             (date, cat["id"], cat.get("name"), cat.get("market_cap"),
                              cat.get("market_cap_change_24h"), cat.get("volume_24h")))
                res.new += 1
    except HttpError as exc:
        res.errors.append(f"categories: {exc}")
    time.sleep(pause)

    # 3. Marchés des tokens rattachés (prix, 7 j, offre, liquidité -> filtre d'exclusion).
    ids = sorted(cfg.all_tokens())
    found: set[str] = set()
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        try:
            rows = get_json(session, f"{API}/coins/markets",
                            params={"vs_currency": "usd", "ids": ",".join(chunk), "per_page": 250,
                                    "price_change_percentage": "7d"})
        except HttpError as exc:
            res.errors.append(f"markets: {exc}")
            continue
        for r in rows:
            found.add(r["id"])
            conn.execute(
                "INSERT OR REPLACE INTO market_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (date, r["id"], r.get("current_price"), r.get("market_cap"), r.get("total_volume"),
                 r.get("circulating_supply"), r.get("total_supply"), r.get("max_supply"),
                 r.get("price_change_percentage_7d_in_currency")))
            res.new += 1
        time.sleep(pause)
    missing = set(ids) - found
    if missing and not res.errors:
        res.errors.append("ids CoinGecko introuvables (à corriger dans narratives.yaml) : " + ", ".join(sorted(missing)))
    conn.commit()
    return res
