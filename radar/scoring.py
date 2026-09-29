"""Scoring quotidien des narratifs (formules du cahier des charges).

  M_t   = somme des w_auteur x w_source (x w_type, pénalités promo/doublon) des posts du jour
  V_t   = MA7(M) / MA30(M)             (plancher de volume sur MA30)
  A_t   = V_t - V_{t-7}
  B_t   = Auteurs_7j / (Auteurs_30j / 30 x 7) x (1 - pénalité_concentration)
  Q_t   = M_niche / M                  (sur 7 jours glissants)
  SoV_t = M_narratif / somme M_tous    (sur 7 jours glissants)
  D_t   = z(V_t) - z(R_7j panier)
  Score = 0,30 z(V) + 0,15 z(A) + 0,20 z(B) + 0,20 z(Q) + 0,15 D - pénalités

Les z-scores sont calculés sur l'historique propre du narratif (fenêtre glissante). Tant que
l'historique est trop court (< min_history_days), on se rabat sur un z-score transversal
(comparaison entre narratifs le même jour), signalé par le drapeau "cold_start".

Tout est recalculé à partir des posts : le scoring d'une date passée est reproductible,
ce qui sert directement au backtest (commande `backfill`).
"""
from __future__ import annotations

import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from .config import Config
from .noise import post_weight
from .process import NO_MATCH

LOOKBACK_EXTRA = 45   # jours d'historique en plus de la fenêtre de z-score (MA30 + A_t)


def _day(ts: int) -> date:
    return datetime.fromtimestamp(ts, tz=timezone.utc).date()


def _epoch(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())


@dataclass
class DayStats:
    m: float = 0.0
    m_niche: float = 0.0
    m_reddit: float = 0.0
    mainstream: int = 0
    posts: int = 0
    authors: Counter = field(default_factory=Counter)   # auteur -> mentions pondérées
    author_posts: Counter = field(default_factory=Counter)  # auteur -> nb de posts
    tokens: Counter = field(default_factory=Counter)    # token -> nb de posts


def _load(conn, cfg: Config, start: date, end: date):
    """Agrège posts -> statistiques journalières par narratif + dénominateur global."""
    settings = cfg.settings
    authors = {(r["source"], r["author"]): r for r in conn.execute("SELECT * FROM authors")}
    lo, hi = _epoch(start), _epoch(end + timedelta(days=1))
    posts = conn.execute(
        "SELECT * FROM posts WHERE created_at >= ? AND created_at < ?", (lo, hi)).fetchall()
    links = defaultdict(list)
    for r in conn.execute(
            """SELECT pn.post_id, pn.narrative FROM post_narratives pn JOIN posts p ON p.id = pn.post_id
               WHERE p.created_at >= ? AND p.created_at < ?""", (lo, hi)):
        links[r["post_id"]].append(r["narrative"])
    toks = defaultdict(list)
    for r in conn.execute(
            """SELECT pt.post_id, pt.token_id FROM post_tokens pt JOIN posts p ON p.id = pt.post_id
               WHERE p.created_at >= ? AND p.created_at < ?""", (lo, hi)):
        toks[r["post_id"]].append(r["token_id"])

    stats: dict[str, dict[date, DayStats]] = {n: defaultdict(DayStats) for n in cfg.narratives}
    total: dict[date, float] = defaultdict(float)
    total_posts: dict[date, int] = defaultdict(int)
    token_all: dict[date, Counter] = defaultdict(Counter)
    for p in posts:
        d = _day(p["created_at"])
        arow = authors.get((p["source"], p["author"]))
        w = post_weight(p, arow, settings)
        if p["classified"] == NO_MATCH:
            # Hors narratif : compte dans le dénominateur de la part de voix, poids de type neutre.
            w = w / settings["post_type_weights"]["unclassified"]
        total[d] += w
        total_posts[d] += 1
        for t in toks.get(p["id"], []):
            token_all[d][t] += 1
        for n in links.get(p["id"], []):
            if n not in stats:
                continue
            s = stats[n][d]
            s.posts += 1
            if p["tier"] == "mainstream":
                s.mainstream += 1
            if w <= 0:
                continue
            s.m += w
            if p["tier"] == "niche":
                s.m_niche += w
            if p["source"] == "reddit":
                s.m_reddit += w
            s.authors[f"{p['source']}:{p['author']}"] += w
            s.author_posts[f"{p['source']}:{p['author']}"] += 1
            for t in toks.get(p["id"], []):
                s.tokens[t] += 1
    return stats, total, total_posts, token_all


