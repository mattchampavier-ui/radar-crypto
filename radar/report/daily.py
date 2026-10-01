"""Email quotidien, écrit pour être lu en 2 minutes :

1. En bref : ce qu'il faut regarder aujourd'hui.
2. Alertes : pourquoi le radar sonne, les posts à lire, les tokens, quoi faire.
3. Où en est chaque narratif : regroupés par situation (tôt, à l'écoute, tard, sommet, calme),
   une phrase par narratif au lieu d'un tableau d'indicateurs.
4. Le marché en un coup d'œil : ce que la foule regarde, si l'argent suit, les levées de fonds.
5. Santé de la collecte et mode d'emploi, en petit.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone

from ..config import Config, Narrative
from ..scoring import MIN_COVERAGE_DAYS, data_start
from ..tokens import MANUAL_CHECKS, token_report
from .common import (PHASES, collection_health, e, load_scores, pct, phase_badge, section, top_posts,
                     usd, wrap)

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
        "octobre", "novembre", "décembre"]
GREY = "color:#57606a;font-size:13px"
SOURCES_FR = {"github": "GitHub", "rss": "blog/média", "reddit": "Reddit", "farcaster": "Farcaster",
              "hackernews": "Hacker News", "snapshot": "gouvernance Snapshot", "raises": "levée de fonds",
              "defillama": "nouveau protocole"}

# Groupes affichés, dans l'ordre de l'email.
BUCKETS = [
    ("early", "🟢 Ça monte chez les spécialistes", "Le profil recherché : à regarder de près."),
    ("spread", "🟡 Ça monte, mais déjà au-delà des spécialistes", "Phase de diffusion : fenêtre courte."),
    ("watch", "🔵 Discussions de spécialistes, sans accélération", "Rien à faire, le radar surveille."),
    ("late", "🟠 Trop tard : la foule est déjà là", "Surveillance seulement, pas d'entrée."),
    ("top", "🔴 Sommet probable : le grand public s'en empare", "Alarme de sortie."),
    ("quiet", "⚪ Trop calme pour juger", "Moins d'une mention par jour en moyenne."),
]


def date_fr(d: date) -> str:
    return f"{JOURS[d.weekday()]} {d.day} {MOIS[d.month - 1]} {d.year}"


def fr_num(x: float, digits: int = 1) -> str:
    return f"{x:.{digits}f}".replace(".", ",")


def fr_pct(x: float | None) -> str:
    return "–" if x is None else pct(x).replace(".", ",")


def _cap(text: str) -> str:
    """Majuscule initiale sans toucher au reste (str.capitalize minusculerait « PEPE »)."""
    return text[:1].upper() + text[1:]


def _trending_tokens(conn, narr: Narrative, d: date) -> list[str]:
    """Symboles des tokens du narratif apparus dans CoinGecko trending sur 7 jours."""
    ids = {t["id"]: t["symbol"] for t in narr.tokens}
    if not ids:
        return []
    rows = conn.execute(
        f"SELECT DISTINCT item_id FROM trending_snapshots WHERE kind = 'coin' AND date > ? AND date <= ? "
        f"AND item_id IN ({','.join('?' * len(ids))})",
        ((d - timedelta(days=7)).isoformat(), (d + timedelta(days=1)).isoformat(), *ids)).fetchall()
    return [ids[r[0]] for r in rows]


def classify_narrative(conn, cfg: Config, key: str, s: dict, d: date) -> tuple[str, str]:
    """(groupe, phrase de lecture) pour un narratif."""
    narr = cfg.narratives[key]
    flags = s["flags"]
    ph = cfg.settings["scoring"]["phase"]

    if s["phase"] == 4:
        why = []
        if flags.get("wikipedia_spike"):
            why.append("les consultations Wikipédia s'envolent")
        if (s["m_mainstream"] or 0) >= ph["mainstream_min_mentions_7d"]:
            why.append(f"la presse généraliste en parle ({int(s['m_mainstream'])} articles en 7 jours)")
        return "top", _cap(" et ".join(why) or "le grand public s'en empare") + "."

    if s["phase"] == 3:
        why = []
        toks = _trending_tokens(conn, narr, d)
        if toks:
            why.append(f"{', '.join(toks)} fait partie des tokens les plus recherchés sur CoinGecko"
                       if len(toks) == 1 else
                       f"{', '.join(toks)} font partie des tokens les plus recherchés sur CoinGecko")
        elif flags.get("coingecko_trending"):
            why.append("sa catégorie fait partie des plus recherchées sur CoinGecko")
        if flags.get("reddit_spike"):
            why.append("les discussions sur Reddit s'emballent")
        return "late", _cap(" ; ".join(why) or "la foule est arrivée") + "."

    if flags.get("below_floor"):
        return "quiet", "Trop peu de mentions pour juger."

    parts = []
    if s["v"] is None:
        parts.append("pas encore assez d'historique pour mesurer une accélération")
    elif s["v"] >= 1.3:
        parts.append(f"mentions ×{fr_num(s['v'])} par rapport à la moyenne du mois")
    elif s["v"] < 0.8:
        parts.append(f"conversation en recul (×{fr_num(s['v'])} vs le mois)")
    else:
        parts.append("conversation stable")
    if s["q"] is not None:
        parts.append(f"{round(s['q'] * 100)} % des mentions viennent de sources spécialisées" if s["q"] >= 0.5
                     else "la discussion déborde déjà des cercles spécialisés")
    if s["r7"] is not None:
        if abs(s["r7"]) < 5:
            parts.append(f"prix des tokens encore calme ({fr_pct(s['r7'])} en 7 j)")
        elif s["r7"] >= 5:
            parts.append(f"prix des tokens déjà en hausse ({fr_pct(s['r7'])} en 7 j)")
        else:
            parts.append(f"prix des tokens en baisse ({fr_pct(s['r7'])} en 7 j)")
    sentence = ", ".join(parts[:-1]) + (" et " if len(parts) > 1 else "") + parts[-1]
    sentence = _cap(sentence) + "."
    if narr.alarm_only:
        sentence += " (Suivi en alarme seulement.)"
    rising = s["v"] is not None and s["v"] >= 1.3
    bucket = ("early" if (s["q"] or 0) >= 0.5 else "spread") if rising else "watch"
    return bucket, sentence


def _facts(s: dict) -> str:
    """Ligne grise de chiffres bruts sous la phrase."""
    bits = [f"{round(s['ma7'] * 7) if s['ma7'] else 0} mentions (pondérées) en 7 j"]
    if s["sov"]:
        bits.append(f"{fr_num(s['sov'] * 100)} % des conversations suivies")
    return " · ".join(bits)


def _tokens_html(items: list[dict]) -> str:
    rows = []
    for t in items:
        status = ("✅ passe le filtre" if t["passed"] else "⛔ écarté : " + ", ".join(t["reasons"]))
        rows.append(f"<li><b>{e(t['symbol'])}</b> — {fr_pct(t.get('change_7d'))} en 7 j, "
                    f"capitalisation {usd(t.get('market_cap'))}, échanges {usd(t.get('volume'))}/jour — {e(status)}</li>")
    return (f'<ul style="margin:4px 0 4px 18px;padding:0">{"".join(rows)}</ul>'
            f'<div style="{GREY}">À vérifier à la main : {e(MANUAL_CHECKS.split(" : ")[0])}.</div>')


def _posts_html(posts: list[dict]) -> str:
    if not posts:
        return "<i>aucun post source</i>"
    li = "".join(f'<li><a href="{e(p["url"] or "#")}">{e(p["title"])}</a> '
                 f'<span style="{GREY}">— {e(SOURCES_FR.get(p["source"], p["source"]))}, {e(str(p["author"]))}</span></li>'
                 for p in posts)
    return f'<ol style="margin:4px 0 4px 18px;padding:0">{li}</ol>'


def _alert_html(conn, cfg: Config, a, s: dict, d: date) -> tuple[str, list[str]]:
    key = a["narrative"]
    narr = cfg.narratives[key]
    _, why = classify_narrative(conn, cfg, key, s, d)
    posts = top_posts(conn, cfg, key, d)
    html = (
        f'<div style="border-left:4px solid #1a7f37;padding:4px 12px;margin:0 0 14px">'
        f'<div style="font-size:16px;font-weight:600">{e(narr.label)} {phase_badge(a["phase"])}</div>'
        f'<p style="margin:6px 0"><b>Pourquoi le radar sonne :</b> {e(why)} C\'est le profil « tôt » que cherche '
        f'le radar : l\'intérêt grandit chez les spécialistes avant que le prix ne bouge.</p>'
        f'<p style="margin:8px 0 2px"><b>1. Lire ces 3 posts</b> (5 min) : vrai sujet ou campagne ?</p>{_posts_html(posts)}'
        f'<p style="margin:8px 0 2px"><b>2. Regarder les tokens rattachés</b></p>{_tokens_html(token_report(conn, cfg, key))}'
        f'<p style="margin:8px 0 2px"><b>3. Noter ta décision</b> (ignorer, surveiller, entrer) et pourquoi, dans ton journal.</p>'
        f'</div>')
    text = [f"ALERTE {narr.label} — {why}"] + [f"  - {p['title']} ({p['url']})" for p in posts]
    return html, text


def _market_html(conn, cfg: Config, d: date) -> str:
    out = []
    # Ce que la foule regarde.
    trending = [r[0] for r in conn.execute(
        "SELECT item_id FROM trending_snapshots WHERE kind = 'coin' AND date = "
        "(SELECT max(date) FROM trending_snapshots WHERE date <= ?) GROUP BY item_id ORDER BY min(rank)",
        ((d + timedelta(days=1)).isoformat(),))]
    names = {r[0]: r[1] for r in conn.execute(
        "SELECT item_id, name FROM trending_snapshots WHERE kind = 'coin'")}
    owner = {t["id"]: n.label for n in cfg.narratives.values() for t in n.tokens}
    if trending:
        listed = ", ".join(
            f"<b>{e(names.get(t) or t)}</b> ({e(owner[t])})" if t in owner else e(names.get(t) or t)
            for t in trending[:10])
        mine = [t for t in trending if t in owner]
        out.append(
            f"<p style='margin:0 0 4px'><b>Ce que la foule regarde</b> — les tokens les plus recherchés sur "
            f"CoinGecko : {listed}.</p><p style='margin:0 0 12px;{GREY}'>"
            + ("En gras, ceux de tes narratifs : quand un narratif arrive ici, il est déjà repéré par le grand "
               "public crypto (signe de retard)." if mine else
               "Aucun token de tes narratifs : la foule regarde ailleurs, c'est plutôt bon signe.") + "</p>")

    # L'argent suit-il ? (TVL et revenus agrégés par narratif)
    lines = []
    for n in cfg.narratives.values():
        tvl = tvl7 = rev = 0.0
        for c in n.defillama_categories:
            r = conn.execute("SELECT * FROM defillama_snapshots WHERE category = ? AND date <= ? "
                             "ORDER BY date DESC LIMIT 1", (c, (d + timedelta(days=1)).isoformat())).fetchone()
            if r and r["tvl"]:
                tvl += r["tvl"]
                tvl7 += r["tvl"] / (1 + r["tvl_change_7d"] / 100) if r["tvl_change_7d"] is not None else r["tvl"]
                rev += r["revenue_24h"] or 0
        if not tvl:
            continue
        ch = (tvl / tvl7 - 1) * 100 if tvl7 else 0.0
        trend = "↗ en hausse" if ch >= 2 else ("↘ en baisse" if ch <= -2 else "→ stable")
        lines.append(f"<li><b>{e(n.label)}</b> : {usd(tvl)} déposés, {trend} ({fr_pct(ch)} en 7 j)"
                     + (f", {usd(rev)} de revenus par jour" if rev else "") + "</li>")
    if lines:
        out.append("<p style='margin:0 0 4px'><b>L'argent suit-il ?</b> — sommes déposées dans les protocoles "
                   "de chaque narratif (TVL, DefiLlama).</p>"
                   f"<ul style='margin:0 0 4px 18px;padding:0'>{''.join(lines)}</ul>"
                   f"<p style='margin:0 0 12px;{GREY}'>Un narratif dont on parle de plus en plus ET où l'argent "
                   "afflue est plus solide qu'un narratif porté par la seule conversation.</p>")

    # Levées de fonds.
    hi = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()) + 86400
    label = {k: n.label for k, n in cfg.narratives.items()}
    rows = conn.execute(
        """SELECT p.title, p.url, (SELECT group_concat(pn.narrative) FROM post_narratives pn
                                   WHERE pn.post_id = p.id) AS narr
           FROM posts p WHERE p.source = 'raises' AND p.created_at >= ? AND p.created_at < ?
           ORDER BY p.engagement DESC LIMIT 8""", (hi - 7 * 86400, hi)).fetchall()
    if rows:
        items = []
        for r in rows:
            tags = ", ".join(label.get(x, x) for x in (r["narr"] or "").split(",") if x)
            link = f'<a href="{e(r["url"])}">{e(r["title"])}</a>' if r["url"] else e(r["title"])
            items.append(f"<li>{link}" + (f' <span style="{GREY}">→ {e(tags)}</span>' if tags else "") + "</li>")
        out.append("<p style='margin:0 0 4px'><b>Où misent les fonds</b> — plus grosses levées de la semaine.</p>"
                   f"<ul style='margin:0 0 0 18px;padding:0'>{''.join(items)}</ul>")
    return "".join(out)


HOW_TO = (
    "<b>Comment lire ce rapport.</b> Une tendance crypto passe par 4 phases : "
    "<b>1</b> seuls les spécialistes en parlent (développeurs, chercheurs, fonds) — c'est là que le radar "
    "veut te prévenir ; <b>2</b> le sujet se diffuse ; <b>3</b> la foule crypto arrive (Reddit, tokens "
    "« tendance » sur CoinGecko) — trop tard pour entrer ; <b>4</b> le grand public s'en empare (presse, "
    "Wikipédia) — sommet probable. Une alerte part quand les mentions accélèrent chez les spécialistes alors "
    "que le prix des tokens n'a pas encore bougé. Au plus 2 alertes par jour.")


def build_daily(conn, cfg: Config, d: date) -> tuple[str, str, str]:
    scores = load_scores(conn, d)
    alerts = conn.execute("SELECT * FROM alerts WHERE date = ? ORDER BY kind, score DESC", (d.isoformat(),)).fetchall()
    entries = [a for a in alerts if a["kind"] == "entry"]
    late = [a for a in alerts if a["kind"] == "late"]
    label = {k: n.label for k, n in cfg.narratives.items()}
    groups: dict[str, list[tuple[str, dict, str]]] = {b[0]: [] for b in BUCKETS}
    for key, s in sorted(scores.items(), key=lambda x: -(x[1]["score"] or 0)):
        if key in cfg.narratives:
            bucket, sentence = classify_narrative(conn, cfg, key, s, d)
            groups[bucket].append((key, s, sentence))

    start = data_start(conn)
    history = (d - start).days + 1 if start else None
    parts, text = [], [f"Radar crypto — {date_fr(d)}", ""]

    # 1. En bref.
    brief = []
    if entries:
        brief.append(f"<b>{len(entries)} narratif{'s' if len(entries) > 1 else ''} à regarder aujourd'hui</b> : "
                     + ", ".join(e(label.get(a['narrative'], a['narrative'])) for a in entries) + ".")
    else:
        brief.append("<b>Pas d'alerte aujourd'hui</b> : aucun narratif ne réunit tous les critères.")
    if groups["early"]:
        others = [k for k, _, _ in groups["early"] if k not in {a["narrative"] for a in entries}]
        if others:
            brief.append("À garder à l'œil (ça monte, sans franchir le seuil) : "
                         + ", ".join(e(label[k]) for k in others) + ".")
    if late:
        brief.append("⏰ Passé en phase tardive aujourd'hui : "
                     + ", ".join(e(label.get(a['narrative'], a['narrative'])) for a in late) + ".")
    if history is not None and history < 14:
        ready = start + timedelta(days=13)
        brief.append(f"<span style='{GREY}'>Le radar a {history} jour{'s' if history > 1 else ''} d'historique : "
                     f"les accélérations deviennent mesurables après {MIN_COVERAGE_DAYS} jours et fiables vers le "
                     f"{ready.day} {MOIS[ready.month - 1]} (14 jours).</span>")
    parts.append(section("En bref", "<ul style='margin:0 0 0 18px;padding:0'>"
                         + "".join(f"<li style='margin-bottom:4px'>{b}</li>" for b in brief) + "</ul>"))
    text += [re.sub(r"<[^>]+>", "", b) for b in brief]

    # 2. Alertes.
    if entries:
        blocks = []
        for a in entries:
            html, t = _alert_html(conn, cfg, a, scores.get(a["narrative"], {}), d)
            blocks.append(html)
            text += [""] + t
        parts.append(section(f"🚨 Alerte{'s' if len(entries) > 1 else ''}", "".join(blocks)))

    # 3. Où en est chaque narratif.
    inner = []
    for key, title, hint in BUCKETS:
        items = groups[key]
        if not items:
            continue
        lis = "".join(
            f"<li style='margin-bottom:6px'><b>{e(label[k])}</b> — {e(sentence)}"
            + (f"<br><span style='{GREY}'>{e(_facts(s))}</span>" if key != "quiet" else "") + "</li>"
            for k, s, sentence in items)
        inner.append(f"<p style='margin:10px 0 2px'><b>{title}</b> <span style='{GREY}'>{hint}</span></p>"
                     f"<ul style='margin:0 0 0 18px;padding:0'>{lis}</ul>")
        text.append("")
        text.append(title)
        text += [f"  - {label[k]} : {sentence}" for k, _, sentence in items]
    parts.append(section("Où en est chaque narratif", "".join(inner)))

    # 4. Marché.
    market = _market_html(conn, cfg, d)
    if market:
        parts.append(section("Le marché en un coup d'œil", market))

    # 5. Santé de la collecte + mode d'emploi.
    counts, problems = collection_health(conn)
    health = ("Posts collectés sur 24 h : "
              + (", ".join(f"{SOURCES_FR.get(k, k)} {v}" for k, v in sorted(counts.items())) or "aucun") + ".")
    if problems:
        health += ('<ul style="margin:6px 0 0 18px;padding:0;color:#b42318">'
                   + "".join(f"<li>{e(p)}</li>" for p in problems[:10]) + "</ul>")
    parts.append(f'<div style="{GREY};margin:4px 2px 12px"><b>Santé de la collecte.</b> {health}</div>')
    parts.append(f'<div style="{GREY};margin:4px 2px">{HOW_TO}</div>')

    if entries:
        subject = (f"Radar crypto {d.strftime('%d/%m')} — 🚨 à regarder : "
                   + ", ".join(label.get(a["narrative"], a["narrative"]) for a in entries))
    elif groups["early"]:
        subject = (f"Radar crypto {d.strftime('%d/%m')} — pas d'alerte, ça monte : "
                   + ", ".join(label[k] for k, _, _ in groups["early"][:2]))
    else:
        subject = f"Radar crypto {d.strftime('%d/%m')} — pas d'alerte"
    title = f"Radar crypto — {date_fr(d)}"
    return subject, wrap(title, "".join(parts)), "\n".join(text)
