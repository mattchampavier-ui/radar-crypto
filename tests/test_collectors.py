"""Tests des collecteurs sur des réponses d'API enregistrées (aucun appel réseau)."""
import re

import pytest
import responses

from radar.collectors import get_collector
from radar.collectors.base import SkipCollector
from tests.conftest import fixture


def only(cfg, name, **overrides):
    cfg.settings["collectors"][name].update(overrides)
    return cfg


# ---------------------------------------------------------------- Reddit
@responses.activate
def test_reddit_oauth(cfg, conn, monkeypatch):
    monkeypatch.setenv("REDDIT_CLIENT_ID", "id")
    monkeypatch.setenv("REDDIT_CLIENT_SECRET", "secret")
    responses.post("https://www.reddit.com/api/v1/access_token", json={"access_token": "tok"})
    responses.get("https://oauth.reddit.com/r/CryptoCurrency/new", json=fixture("reddit_new.json"))
    responses.get("https://oauth.reddit.com/user/alice_dev/about", json=fixture("reddit_user.json"))
    only(cfg, "reddit", subreddits=["CryptoCurrency"])

    res = get_collector("reddit")(conn, cfg)
    assert res.new == 3 and not res.errors
    row = conn.execute("SELECT * FROM posts WHERE id='reddit:1abc01'").fetchone()
    assert row["tier"] == "retail" and row["channel"] == "CryptoCurrency" and row["engagement"] == 42
    assert responses.calls[1].request.headers["Authorization"] == "bearer tok"
    # Seul l'auteur d'un post pré-filtré (RWA) est vérifié ; "[deleted]" est ignoré.
    a = conn.execute("SELECT * FROM authors WHERE author='alice_dev'").fetchone()
    assert a["karma"] == 5321 and a["created_at"] == 1600000000

    # Second passage : tout est déjà connu, rien de nouveau.
    responses.get("https://oauth.reddit.com/r/CryptoCurrency/new", json=fixture("reddit_new.json"))
    res2 = get_collector("reddit")(conn, cfg)
    assert res2.new == 0 and res2.seen == 3


@responses.activate
def test_reddit_public_blocked_is_skipped(cfg, conn):
    responses.get("https://www.reddit.com/r/CryptoCurrency/new.json", status=403)
    only(cfg, "reddit", subreddits=["CryptoCurrency"])
    with pytest.raises(SkipCollector):
        get_collector("reddit")(conn, cfg)


# ---------------------------------------------------------------- GitHub
@responses.activate
def test_github(cfg, conn, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghtok")
    responses.get(re.compile(r"https://api\.github\.com/search/repositories.*"), json=fixture("github_search.json"))
    responses.get(re.compile(r"https://api\.github\.com/users/.*"), json=fixture("github_user.json"))

    res = get_collector("github")(conn, cfg)
    ids = {r["id"] for r in conn.execute("SELECT id FROM posts")}
    # Le repo "todo app" sans contexte crypto est écarté.
    assert ids == {"github:901", "github:903"}
    assert res.new == 2
    q = responses.calls[0].request.url
    assert "created%3A%3E%3D" in q and "fork%3Afalse" in q
    assert responses.calls[0].request.headers["Authorization"] == "Bearer ghtok"
    assert conn.execute("SELECT count(*) FROM authors WHERE source='github'").fetchone()[0] == 2


# ---------------------------------------------------------------- Farcaster
def test_farcaster_skipped_without_key(cfg, conn):
    with pytest.raises(SkipCollector):
        get_collector("farcaster")(conn, cfg)


@responses.activate
def test_farcaster(cfg, conn, monkeypatch):
    monkeypatch.setenv("NEYNAR_API_KEY", "k")
    responses.get(re.compile(r"https://api\.neynar\.com/v2/farcaster/feed/channels.*"), json=fixture("neynar_channel.json"))
    only(cfg, "farcaster", channels=["ethereum"])
    res = get_collector("farcaster")(conn, cfg)
    assert res.new == 2
    assert responses.calls[0].request.headers["x-api-key"] == "k"
    a = conn.execute("SELECT * FROM authors WHERE author='spammer'").fetchone()
    assert a["followers"] == 3 and a["following"] == 5000


@responses.activate
def test_farcaster_paid_plan_skipped(cfg, conn, monkeypatch):
    monkeypatch.setenv("NEYNAR_API_KEY", "k")
    responses.get(re.compile(r"https://api\.neynar\.com/.*"), status=402)
    with pytest.raises(SkipCollector):
        get_collector("farcaster")(conn, cfg)


# ---------------------------------------------------------------- RSS
@responses.activate
def test_rss(cfg, conn, monkeypatch):
    import feedparser
    monkeypatch.setattr(feedparser, "parse", lambda url, agent=None: feedparser.api.parse(fixture("feed.xml")))
    only(cfg, "rss", feeds=[{"name": "Test", "url": "https://example.org/feed", "tier": "niche"}])
    res = get_collector("rss")(conn, cfg)
    assert res.new == 2
    row = conn.execute("SELECT * FROM posts WHERE title LIKE '%verifiable%'").fetchone()
    assert row["body"] == "Decentralized AI needs zkML ." and row["tier"] == "niche"
    assert get_collector("rss")(conn, cfg).new == 0


# ---------------------------------------------------------------- CoinGecko
@responses.activate
def test_coingecko(cfg, conn):
    responses.get("https://api.coingecko.com/api/v3/search/trending", json=fixture("cg_trending.json"))
    responses.get("https://api.coingecko.com/api/v3/coins/categories", json=fixture("cg_categories.json"))
    responses.get(re.compile(r"https://api\.coingecko\.com/api/v3/coins/markets.*"), json=fixture("cg_markets.json"))
    res = get_collector("coingecko")(conn, cfg)
    assert conn.execute("SELECT count(*) FROM trending_snapshots").fetchone()[0] == 3
    assert [r[0] for r in conn.execute("SELECT category_id FROM category_snapshots")] == ["restaking"]
    m = conn.execute("SELECT * FROM market_snapshots WHERE coin_id='ondo-finance'").fetchone()
    assert m["change_7d"] == 4.2
    # Les ids absents de la réponse sont signalés pour correction de la config.
    assert any("introuvables" in e for e in res.errors)


# ---------------------------------------------------------------- DefiLlama
@responses.activate
def test_defillama(cfg, conn):
    responses.get("https://api.llama.fi/protocols", json=fixture("llama_protocols.json"))
    responses.get(re.compile(r"https://api\.llama\.fi/overview/fees.*"), json=fixture("llama_fees.json"))
    res = get_collector("defillama")(conn, cfg)
    assert not res.errors
    r = conn.execute("SELECT * FROM defillama_snapshots WHERE category='Restaking'").fetchone()
    assert r["tvl"] == 11e9 and r["n_protocols"] == 2 and r["revenue_24h"] == 50000
    assert round(r["tvl_change_7d"], 1) == 22.2   # 11e9 / (8e9 + 1e9) - 1
