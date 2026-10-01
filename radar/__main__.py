"""Point d'entrée : python -m radar <commande>.

  collect  [--only reddit,github] [--db chemin] [--sample N]   collecte + pré-filtre + classification
  score    [--date AAAA-MM-JJ] [--days N]                      scoring (N jours se terminant à --date)
  daily    [--force] [--dry-run] [--no-score]                  scoring de la veille + email quotidien
  weekly   [--force] [--dry-run]                               récap hebdomadaire
  status                                                       état de la base et des dernières exécutions
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .classify import classify_pending
from .collectors import NAMES, get_collector
from .collectors.base import SkipCollector
from .config import ROOT, load_config
from .db import connect, log_run
from .process import mark_duplicates, prefilter_new_posts

log = logging.getLogger("radar")


def _conn(cfg, db: str | None):
    return connect(Path(db) if db else cfg.db_path)


def cmd_collect(args, cfg) -> int:
    conn = _conn(cfg, args.db)
    names = args.only.split(",") if args.only else [n for n in NAMES if cfg.collector(n).get("enabled", True)]
    failures = 0
    for name in names:
        started = time.time()
        try:
            res = get_collector(name)(conn, cfg)
        except SkipCollector as exc:
            log.warning("%s sauté : %s", name, exc)
            log_run(conn, name, "skipped", 0, str(exc))
            continue
        except Exception as exc:  # un collecteur en panne ne bloque pas les autres
            log.exception("%s en erreur", name)
            log_run(conn, name, "error", 0, f"{type(exc).__name__}: {exc}")
            failures += 1
            continue
        log.info("%s (%.0fs)", res, time.time() - started)
        log_run(conn, name, "error" if res.errors and not res.new else "ok", res.new, " | ".join(res.errors))
        if res.errors and not res.new:
            failures += 1

    n_matched = prefilter_new_posts(conn, cfg)
    n_dup = mark_duplicates(conn, cfg)
    stats = classify_pending(conn, cfg)
    log.info("Pré-filtre : %d posts matchés, %d quasi-doublons. Classification : %s", n_matched, n_dup, stats)
    log_run(conn, "classify", "ok" if not stats["failed_batches"] else "error", stats["llm"] + stats["fallback"],
            f"{stats}")

    if args.sample:
        print(f"\n--- {args.sample} derniers posts collectés ---")
        q = "SELECT source, channel, author, title, body, matched FROM posts"
        params: list = []
        if args.only:
            q += f" WHERE source IN ({','.join('?' * len(names))})"
            params = names
        for r in conn.execute(q + " ORDER BY collected_at DESC, created_at DESC LIMIT ?", (*params, args.sample)):
            print(f"[{r['source']}/{r['channel']}] {r['author']}: {(r['title'] or r['body'] or '')[:100]!r} "
                  f"-> {r['matched']}")
    # Échec global uniquement si tous les collecteurs lancés sont en erreur (notification GitHub).
    return 1 if failures and failures == len(names) else 0


def _parse_date(s: str | None, cfg) -> date:
    if s:
        return date.fromisoformat(s)
    # Par défaut : la veille (dernier jour UTC complet).
    return datetime.now(ZoneInfo("UTC")).date() - timedelta(days=1)


def cmd_score(args, cfg) -> int:
    from .scoring import run_scoring
    conn = _conn(cfg, args.db)
    end = _parse_date(args.date, cfg)
    results = run_scoring(conn, cfg, end - timedelta(days=args.days - 1), end)
    last = results[end]
    for n, r in sorted(last.items(), key=lambda x: -x[1]["score"]):
        print(f"{n:<22} phase {r['phase']}  score {r['score']:+.2f}  V {r['v'] if r['v'] is None else round(r['v'], 2)}"
              f"  Q {r['q'] if r['q'] is None else round(r['q'], 2)}  {'ALERTE' if r['alert'] else ''} {r['flags']}")
    log_run(conn, "score", "ok", len(results), f"{end - timedelta(days=args.days - 1)}..{end}")
    return 0


def _in_window(cfg, kind: str, now: datetime) -> bool:
    if kind == "weekly" and now.weekday() != 0:   # récap le lundi uniquement
        return False
    lo, hi = cfg.settings["email"][f"{kind}_window"]
    hhmm = now.strftime("%H:%M")
    return lo <= hhmm < hi


def _send(args, cfg, kind: str, build) -> int:
    from .mailer import send_email
    conn = _conn(cfg, args.db)
    now = datetime.now(ZoneInfo(cfg.settings["timezone"]))
    today = now.date().isoformat()
    if not args.force and not args.dry_run:
        if not _in_window(cfg, kind, now):
            log.info("Hors fenêtre d'envoi (%s heure de Paris) : rien à faire", now.strftime("%H:%M"))
            return 0
        if conn.execute("SELECT 1 FROM email_log WHERE kind = ? AND date = ?", (kind, today)).fetchone():
            log.info("Email %s déjà envoyé aujourd'hui", kind)
            return 0
    d = _parse_date(args.date, cfg)
    if kind == "daily" and not args.no_score:
        from .scoring import run_scoring
        run_scoring(conn, cfg, d, d)
    subject, html, text = build(conn, cfg, d)
    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    (out / f"{kind}.html").write_text(html)
    if args.dry_run:
        print(subject)
        print(text)
        print(f"\nAperçu HTML : {out / f'{kind}.html'}")
        return 0
    recipients = send_email(subject, html, text)
    conn.execute("INSERT OR REPLACE INTO email_log VALUES (?, ?, ?)", (kind, today, int(time.time())))
    log_run(conn, f"email_{kind}", "ok", len(recipients), subject)
    log.info("Email envoyé à %s : %s", ", ".join(recipients), subject)
    return 0


def cmd_daily(args, cfg) -> int:
    from .report.daily import build_daily
    return _send(args, cfg, "daily", build_daily)


def cmd_weekly(args, cfg) -> int:
    from .report.weekly import build_weekly
    return _send(args, cfg, "weekly", build_weekly)


def cmd_status(args, cfg) -> int:
    conn = _conn(cfg, args.db)
    print("Posts par source :")
    for r in conn.execute("SELECT source, count(*), datetime(max(created_at), 'unixepoch') FROM posts GROUP BY source"):
        print(f"  {r[0]:<10} {r[1]:>7}  dernier : {r[2]}")
    print("Posts par état de classification (0 attente, 1 LLM, 2 repli, 3 hors narratif) :")
    for r in conn.execute("SELECT classified, count(*) FROM posts GROUP BY classified"):
        print(f"  {r[0]}: {r[1]}")
    print("Mentions par narratif (7 derniers jours) :")
    for r in conn.execute(
            """SELECT pn.narrative, count(*) FROM post_narratives pn JOIN posts p ON p.id = pn.post_id
               WHERE p.created_at >= strftime('%s','now') - 7*86400 GROUP BY pn.narrative ORDER BY 2 DESC"""):
        print(f"  {r[0]:<22} {r[1]}")
    print("Dernières exécutions :")
    for r in conn.execute("SELECT datetime(ts, 'unixepoch'), step, status, n_items, message FROM runs "
                          "ORDER BY ts DESC LIMIT 15"):
        print(f"  {r[0]}  {r[1]:<10} {r[2]:<8} {r[3]:>5}  {(r[4] or '')[:90]}")
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="python -m radar", description="Radar crypto")
    p.add_argument("--db", help="Chemin de la base SQLite (défaut : data/radar.db)")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("collect", help="Collecte + pré-filtre + classification")
    c.add_argument("--only", help=f"Collecteurs à lancer, séparés par des virgules ({','.join(NAMES)})")
    c.add_argument("--sample", type=int, default=0, help="Afficher les N derniers posts collectés")
    c.set_defaults(fn=cmd_collect)

    s = sub.add_parser("score", help="Calcul des scores")
    s.add_argument("--date", help="Dernier jour à scorer (défaut : hier, UTC)")
    s.add_argument("--days", type=int, default=1, help="Nombre de jours à (re)calculer (backtest)")
    s.set_defaults(fn=cmd_score)

    for name, fn in (("daily", cmd_daily), ("weekly", cmd_weekly)):
        e = sub.add_parser(name, help=f"Email {name}")
        e.add_argument("--force", action="store_true", help="Ignorer la fenêtre horaire et l'anti-doublon")
        e.add_argument("--dry-run", action="store_true", help="Générer out/<type>.html sans envoyer")
        e.add_argument("--date", help="Jour de référence (défaut : hier, UTC)")
        e.add_argument("--no-score", action="store_true", help=argparse.SUPPRESS)
        e.set_defaults(fn=fn)

    st = sub.add_parser("status", help="État de la base")
    st.set_defaults(fn=cmd_status)

    args = p.parse_args(argv)
    cfg = load_config()
    return args.fn(args, cfg)


if __name__ == "__main__":
    sys.exit(main())
