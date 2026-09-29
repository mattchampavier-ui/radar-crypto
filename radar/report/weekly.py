"""Récap hebdomadaire (lundi) : top 5 accélérations, narratifs candidats, bilan des alertes."""
from __future__ import annotations

import statistics
from datetime import date, timedelta

from ..config import Config
from ..discovery import accelerating_terms, group_candidates, llm_terms
from .common import e, load_scores, num, pct, phase_badge, section, table, wrap


def _basket_change(conn, cfg: Config, narrative: str, since: date, until: date):
    changes = []
    for t in cfg.narratives[narrative].tokens:
        a = conn.execute("SELECT price FROM market_snapshots WHERE coin_id=? AND date>=? AND price IS NOT NULL "
                         "ORDER BY date LIMIT 1", (t["id"], since.isoformat())).fetchone()
        b = conn.execute("SELECT price FROM market_snapshots WHERE coin_id=? AND date<=? AND price IS NOT NULL "
                         "ORDER BY date DESC LIMIT 1", (t["id"], until.isoformat())).fetchone()
        if a and b and a[0]:
            changes.append((b[0] / a[0] - 1) * 100)
    return statistics.fmean(changes) if changes else None


def build_weekly(conn, cfg: Config, d: date, client=None) -> tuple[str, str, str]:
    label = {k: n.label for k, n in cfg.narratives.items()}
    now_scores, week_ago = load_scores(conn, d), load_scores(conn, d - timedelta(days=7))
    parts, text = [], [f"Radar crypto — récap semaine au {d.isoformat()}", ""]

    # 1. Top 5 accélérations (A_t = V_t - V_{t-7}), avec évolution du score sur la semaine.
    acc = sorted(((n, s) for n, s in now_scores.items() if s["a"] is not None), key=lambda x: -x[1]["a"])[:5]
    rows = []
    for n, s in acc:
        prev = week_ago.get(n, {})
        rows.append([f"<b>{e(label.get(n, n))}</b>", phase_badge(s["phase"]), num(s["a"], "{:+.2f}"),
                     num(s["v"]), f"{num(prev.get('score'))} → <b>{num(s['score'])}</b>", pct(s["r7"])])
        text.append(f"- {label.get(n, n)} : A {s['a']:+.2f}, score {num(prev.get('score'))} -> {s['score']:.2f}")
    parts.append(section("Top 5 accélérations", table(
        ["Narratif", "Phase", "Accélération", "V", "Score (S-1 → S)", "Panier 7 j"], rows)
        if rows else "<i>Pas encore assez d'historique (A nécessite 37 jours de données).</i>"))

    # 2. Narratifs candidats.
    acc_terms = accelerating_terms(conn, cfg)
    proposed = llm_terms(conn)
    terms = [t["term"] for t in proposed] + [t["term"] for t in acc_terms]
    candidates = group_candidates(cfg, terms, client=client)
    inner = ""
    if candidates:
        inner += "<ol style='margin:0 0 8px 18px;padding:0'>" + "".join(
            f"<li><b>{e(c.name)}</b> — {e(c.rationale)}<br><span style='color:#57606a'>{e(', '.join(c.terms))}</span></li>"
            for c in candidates) + "</ol>"
        text += ["", "Narratifs candidats :"] + [f"- {c.name} : {', '.join(c.terms)}" for c in candidates]
    if proposed:
        inner += "<p><b>Termes proposés par le LLM</b> : " + e(", ".join(
            f"{t['term']} ({t['count']})" for t in proposed[:15])) + "</p>"
    if acc_terms:
        inner += "<p><b>Bigrammes en accélération</b> (7 j vs 21 j) : " + e(", ".join(
            f"{t['term']} ×{t['ratio']}" for t in acc_terms[:15])) + "</p>"
    parts.append(section("Nouveaux narratifs candidats", inner or "<i>Rien de notable cette semaine.</i>")
                 .replace("</h2>", "</h2><div style='color:#6e7781;font-size:12px;margin-bottom:6px'>À valider : "
                          "ajouter un bloc dans config/narratives.yaml pour le suivre.</div>", 1))

    # 3. Bilan des alertes des 4 dernières semaines.
    alerts = conn.execute("SELECT * FROM alerts WHERE date > ? AND date <= ? ORDER BY date DESC",
                          ((d - timedelta(days=28)).isoformat(), d.isoformat())).fetchall()
    rows = []
    for a in alerts:
        cur = now_scores.get(a["narrative"], {})
        since = date.fromisoformat(a["date"])
        rows.append([e(a["date"]), f"<b>{e(label.get(a['narrative'], a['narrative']))}</b>",
                     "entrée" if a["kind"] == "entry" else "retard",
                     f"{phase_badge(a['phase'])} → {phase_badge(cur['phase']) if cur else '–'}",
                     f"{num(a['score'])} → {num(cur.get('score'))}",
                     pct(_basket_change(conn, cfg, a["narrative"], since, d))])
    parts.append(section("Bilan des alertes (4 semaines)", table(
        ["Date", "Narratif", "Type", "Phase (alerte → auj.)", "Score", "Panier depuis"], rows)
        if rows else "<i>Aucune alerte sur la période.</i>"))
    text.append(f"\n{len(alerts)} alerte(s) sur 4 semaines.")

    subject = f"Radar crypto — récap semaine du {(d - timedelta(days=6)).strftime('%d/%m')} au {d.strftime('%d/%m')}"
    return subject, wrap(subject, "".join(parts)), "\n".join(text)
