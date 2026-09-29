"""Filtre d'exclusion des tokens rattachés, appliqué avant toute mise en avant."""
from __future__ import annotations

from .config import Config

MANUAL_CHECKS = ("concentration des portefeuilles, déblocages à 12 mois et source du rendement "
                 "promis : à vérifier manuellement (non couverts par les API gratuites)")


def token_report(conn, cfg: Config, narrative: str) -> list[dict]:
    tf = cfg.settings["token_filter"]
    out = []
    for t in cfg.narratives[narrative].tokens:
        m = conn.execute("SELECT * FROM market_snapshots WHERE coin_id = ? ORDER BY date DESC LIMIT 1",
                         (t["id"],)).fetchone()
        item = {"id": t["id"], "symbol": t["symbol"], "reasons": []}
        if m is None:
            item.update(passed=False, reasons=["pas de données de marché"])
            out.append(item)
            continue
        item.update(price=m["price"], change_7d=m["change_7d"], market_cap=m["market_cap"], volume=m["volume"])
        supply = m["max_supply"] or m["total_supply"]
        if m["circulating"] and supply and m["circulating"] / supply < tf["min_circulating_ratio"]:
            item["reasons"].append(f"offre en circulation {m['circulating'] / supply:.0%} < {tf['min_circulating_ratio']:.0%}")
        vol, mcap = m["volume"] or 0, m["market_cap"] or 0
        if vol < tf["min_volume_usd"] or (mcap and vol / mcap < tf["min_volume_to_mcap"]):
            item["reasons"].append("liquidité faible")
        item["passed"] = not item["reasons"]
        out.append(item)
    return out
