"""DefiLlama : TVL et revenus par catégorie (contrôle d'usage réel), plus deux signaux de phase 1
stockés comme des posts : les levées de fonds (« où l'argent intelligent s'engage ») et les
protocoles nouvellement listés."""
from __future__ import annotations

import logging
import time
from collections import defaultdict

from ..config import Config
from ..db import upsert_post
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

    _new_protocols(conn, cfg, protocols, res)
    _raises(conn, cfg, session, res)

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


def _new_protocols(conn, cfg: Config, protocols: list[dict], res: CollectResult) -> None:
    c = cfg.collector("defillama")
    since = time.time() - int(c.get("new_protocols_lookback_days", 30)) * 86400
    for p in protocols:
        listed = p.get("listedAt")
        if not isinstance(listed, (int, float)) or listed < since:
            continue
        chains = ", ".join(p.get("chains") or [])
        post = {
            "id": f"defillama:new:{p.get('slug') or p.get('id') or p.get('name')}",
            "source": "defillama",
            "tier": c.get("tier", "niche"),
            "channel": "nouveaux protocoles",
            "author": p.get("name"),               # un protocole = un "auteur" (diversité)
            "title": f"Nouveau protocole listé : {p.get('name')} ({p.get('category')}, {chains})",
            "body": p.get("description") or "",
            "url": f"https://defillama.com/protocol/{p.get('slug', '')}",
            "created_at": int(listed),
            "engagement": p.get("tvl") or 0,
            "extra": {"kind": "new_protocol", "category": p.get("category"), "chains": p.get("chains")},
        }
        if upsert_post(conn, post):
            res.new += 1
        else:
            res.seen += 1
    conn.commit()


def _raises(conn, cfg: Config, session, res: CollectResult) -> None:
    c = cfg.collector("defillama")
    try:
        data = get_json(session, f"{API}/raises", timeout=90)
    except HttpError as exc:
        res.errors.append(f"raises: {exc}")
        return
    since = time.time() - int(c.get("raises_lookback_days", 365)) * 86400
    for r in data.get("raises", []):
        date = r.get("date")
        if not isinstance(date, (int, float)) or date < since or not r.get("name"):
            continue
        amount = r.get("amount")                   # en millions de dollars
        leads = r.get("leadInvestors") or []
        others = r.get("otherInvestors") or []
        what = " / ".join(x for x in (r.get("category"), r.get("sector")) if x)
        money = f"{amount:g} M$" if isinstance(amount, (int, float)) else "montant non communiqué"
        post = {
            "id": f"defillama:raise:{r['name']}:{int(date)}",
            "source": "raises",
            "tier": c.get("tier", "niche"),
            "channel": r.get("round") or "levée",
            # Auteur = investisseur principal : la diversité des fonds qui misent sur un narratif.
            "author": leads[0] if leads else (others[0] if others else r["name"]),
            "title": f"{r['name']} lève {money} ({r.get('round') or 'tour non précisé'}) — {what}",
            "body": (f"{r.get('sector') or ''}. Chaînes : {', '.join(r.get('chains') or [])}. "
                     f"Investisseurs : {', '.join(leads + others)}"),
            "url": r.get("source") or "",
            "created_at": int(date),
            "engagement": amount or 0,
            "extra": {"kind": "raise", "category": r.get("category"), "round": r.get("round"),
                      "amount_musd": amount, "lead_investors": leads, "valuation": r.get("valuation")},
        }
        if upsert_post(conn, post):
            res.new += 1
        else:
            res.seen += 1
    conn.commit()
