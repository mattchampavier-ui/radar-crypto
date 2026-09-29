"""DefiLlama : TVL et revenus agrégés par catégorie de protocoles (contrôle d'usage réel)."""
from __future__ import annotations

import logging
from collections import defaultdict

from ..config import Config
from ..http import HttpError, get_json, make_session
from .base import CollectResult, today_utc

log = logging.getLogger(__name__)

API = "https://api.llama.fi"


def collect(conn, cfg: Config) -> CollectResult:
    res = CollectResult("defillama")
    session = make_session()
    date = today_utc()
    agg: dict[str, dict] = defaultdict(lambda: {"tvl": 0.0, "tvl_7d": 0.0, "n": 0, "rev": 0.0, "fees": 0.0})

    try:
        protocols = get_json(session, f"{API}/protocols", timeout=90)
    except HttpError as exc:
        res.errors.append(f"protocols: {exc}")
        protocols = []
    for p in protocols:
        cat, tvl = p.get("category"), p.get("tvl")
        if not cat or not isinstance(tvl, (int, float)) or tvl <= 0:
            continue
        a = agg[cat]
        a["tvl"] += tvl
        a["n"] += 1
        ch = p.get("change_7d")
        a["tvl_7d"] += tvl / (1 + ch / 100) if isinstance(ch, (int, float)) and ch > -100 else tvl

    for data_type, field in (("dailyRevenue", "rev"), ("dailyFees", "fees")):
        try:
            ov = get_json(session, f"{API}/overview/fees",
                          params={"excludeTotalDataChart": "true", "excludeTotalDataChartBreakdown": "true",
                                  "dataType": data_type}, timeout=90)
        except HttpError as exc:
            res.errors.append(f"{data_type}: {exc}")
            continue
        for p in ov.get("protocols", []):
            if p.get("category") and isinstance(p.get("total24h"), (int, float)):
                agg[p["category"]][field] += p["total24h"]

    for cat, a in agg.items():
        change = (a["tvl"] / a["tvl_7d"] - 1) * 100 if a["tvl_7d"] else None
        conn.execute("INSERT OR REPLACE INTO defillama_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (date, cat, a["tvl"], change, a["rev"], a["fees"], a["n"]))
        res.new += 1
    conn.commit()
    return res
