"""Éléments communs aux emails : mise en forme, posts sources, santé de la collecte."""
from __future__ import annotations

import html
import json
import math
import time
from datetime import date, datetime, timedelta, timezone

from ..config import Config
from ..noise import post_weight

PHASES = {1: "1 · Niche", 2: "2 · Influenceurs", 3: "3 · Grand public crypto", 4: "4 · Mainstream"}
PHASE_COLORS = {1: "#1a7f37", 2: "#2f6fbd", 3: "#b35900", 4: "#b42318"}
FLAG_LABELS = {
    "cold_start": "historique court",
    "below_floor": "volume trop faible",
    "no_price": "pas de prix",
    "hot_token": "porté par un seul token",
    "no_niche_source": "aucune source niche",
    "token_sov_alarm": "token > 1 % des discussions",
    "concentrated": "concentré sur 5 comptes",
    "coingecko_trending": "CoinGecko trending",
    "reddit_spike": "pic Reddit",
    "wikipedia_spike": "pic Wikipédia",
}
DISCLAIMER = ("Outil de repérage de tendances, pas un conseil d'investissement. "
              "Rituel : lire les posts sources, vérifier le filtre d'exclusion, noter la décision dans le journal.")

e = html.escape


def num(x, fmt="{:.2f}", none="–"):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return none
    return fmt.format(x)


def pct(x):
    return num(x, "{:+.1f} %")


def usd(x):
    if x is None:
        return "–"
    for unit, div in (("Md$", 1e9), ("M$", 1e6), ("k$", 1e3)):
        if abs(x) >= div:
            return f"{x / div:.1f} {unit}"
    return f"{x:.0f} $"


def flags_text(flags: dict) -> str:
    out = []
    for k, v in flags.items():
        label = FLAG_LABELS.get(k, k)
        out.append(f"{label} ({v})" if k == "hot_token" else label)
    return ", ".join(out)


def phase_badge(phase: int) -> str:
    return (f'<span style="background:{PHASE_COLORS.get(phase, "#555")};color:#fff;border-radius:10px;'
            f'padding:1px 8px;font-size:12px;white-space:nowrap">{PHASES.get(phase, phase)}</span>')


def top_posts(conn, cfg: Config, narrative: str, end: date, n: int = 3) -> list[dict]:
    """Les posts les plus parlants des 7 derniers jours : poids x engagement, sources niche d'abord."""
    lo = int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()) - 6 * 86400
    hi = lo + 7 * 86400
    authors = {(r["source"], r["author"]): r for r in conn.execute("SELECT * FROM authors")}
    rows = conn.execute(
        """SELECT p.* FROM posts p JOIN post_narratives pn ON pn.post_id = p.id
           WHERE pn.narrative = ? AND p.created_at >= ? AND p.created_at < ?""", (narrative, lo, hi)).fetchall()
    scored = []
    for r in rows:
        w = post_weight(r, authors.get((r["source"], r["author"])), cfg.settings)
        if w > 0:
            scored.append((w * (1 + math.log1p(max(r["engagement"] or 0, 0))), r))
    scored.sort(key=lambda x: -x[0])
    return [{"title": (r["title"] or r["body"] or "")[:140], "url": r["url"], "source": r["source"],
             "channel": r["channel"], "author": r["author"], "tier": r["tier"]} for _, r in scored[:n]]


def collection_health(conn, hours: int = 24) -> tuple[dict, list[str]]:
    since = int(time.time()) - hours * 3600
    counts = {r[0]: r[1] for r in conn.execute(
        "SELECT source, count(*) FROM posts WHERE collected_at >= ? GROUP BY source", (since,))}
    problems = [f"{r['step']} : {r['status']} – {r['message']}" for r in conn.execute(
        """SELECT step, status, message FROM runs WHERE ts >= ? AND status != 'ok'
           GROUP BY step, status, message ORDER BY step""", (since,))]
    return counts, problems


def load_scores(conn, d: date) -> dict[str, dict]:
    out = {}
    for r in conn.execute("SELECT * FROM scores WHERE date = ?", (d.isoformat(),)):
        row = dict(r)
        row["flags"] = json.loads(row["flags"] or "{}")
        out[r["narrative"]] = row
    return out


def wrap(title: str, body: str) -> str:
    return f"""<!doctype html><html><body style="margin:0;background:#f4f5f7">
<div style="max-width:760px;margin:0 auto;padding:16px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2328;font-size:14px;line-height:1.45">
<h1 style="font-size:20px;margin:8px 0 16px">{e(title)}</h1>
{body}
<p style="color:#6e7781;font-size:12px;margin-top:24px">{e(DISCLAIMER)}</p>
</div></body></html>"""


def section(title: str, inner: str) -> str:
    return (f'<div style="background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px 16px;margin:0 0 14px">'
            f'<h2 style="font-size:16px;margin:0 0 10px">{e(title)}</h2>{inner}</div>')


TH = 'style="text-align:left;padding:4px 6px;border-bottom:1px solid #d0d7de;font-size:12px;color:#57606a"'
TD = 'style="padding:4px 6px;border-bottom:1px solid #eaeef2;vertical-align:top"'


def table(headers: list[str], rows: list[list[str]]) -> str:
    head = "".join(f"<th {TH}>{h}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td {TD}>{c}</td>" for c in row) + "</tr>" for row in rows)
    return f'<table style="border-collapse:collapse;width:100%;font-size:13px"><tr>{head}</tr>{body}</table>'


def date_minus(d: date, days: int) -> date:
    return d - timedelta(days=days)