def _market(conn, cfg: Config, start: date, end: date) -> dict[str, dict[date, float]]:
    """R_7j du panier de chaque narratif (moyenne des variations 7 j des tokens), par jour."""
    rows = conn.execute("SELECT date, coin_id, change_7d FROM market_snapshots WHERE date BETWEEN ? AND ?",
                        (start.isoformat(), end.isoformat())).fetchall()
    by_day: dict[date, dict[str, float]] = defaultdict(dict)
    for r in rows:
        if r["change_7d"] is not None:
            by_day[date.fromisoformat(r["date"])][r["coin_id"]] = r["change_7d"]
    out: dict[str, dict[date, float]] = {}
    for key, n in cfg.narratives.items():
        ids = [t["id"] for t in n.tokens]
        series = {}
        for d, changes in by_day.items():
            vals = [changes[i] for i in ids if i in changes]
            if vals:
                series[d] = statistics.fmean(vals)
        out[key] = series
    return out


def _trending(conn, start: date, end: date) -> tuple[dict[date, set], dict[date, set]]:
    coins, cats = defaultdict(set), defaultdict(set)
    for r in conn.execute("SELECT date, kind, item_id FROM trending_snapshots WHERE date BETWEEN ? AND ?",
                          (start.isoformat(), end.isoformat())):
        (coins if r["kind"] == "coin" else cats)[date.fromisoformat(r["date"])].add(r["item_id"])
    return coins, cats


def _z(value, history: list[float]) -> float | None:
    if value is None:
        return None
    vals = [h for h in history if h is not None]
    if len(vals) < 2:
        return None
    sd = statistics.pstdev(vals)
    if sd == 0:
        return 0.0
    return (value - statistics.fmean(vals)) / sd


def _window(series: dict[date, DayStats], d: date, days: int) -> list[DayStats]:
    return [series.get(d - timedelta(days=i), DayStats()) for i in range(days)]


def _raw_metrics(cfg: Config, s: dict[date, DayStats], total, market, d: date) -> dict:
    sc = cfg.settings["scoring"]
    w7, w30 = _window(s, d, 7), _window(s, d, 30)
    m7 = sum(x.m for x in w7)
    ma7, ma30 = m7 / 7, sum(x.m for x in w30) / 30
    above = ma30 >= sc["volume_floor"]
    v = ma7 / ma30 if above and ma30 > 0 else None

    a7, a30, n7 = Counter(), Counter(), Counter()
    for x in w7:
        a7.update(x.authors)
        n7.update(x.author_posts)
    for x in w30:
        a30.update(x.authors)
    b = None
    concentration = 0.0
    if above and a30:
        # Seuls les comptes qui publient plusieurs fois comptent : à faible volume, 5 auteurs
        # uniques font mécaniquement > 40 % des mentions sans qu'il y ait campagne.
        repeat = Counter({a: w for a, w in a7.items() if n7[a] >= 2})
        top = sum(w for _, w in repeat.most_common(sc["concentration_top_n"]))
        concentration = top / m7 if m7 else 0.0
        thr = sc["concentration_threshold"]
        penalty = max(0.0, (concentration - thr) / (1 - thr)) if concentration > thr else 0.0
        b = len(a7) / (len(a30) / 30 * 7) * (1 - penalty)

    niche7 = sum(x.m_niche for x in w7)
    reddit7 = sum(x.m_reddit for x in w7)
    reddit30 = sum(x.m_reddit for x in w30)
    tot7 = sum(total.get(d - timedelta(days=i), 0.0) for i in range(7))
    tokens7 = Counter()
    for x in w7:
        tokens7.update(x.tokens)
    return {
        "m": s.get(d, DayStats()).m, "posts": s.get(d, DayStats()).posts,
        "m_niche": s.get(d, DayStats()).m_niche, "m_reddit": s.get(d, DayStats()).m_reddit,
        "m_mainstream": float(sum(x.mainstream for x in w7)),
        "ma7": ma7, "ma30": ma30, "v": v, "b": b, "above_floor": above,
        "q": niche7 / m7 if m7 else None,
        "sov": m7 / tot7 if tot7 else None,
        "reddit_share": reddit7 / m7 if m7 else 0.0,
        "reddit_ma7": reddit7 / 7, "reddit_ma30": reddit30 / 30,
        "niche7": niche7, "concentration": concentration,
        "tokens7": tokens7, "r7": market.get(d),
    }


