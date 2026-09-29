"""Email quotidien : alertes (si seuil franchi), alertes de retard, classement des narratifs."""
from __future__ import annotations

import json
from datetime import date

from ..config import Config
from ..tokens import MANUAL_CHECKS, token_report
from .common import (collection_health, e, flags_text, load_scores, num, pct, phase_badge, section,
                     table, top_posts, usd, wrap)


def _tokens_html(items: list[dict]) -> str:
    rows = []
    for t in items:
        status = ("✅ passe le filtre" if t["passed"] else "⛔ exclu : " + ", ".join(t["reasons"]))
        rows.append(f"<li><b>{e(t['symbol'])}</b> · 7 j {pct(t.get('change_7d'))} · "
                    f"cap. {usd(t.get('market_cap'))} · vol. {usd(t.get('volume'))} — {e(status)}</li>")
    return (f'<ul style="margin:4px 0 4px 18px;padding:0">{"".join(rows)}</ul>'
            f'<div style="color:#6e7781;font-size:12px">{e(MANUAL_CHECKS)}</div>')


def _posts_html(posts: list[dict]) -> str:
    if not posts:
        return "<i>aucun post source</i>"
    li = "".join(f'<li><a href="{e(p["url"] or "#")}">{e(p["title"])}</a> '
                 f'<span style="color:#6e7781">— {e(p["source"])}/{e(str(p["channel"]))}, {e(str(p["author"]))}</span></li>'
                 for p in posts)
    return f'<ol style="margin:4px 0 4px 18px;padding:0">{li}</ol>'


def build_daily(conn, cfg: Config, d: date) -> tuple[str, str, str]:
    scores = load_scores(conn, d)
    alerts = conn.execute("SELECT * FROM alerts WHERE date = ? ORDER BY kind, score DESC", (d.isoformat(),)).fetchall()
    entries = [a for a in alerts if a["kind"] == "entry"]
    late = [a for a in alerts if a["kind"] == "late"]
    label = {k: n.label for k, n in cfg.narratives.items()}

    def name(a) -> str:
        return label.get(a["narrative"], a["narrative"])
    parts, text = [], [f"Radar crypto — {d.isoformat()}", ""]

    # 1. Alertes d'entrée.
    if entries:
        blocks = []
        for a in entries:
            s = scores.get(a["narrative"], {})
            posts = top_posts(conn, cfg, a["narrative"], d)
            blocks.append(
                f'<div style="border-left:4px solid #1a7f37;padding:6px 10px;margin:0 0 12px">'
                f'<div style="font-size:15px"><b>{e(name(a))}</b> {phase_badge(a["phase"])} '
                f'score <b>{num(a["score"])}</b></div>'
                f'<div style="color:#57606a">V {num(s.get("v"))} · A {num(s.get("a"))} · B {num(s.get("b"))} · '
                f'Q {num(s.get("q"), "{:.0%}")} · divergence {num(s.get("d"))} · panier 7 j {pct(s.get("r7"))}</div>'
                f'<div style="margin-top:6px"><b>3 posts sources</b>{_posts_html(posts)}</div>'
                f'<div><b>Tokens rattachés</b>{_tokens_html(token_report(conn, cfg, a["narrative"]))}</div></div>')
            text.append(f"ALERTE {name(a)} — phase {a['phase']}, score {a['score']:.2f}")
            text += [f"  - {p['title']} ({p['url']})" for p in posts]
        parts.append(section(f"🚨 Alertes narratif ({len(entries)})", "".join(blocks)))
    else:
        parts.append(section("Alertes narratif", "<i>Aucun seuil franchi aujourd'hui.</i>"))
        text.append("Aucune alerte aujourd'hui.")

    # 2. Alertes de retard.
    if late:
        li = "".join(
            f"<li><b>{e(name(a))}</b> : phase {json.loads(a['payload'])['from_phase']} → "
            f"{phase_badge(a['phase'])} — fenêtre qui se referme</li>" for a in late)
        parts.append(section("⏰ Alertes de retard", f'<ul style="margin:0 0 0 18px;padding:0">{li}</ul>'))
        text += [f"RETARD {name(a)} -> phase {a['phase']}" for a in late]

    # 3. Classement.
    ranked = sorted(scores.items(), key=lambda x: -(x[1]["score"] or 0))
    rows = []
    text.append("")
    text.append("Classement :")
    for i, (n, s) in enumerate(ranked[: cfg.settings["email"]["top_n"]], 1):
        rows.append([str(i), f"<b>{e(label.get(n, n))}</b>", phase_badge(s["phase"]), f"<b>{num(s['score'])}</b>",
                     num(s["v"]), num(s["a"]), num(s["b"]), num(s["q"], "{:.0%}"), num(s["sov"], "{:.1%}"),
                     pct(s["r7"]), num(s["ma7"] * 7, "{:.0f}"),
                     f'<span style="color:#6e7781;font-size:12px">{e(flags_text(s["flags"]))}</span>'])
        text.append(f"{i:>2}. {label.get(n, n):<35} phase {s['phase']}  score {s['score']:+.2f}  "
                    f"V {num(s['v'])}  Q {num(s['q'], '{:.0%}')}")
    parts.append(section("Classement des narratifs", table(
        ["#", "Narratif", "Phase", "Score", "V", "A", "B", "Q", "SoV", "Panier 7 j", "Mentions 7 j", "Drapeaux"],
        rows) + '<div style="color:#6e7781;font-size:12px;margin-top:6px">V = MA7/MA30 des mentions pondérées · '
        "A = V − V(t−7) · B = diversité des auteurs · Q = part des sources niche · SoV = part de voix</div>"))

    # 4. Contexte marché et santé de la collecte.
    trending = [r[0] for r in conn.execute(
        "SELECT DISTINCT name FROM trending_snapshots WHERE date = (SELECT max(date) FROM trending_snapshots) "
        "AND kind = 'coin' ORDER BY rank LIMIT 10")]
    tvl_rows = []
    for n in cfg.narratives.values():
        for c in n.defillama_categories:
            r = conn.execute("SELECT * FROM defillama_snapshots WHERE category = ? ORDER BY date DESC LIMIT 1",
                             (c,)).fetchone()
            if r:
                tvl_rows.append([e(n.label), e(c), usd(r["tvl"]), pct(r["tvl_change_7d"]), usd(r["revenue_24h"])])
    ctx = ""
    if trending:
        ctx += f"<p><b>CoinGecko trending</b> : {e(', '.join(t or '?' for t in trending))}</p>"
    if tvl_rows:
        ctx += table(["Narratif", "Catégorie DefiLlama", "TVL", "TVL 7 j", "Revenus 24 h"], tvl_rows)
    if ctx:
        parts.append(section("Contexte marché", ctx))

    counts, problems = collection_health(conn)
    health = "Posts collectés sur 24 h : " + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "aucun")
    if problems:
        health += '<ul style="margin:6px 0 0 18px;padding:0;color:#b42318">' + "".join(
            f"<li>{e(p)}</li>" for p in problems[:10]) + "</ul>"
    parts.append(section("Santé de la collecte", health))

    n_alerts = len(entries)
    subject = f"Radar crypto {d.strftime('%d/%m')} — " + (
        f"🚨 {n_alerts} alerte{'s' if n_alerts > 1 else ''} : " + ", ".join(name(a) for a in entries)
        if entries else "pas d'alerte" + (f", top : {label.get(ranked[0][0], ranked[0][0])}" if ranked else ""))
    return subject, wrap(f"Radar crypto — {d.strftime('%d/%m/%Y')}", "".join(parts)), "\n".join(text)
