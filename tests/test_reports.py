from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from radar.__main__ import _in_window
from radar.discovery import Candidate, Candidates
from radar.report.daily import build_daily
from radar.report.weekly import build_weekly
from radar.scoring import run_scoring
from tests.test_scoring import END, build_history


def test_daily_and_weekly_reports(cfg, conn):
    build_history(conn)
    conn.execute("INSERT INTO market_snapshots (date, coin_id, price, market_cap, volume, circulating, total_supply, change_7d)"
                 " VALUES (?, 'ether-fi', 1.0, 5e8, 1e3, 1e8, 1e9, 1.0)", ((END + timedelta(days=1)).isoformat(),))
    conn.execute("INSERT INTO runs VALUES (strftime('%s','now'), 'farcaster', 'skipped', 0, 'NEYNAR_API_KEY absent')")
    from radar.db import upsert_post
    from tests.test_scoring import ts
    upsert_post(conn, {"id": "raise1", "source": "raises", "tier": "niche", "channel": "Seed", "author": "Paradigm",
                       "title": "RestakeCo lève 12.5 M$ (Seed) — Restaking", "url": "https://example.com/r",
                       "created_at": ts(END - timedelta(days=7)), "engagement": 12.5})
    conn.execute("INSERT INTO post_narratives VALUES ('raise1', 'restaking')")
    run_scoring(conn, cfg, END - timedelta(days=40), END)

    subject, html, text = build_daily(conn, cfg, END - timedelta(days=6))   # jour de l'alerte
    assert "à regarder" in subject and "Restaking" in subject
    # En bref, puis l'alerte expliquée en clair, puis les narratifs regroupés par situation.
    assert html.index("En bref") < html.index("Alerte") < html.index("Où en est chaque narratif")
    assert "Pourquoi le radar sonne" in html and "Mentions ×" in html and "prix des tokens encore calme" in html
    assert "1. Lire ces 3 posts" in html and "3. Noter ta décision" in html
    assert "Ça monte chez les spécialistes" in html
    assert "Ça monte, mais déjà au-delà des spécialistes" in html    # Memecoins : diffusion
    assert "Trop calme pour juger" in html                          # narratifs sans mentions
    assert "ETHFI" in html and "écarté" in html                     # offre 10 % + liquidité faible
    assert "NEYNAR_API_KEY absent" in html                          # santé de la collecte
    assert "Comment lire ce rapport" in html
    assert "Classement des narratifs" not in html and "MA7/MA30" not in html   # plus de jargon
    assert "ALERTE Restaking" in text
    assert "Où misent les fonds" in html and "RestakeCo lève 12.5 M$" in html
    # Le dernier jour, Memecoins est passé en phase tardive (pic Reddit + trending), avec la raison.
    _, html_end, _ = build_daily(conn, cfg, END)
    assert "Trop tard : la foule est déjà là" in html_end
    assert "PEPE fait partie des tokens les plus recherchés sur CoinGecko" in html_end

    fake = SimpleNamespace(messages=SimpleNamespace(parse=lambda **k: SimpleNamespace(
        parsed_output=Candidates(candidates=[Candidate(name="Prediction markets", terms=["prediction market"],
                                                       rationale="test")]))))
    conn.execute("INSERT INTO term_candidates VALUES ('prediction market', strftime('%s','now'), strftime('%s','now'), 4, '', 'new')")
    subject, html, text = build_weekly(conn, cfg, END, client=fake)
    assert "récap semaine" in subject
    assert "Top 5 accélérations" in html and "Restaking" in html
    assert "Prediction markets" in html
    assert "Bilan des alertes" in html and "entrée" in html


def test_send_window_summer_and_winter(cfg):
    paris = ZoneInfo("Europe/Paris")
    utc = ZoneInfo("UTC")
    def at(y, m, d, h, mi):
        return datetime(y, m, d, h, mi, tzinfo=utc).astimezone(paris)
    # Été (UTC+2) : le cron de 05:30 UTC tombe à 07:30 -> envoi ; celui de 06:30 UTC est dédoublonné.
    assert _in_window(cfg, "daily", at(2026, 7, 1, 5, 30))
    # Hiver (UTC+1) : 05:30 UTC = 06:30 -> trop tôt ; 06:30 UTC = 07:30 -> envoi.
    assert not _in_window(cfg, "daily", at(2026, 12, 1, 5, 30))
    assert _in_window(cfg, "daily", at(2026, 12, 1, 6, 30))
    # Hebdo : 06:00 UTC en hiver = 07:00 -> trop tôt ; 07:00 UTC = 08:00 -> envoi.
    assert not _in_window(cfg, "weekly", at(2026, 12, 7, 6, 0))
    assert _in_window(cfg, "weekly", at(2026, 12, 7, 7, 0))
    assert _in_window(cfg, "weekly", at(2026, 7, 6, 6, 0))
    # Cron GitHub parti avec 6 h de retard : l'email part quand même (anti-doublon en base).
    assert _in_window(cfg, "daily", at(2026, 9, 30, 12, 52))
    assert _in_window(cfg, "daily", at(2026, 9, 30, 21, 59))
    # Le récap n'est envoyé que le lundi, même si une collecte vérifie un autre jour.
    assert not _in_window(cfg, "weekly", at(2026, 12, 8, 7, 0))


def test_mailer(monkeypatch):
    import smtplib
    from radar.mailer import send_email
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, context=None, timeout=None):
            sent["host"] = (host, port)
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def login(self, u, p): sent["login"] = (u, p)
        def send_message(self, msg): sent["msg"] = msg

    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setenv("GMAIL_USER", "me@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop")
    monkeypatch.setenv("EMAIL_TO", "a@x.com, b@y.com")
    assert send_email("Sujet", "<b>hi</b>", "hi") == ["a@x.com", "b@y.com"]
    assert sent["host"] == ("smtp.gmail.com", 465)
    assert sent["login"] == ("me@gmail.com", "abcdefghijklmnop")
    assert sent["msg"]["To"] == "a@x.com, b@y.com"