def compute(conn, cfg: Config, start: date, end: date) -> dict[date, dict[str, dict]]:
    """Calcule les scores de chaque narratif pour chaque jour de [start, end]."""
    sc, al = cfg.settings["scoring"], cfg.settings["alerts"]
    zwin, min_hist = sc["zscore_window_days"], sc["min_history_days"]
    first = start - timedelta(days=zwin + LOOKBACK_EXTRA)
    stats, total, total_posts, token_all = _load(conn, cfg, first, end)
    market = _market(conn, cfg, first, end)
    t_coins, t_cats = _trending(conn, first, end)

    days = [first + timedelta(days=i) for i in range((end - first).days + 1)]
    raw: dict[str, dict[date, dict]] = {n: {} for n in cfg.narratives}
    for n in cfg.narratives:
        for d in days[30:]:
            raw[n][d] = _raw_metrics(cfg, stats[n], total, market[n], d)
        for d in days[37:]:
            v, v_prev = raw[n][d]["v"], raw[n][d - timedelta(days=7)]["v"]
            raw[n][d]["a"] = v - v_prev if v is not None and v_prev is not None else None

    results: dict[date, dict[str, dict]] = {}
    score_hist: dict[str, list[float]] = defaultdict(list)
    for d in days[37:]:
        day_res = {}
        hist_days = [d - timedelta(days=i) for i in range(zwin) if d - timedelta(days=i) in raw[next(iter(raw))]]
        for n, narr in cfg.narratives.items():
            r = raw[n][d]
            z, cold = {}, False
            for k in ("v", "a", "b", "q", "r7"):
                own = [raw[n][h].get(k) for h in hist_days]
                if sum(x is not None for x in own) >= min_hist:
                    z[k] = _z(r.get(k), own)
                else:
                    cold = True
                    cross = [raw[o][d].get(k) for o in cfg.narratives]
                    z[k] = _z(r.get(k), cross)
            div = (z["v"] - z["r7"]) if z["v"] is not None and z["r7"] is not None else None

            flags: dict = {}
            penalties = 0.0
            if cold:
                flags["cold_start"] = True
            if not r["above_floor"]:
                flags["below_floor"] = True
            if r["r7"] is None:
                flags["no_price"] = True
            tok = r["tokens7"]
            if sum(tok.values()) >= 5:
                top_id, top_n = tok.most_common(1)[0]
                if top_n / sum(tok.values()) > sc["penalties"]["single_token_share"]:
                    flags["hot_token"] = top_id
                    penalties += sc["penalties"]["single_token"]
            if r["niche7"] <= 0 and r["ma7"] > 0:
                flags["no_niche_source"] = True
                penalties += sc["penalties"]["no_niche_source"]
            posts7 = sum(total_posts.get(d - timedelta(days=i), 0) for i in range(7))
            if posts7:
                tall = Counter()
                for i in range(7):
                    tall.update(token_all.get(d - timedelta(days=i), Counter()))
                hot = {t: c / posts7 for t, c in tall.items()
                       if t in {x["id"] for x in narr.tokens} and c / posts7 > sc["token_sov_alarm"]}
                if hot:
                    flags["token_sov_alarm"] = {t: round(s, 4) for t, s in hot.items()}
            if r["concentration"] > sc["concentration_threshold"]:
                flags["concentrated"] = round(r["concentration"], 2)

            w = sc["weights"]
            score = (w["V"] * (z["v"] or 0) + w["A"] * (z["a"] or 0) + w["B"] * (z["b"] or 0)
                     + w["Q"] * (z["q"] or 0) + w["D"] * (div or 0) - penalties)
            if not r["above_floor"]:
                score = min(score, 0.0)

            # Phase 1 à 4.
            ph = sc["phase"]
            window = [d - timedelta(days=i) for i in range(7)]
            trending = any(t["id"] in t_coins.get(x, set()) for t in narr.tokens for x in window) or \
                any(c in t_cats.get(x, set()) for c in narr.coingecko_categories for x in window)
            reddit_spike = (r["reddit_ma30"] > 0 and r["reddit_ma7"] / r["reddit_ma30"] >= ph["reddit_spike_ratio"]
                            and r["reddit_ma7"] >= ph["reddit_spike_min_daily"])
            if trending:
                flags["coingecko_trending"] = True
            if reddit_spike:
                flags["reddit_spike"] = True
            if r["m_mainstream"] >= ph["mainstream_min_mentions_7d"]:
                phase = 4
            elif reddit_spike or trending:
                phase = 3
            elif (r["q"] or 0) > ph["niche_share_min"] and r["reddit_share"] < ph["reddit_low_share"]:
                phase = 1
            else:
                phase = 2

            # Alerte d'entrée : décile supérieur ET phase 1-2 ET divergence positive ET source niche.
            hist = score_hist[n]
            if len(hist) >= al["min_history_for_decile"]:
                threshold = sorted(hist)[min(len(hist) - 1, math.floor(al["top_decile"] * len(hist)))]
            else:
                threshold = al["fallback_min_score"]
            alert = (score >= threshold and phase in (1, 2) and (div or 0) > 0 and r["above_floor"]
                     and "no_niche_source" not in flags and not narr.alarm_only)
            score_hist[n] = (hist + [score])[-zwin:]

            day_res[n] = {
                "m": r["m"], "m_niche": r["m_niche"], "m_reddit": r["m_reddit"], "m_mainstream": r["m_mainstream"],
                "posts": r["posts"], "ma7": r["ma7"], "ma30": r["ma30"],
                "v": r["v"], "a": r.get("a"), "b": r["b"], "q": r["q"], "sov": r["sov"], "r7": r["r7"], "d": div,
                "z_v": z["v"], "z_a": z["a"], "z_b": z["b"], "z_q": z["q"],
                "penalties": penalties, "score": score, "phase": phase, "flags": flags,
                "alert": alert, "alert_threshold": threshold,
            }
        if start <= d <= end:
            results[d] = day_res
    return results


