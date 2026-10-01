"""Tests des collecteurs sur des réponses d'API enregistrées (aucun appel réseau)."""
import json
import re
import time

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
def test_reddit_rss_fallback_without_credentials(cfg, conn):
    responses.get("https://www.reddit.com/r/CryptoCurrency/new/.rss", body=fixture("reddit_new.rss"))
    only(cfg, "reddit", subreddits=["CryptoCurrency"])
    res = get_collector("reddit")(conn, cfg)
    assert res.new == 2 and not res.errors
    row = conn.execute("SELECT * FROM posts WHERE id='reddit:1abc01'").fetchone()
    assert row["author"] == "alice_dev" and row["channel"] == "CryptoCurrency"
    assert row["body"] == "RWA TVL doubled this quarter. $ONDO leads."
    assert row["title"] == "Tokenized treasuries are quietly eating DeFi"
    # Aucun appel à l'API (ni jeton OAuth, ni /user/.../about).
    assert len(responses.calls) == 1


@responses.activate
def test_reddit_rss_blocked_is_skipped(cfg, conn):
    responses.get("https://www.reddit.com/r/CryptoCurrency/new/.rss", status=403)
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
    responses.get(re.compile(r"https://api\.coingecko\.com/api/v3/search\?query=PEPE"),
                  json={"coins": [{"id": "pepe-real", "symbol": "PEPE"}, {"id": "pepe-fake", "symbol": "PEPEX"}]})
    responses.get(re.compile(r"https://api\.coingecko\.com/api/v3/search.*"), json={"coins": []})
    res = get_collector("coingecko")(conn, cfg)
    assert conn.execute("SELECT count(*) FROM trending_snapshots").fetchone()[0] == 3
    assert [r[0] for r in conn.execute("SELECT category_id FROM category_snapshots")] == ["restaking"]
    m = conn.execute("SELECT * FROM market_snapshots WHERE coin_id='ondo-finance'").fetchone()
    assert m["change_7d"] == 4.2
    # Les ids absents de la réponse sont signalés, avec une suggestion d'id trouvée par symbole.
    assert any("introuvables" in e for e in res.errors)
    assert "pepe (essayer : pepe-real)" in res.errors[0]


# ---------------------------------------------------------------- DefiLlama
@responses.activate
def test_defillama(cfg, conn):
    now = int(time.time())
    protocols = fixture("llama_protocols.json") + [
        {"name": "Agentpay", "slug": "agentpay", "category": "Payments", "chains": ["Base"], "tvl": 2e6,
         "listedAt": now - 3 * 86400, "description": "x402 payments rail for AI agents"},
        {"name": "Oldie", "slug": "oldie", "category": "Dexs", "tvl": 1e6, "listedAt": now - 400 * 86400}]
    raises = {"raises": [
        {"date": now - 86400, "name": "RestakeCo", "round": "Seed", "amount": 12.5, "category": "Restaking",
         "sector": "Shared security for AVS operators", "chains": ["Ethereum"], "leadInvestors": ["Paradigm"],
         "otherInvestors": ["Coinbase Ventures"], "source": "https://example.com/raise"},
        {"date": now - 2 * 86400, "name": "Mystery", "round": None, "amount": None, "category": None,
         "leadInvestors": [], "otherInvestors": []},
        {"date": now - 800 * 86400, "name": "Ancient", "amount": 1, "leadInvestors": ["X"]}]}
    responses.get("https://api.llama.fi/protocols", json=protocols)
    responses.get("https://api.llama.fi/raises", json=raises)
    cfg.settings["collectors"]["defillama"]["raises"] = True       # désactivé par défaut (payant)
    responses.get(re.compile(r"https://api\.llama\.fi/overview/fees.*"), json=fixture("llama_fees.json"))
    res = get_collector("defillama")(conn, cfg)
    assert not res.errors
    # Nouveau protocole récent stocké comme un post ; l'ancien listing est ignoré.
    new = conn.execute("SELECT * FROM posts WHERE id='defillama:new:agentpay'").fetchone()
    assert new["source"] == "defillama" and new["tier"] == "niche" and "x402" in new["body"]
    assert conn.execute("SELECT count(*) FROM posts WHERE id LIKE 'defillama:new:%'").fetchone()[0] == 1
    # Levées de fonds : auteur = investisseur principal, montant en engagement ; > 365 j ignorées.
    r = conn.execute("SELECT * FROM posts WHERE source='raises' AND title LIKE 'RestakeCo%'").fetchone()
    assert r["author"] == "Paradigm" and r["engagement"] == 12.5
    assert r["title"] == "RestakeCo lève 12.5 M$ (Seed) — Restaking / Shared security for AVS operators"
    assert "Coinbase Ventures" in r["body"]
    assert conn.execute("SELECT count(*) FROM posts WHERE source='raises'").fetchone()[0] == 2
    r = conn.execute("SELECT * FROM defillama_snapshots WHERE category='Restaking'").fetchone()
    assert r["tvl"] == 11e9 and r["n_protocols"] == 2 and r["revenue_24h"] == 50000
    assert round(r["tvl_change_7d"], 1) == 22.2   # 11e9 / (8e9 + 1e9) - 1


@responses.activate
def test_network_error_becomes_http_error():
    import requests
    from radar.http import HttpError, get_json, make_session
    responses.get("https://down.example/x", body=requests.ConnectionError("boom"))
    with pytest.raises(HttpError) as exc:
        get_json(make_session(), "https://down.example/x", retries=1)
    assert exc.value.status == 0


# ---------------------------------------------------------------- Hacker News
@responses.activate
def test_hackernews(cfg, conn):
    now = int(time.time())
    hits = {"nbPages": 1, "hits": [
        {"objectID": "101", "title": "Stablecoin payments rails are eating cross-border fintech",
         "url": "https://example.com/a", "author": "pg_fan", "points": 120, "num_comments": 45, "created_at_i": now - 3600},
        {"objectID": "102", "title": "A new post-quantum cryptography library",      # cryptographie != crypto
         "url": "https://example.org/pq", "author": "x", "points": 50, "num_comments": 3, "created_at_i": now - 7200},
        {"objectID": "103", "title": "Ask HN: anyone building onchain AI agents?", "story_text": "<p>Curious.</p>",
         "url": None, "author": "y", "points": 8, "num_comments": 9, "created_at_i": now - 600}]}
    responses.get(re.compile(r"https://hn\.algolia\.com/api/v1/search_by_date.*"), json=hits)
    only(cfg, "hackernews", queries=["crypto", "stablecoin"])
    res = get_collector("hackernews")(conn, cfg)
    assert res.new == 2 and not res.errors                       # 101 et 103 ; dédoublonnés entre requêtes
    row = conn.execute("SELECT * FROM posts WHERE id='hackernews:103'").fetchone()
    assert row["body"] == "Curious." and row["url"] == "https://news.ycombinator.com/item?id=103"
    assert conn.execute("SELECT channel FROM posts WHERE id='hackernews:101'").fetchone()[0] == "example.com"
    q = responses.calls[0].request.url
    assert "tags=story" in q and "points%3E%3D3" in q


# ---------------------------------------------------------------- Snapshot
@responses.activate
def test_snapshot(cfg, conn):
    now = int(time.time())
    props = {"data": {"proposals": [
        {"id": "0xabc", "title": "[ARFC] Onboard tokenized treasuries as collateral", "body": "RWA collateral...",
         "created": now - 86400, "author": "0xproposer", "votes": 340, "scores_total": 1.2e6, "state": "active",
         "link": "https://snapshot.box/#/s:aave.eth/proposal/0xabc", "space": {"id": "aave.eth", "name": "Aave"}},
        {"id": "0xspam", "title": "Claim your airdrop", "body": "", "created": now - 3600, "author": "0xs",
         "votes": 1, "space": {"id": "spam.eth", "name": "Spam"}}]}}
    responses.post("https://hub.snapshot.org/graphql", json=props)
    res = get_collector("snapshot")(conn, cfg)
    assert res.new == 1 and not res.errors
    row = conn.execute("SELECT * FROM posts WHERE id='snapshot:0xabc'").fetchone()
    assert row["author"] == "aave.eth" and row["channel"] == "Aave" and row["engagement"] == 340
    body = json.loads(responses.calls[0].request.body)
    assert body["variables"]["first"] == 1000 and "proposals" in body["query"]


@responses.activate
def test_snapshot_graphql_error(cfg, conn):
    responses.post("https://hub.snapshot.org/graphql", json={"errors": [{"message": "Unknown field"}]})
    res = get_collector("snapshot")(conn, cfg)
    assert res.new == 0 and "Unknown field" in res.errors[0]


# ---------------------------------------------------------------- Wikipédia
@responses.activate
def test_wikipedia(cfg, conn):
    items = {"items": [{"article": "Stablecoin", "timestamp": "2026092900", "views": 4200},
                       {"article": "Stablecoin", "timestamp": "2026093000", "views": 5100}]}
    responses.get(re.compile(r"https://wikimedia\.org/.*/Stablecoin/daily/.*"), json=items)
    responses.get(re.compile(r"https://wikimedia\.org/.*"), status=404)
    for n in cfg.narratives.values():
        n.wikipedia_articles = ["Stablecoin"] if n.key == "stablecoins_payments" else (
            ["Not_an_article"] if n.key == "rwa" else [])
    res = get_collector("wikipedia")(conn, cfg)
    assert res.new == 2
    assert dict(conn.execute("SELECT date, views FROM wiki_pageviews").fetchall()) == {
        "2026-09-29": 4200, "2026-09-30": 5100}
    assert "Not_an_article" in res.errors[0]
    assert "User-Agent" in responses.calls[0].request.headers


@responses.activate
def test_reddit_rss_retries_after_429(cfg, conn):
    responses.get("https://www.reddit.com/r/CryptoCurrency/new/.rss", status=429)
    responses.get("https://www.reddit.com/r/CryptoCurrency/new/.rss", body=fixture("reddit_new.rss"))
    responses.get("https://www.reddit.com/r/altcoin/new/.rss", status=429)
    only(cfg, "reddit", subreddits=["CryptoCurrency", "altcoin"])
    res = get_collector("reddit")(conn, cfg)
    assert res.new == 2                                     # réussi au 2e essai
    assert res.errors == ["r/altcoin: HTTP 429 malgré 3 essais"]