COLS = ["m", "m_niche", "m_reddit", "m_mainstream", "posts", "ma7", "ma30", "v", "a", "b", "q", "sov",
        "r7", "d", "z_v", "z_a", "z_b", "z_q", "penalties", "score", "phase"]


def run_scoring(conn, cfg: Config, start: date, end: date | None = None) -> dict[date, dict[str, dict]]:
    """Calcule, enregistre les scores et les alertes (plafonnées à max_per_day)."""
    end = end or start
    results = compute(conn, cfg, start, end)
    max_alerts = cfg.settings["alerts"]["max_per_day"]
    cooldown = cfg.settings["alerts"].get("cooldown_days", 7)
    for d, day_res in results.items():
        ds = d.isoformat()
        prev = {r["narrative"]: r["phase"] for r in conn.execute(
            "SELECT narrative, phase FROM scores WHERE date = ?", ((d - timedelta(days=1)).isoformat(),))}
        for n, r in day_res.items():
            conn.execute(
                f"INSERT OR REPLACE INTO scores (date, narrative, {', '.join(COLS)}, flags) "
                f"VALUES (?, ?, {', '.join('?' * len(COLS))}, ?)",
                (ds, n, *[r[c] for c in COLS], json.dumps(r["flags"])),
            )
        conn.execute("DELETE FROM alerts WHERE date = ?", (ds,))
        # Délai de carence : pas de nouvelle alerte d'entrée pour un narratif déjà alerté récemment.
        recent = {r[0] for r in conn.execute(
            "SELECT narrative FROM alerts WHERE kind = 'entry' AND date >= ? AND date < ?",
            ((d - timedelta(days=cooldown)).isoformat(), ds))}
        entries = sorted((x for x in day_res.items() if x[1]["alert"] and x[0] not in recent),
                         key=lambda x: -x[1]["score"])
        for n, r in entries[:max_alerts]:
            conn.execute("INSERT INTO alerts VALUES (?, ?, 'entry', ?, ?, ?)",
                         (ds, n, r["score"], r["phase"], json.dumps({"d": r["d"], "flags": r["flags"]})))
        # Alerte de retard : narratif passé de phase 1-2 à phase 3-4.
        for n, r in day_res.items():
            if r["phase"] >= 3 and prev.get(n) in (1, 2):
                conn.execute("INSERT OR REPLACE INTO alerts VALUES (?, ?, 'late', ?, ?, ?)",
                             (ds, n, r["score"], r["phase"],
                              json.dumps({"from_phase": prev[n], "flags": r["flags"]})))
    conn.commit()
    return results
