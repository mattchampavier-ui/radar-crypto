"""Reddit : derniers posts des subreddits configurés (phase 3, alarme d'arrivée des particuliers).

Deux modes :
- OAuth "application-only" (client_credentials) si REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET sont
  définis. Depuis la "Responsible Builder Policy", Reddit doit d'abord valider l'accès à l'API.
- Sinon, flux RSS publics des subreddits (sans clé) : pas de score ni d'âge des comptes, mais les
  mentions et les auteurs uniques suffisent pour l'alarme de phase 3. Si Reddit bloque ces flux
  (HTTP 403/429), le collecteur est sauté proprement.
"""
from __future__ import annotations

import calendar
import logging
import time

import feedparser
import requests

from ..config import Config, env
from ..db import upsert_post
from ..http import HttpError, get_json, make_session
from ..prefilter import match_narratives
from .base import CollectResult, SkipCollector

log = logging.getLogger(__name__)

TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OAUTH_BASE = "https://oauth.reddit.com"
RSS_URL = "https://www.reddit.com/r/{sub}/new/.rss"
IGNORED_AUTHORS = {"[deleted]", "AutoModerator", None, ""}


def _session() -> requests.Session:
    client_id, secret = env("REDDIT_CLIENT_ID"), env("REDDIT_CLIENT_SECRET")
    s = make_session({"User-Agent": env("REDDIT_USER_AGENT", "radar-crypto/0.1")})
    try:
        r = s.post(TOKEN_URL, auth=(client_id, secret),
                   data={"grant_type": "client_credentials"}, timeout=30)
    except requests.RequestException as exc:
        raise HttpError(0, TOKEN_URL, str(exc)) from exc
    if r.status_code != 200:
        raise SkipCollector(f"Reddit OAuth refusé (HTTP {r.status_code}) : vérifier les secrets")
    s.headers["Authorization"] = f"bearer {r.json()['access_token']}"
    return s


def _to_post(d: dict, tier: str) -> dict:
    return {
        "id": f"reddit:{d['id']}",
        "source": "reddit",
        "tier": tier,
        "channel": d.get("subreddit"),
        "author": d.get("author"),
        "title": d.get("title"),
        "body": d.get("selftext") or "",
        "url": "https://www.reddit.com" + d.get("permalink", ""),
        "created_at": int(d["created_utc"]),
        "engagement": d.get("score", 0),
        "extra": {"num_comments": d.get("num_comments", 0), "flair": d.get("link_flair_text"),
                  "link": d.get("url"), "upvote_ratio": d.get("upvote_ratio")},
    }


def collect(conn, cfg: Config) -> CollectResult:
    if not (env("REDDIT_CLIENT_ID") and env("REDDIT_CLIENT_SECRET")):
        log.info("Reddit : pas d'identifiants OAuth, collecte via les flux RSS publics")
        return _collect_rss(conn, cfg)
    c = cfg.collector("reddit")
    res = CollectResult("reddit")
    session = _session()
    base, suffix = OAUTH_BASE, ""
    authors_to_check: set[str] = set()

    for sub in c.get("subreddits", []):
        after = None
        for _ in range(int(c.get("pages_per_subreddit", 3))):
            params = {"limit": 100, "raw_json": 1}
            if after:
                params["after"] = after
            try:
                data = get_json(session, f"{base}/r/{sub}/new{suffix}", params=params)
            except HttpError as exc:
                if exc.status == 0:
                    raise
                res.errors.append(f"r/{sub}: {exc}")
                break
            children = data.get("data", {}).get("children", [])
            reached_known = False
            for child in children:
                post = _to_post(child["data"], c.get("tier", "retail"))
                if upsert_post(conn, post):
                    res.new += 1
                    text = f"{post['title']}\n{post['body']}"
                    if post["author"] not in IGNORED_AUTHORS and match_narratives(text, cfg.narratives):
                        authors_to_check.add(post["author"])
                else:
                    res.seen += 1
                    reached_known = True
            conn.commit()
            after = data.get("data", {}).get("after")
            if reached_known or not after:
                break
            time.sleep(1)

    _lookup_authors(conn, session, base, suffix, authors_to_check, int(c.get("max_author_lookups", 80)), res)
    conn.commit()
    return res


def _lookup_authors(conn, session, base, suffix, authors: set[str], limit: int, res: CollectResult) -> None:
    """Âge du compte et karma, pour les auteurs de posts pré-filtrés encore inconnus."""
    known = {r[0] for r in conn.execute("SELECT author FROM authors WHERE source = 'reddit'")}
    todo = sorted(a for a in authors if a not in known)[:limit]
    for name in todo:
        try:
            d = get_json(session, f"{base}/user/{name}/about{suffix}", retries=1).get("data", {})
        except HttpError as exc:
            # 404 = compte supprimé/suspendu : on le marque suspect.
            if exc.status in (403, 404):
                conn.execute("INSERT OR REPLACE INTO authors (source, author, suspect, fetched_at) "
                             "VALUES ('reddit', ?, 1, ?)", (name, int(time.time())))
            continue
        karma = d.get("total_karma") or (d.get("link_karma", 0) + d.get("comment_karma", 0))
        conn.execute(
            "INSERT OR REPLACE INTO authors (source, author, created_at, karma, suspect, fetched_at) "
            "VALUES ('reddit', ?, ?, ?, ?, ?)",
            (name, int(d.get("created_utc", 0)) or None, karma, int(bool(d.get("is_suspended"))),
             int(time.time())),
        )
        time.sleep(0.7)


def _collect_rss(conn, cfg: Config) -> CollectResult:
    """Repli sans clé : flux RSS (Atom) « new » de chaque subreddit, 25 à 100 posts par flux."""
    from .rss import _clean

    c = cfg.collector("reddit")
    res = CollectResult("reddit")
    session = make_session({"User-Agent": env("REDDIT_USER_AGENT", "radar-crypto/0.1 (rss)")})
    for sub in c.get("subreddits", []):
        url = RSS_URL.format(sub=sub)
        try:
            r = session.get(url, params={"limit": 100}, timeout=30)
        except requests.RequestException as exc:
            raise HttpError(0, url, str(exc)) from exc
        if r.status_code in (401, 403, 429):
            if res.new or res.seen:
                res.errors.append(f"r/{sub}: HTTP {r.status_code}")
                break
            raise SkipCollector(f"Flux RSS Reddit bloqués (HTTP {r.status_code})")
        if r.status_code != 200:
            res.errors.append(f"r/{sub}: HTTP {r.status_code}")
            continue
        for entry in feedparser.parse(r.content).entries:
            native = (entry.get("id") or "").removeprefix("t3_")
            parsed = entry.get("published_parsed") or entry.get("updated_parsed")
            if not native or not parsed:
                continue
            post = {
                "id": f"reddit:{native}",          # même id qu'en OAuth : pas de doublon au changement de mode
                "source": "reddit",
                "tier": c.get("tier", "retail"),
                "channel": sub,
                "author": (entry.get("author") or "").removeprefix("/u/") or None,
                "title": _clean(entry.get("title", "")),
                "body": _clean(entry["content"][0].get("value", "")) if entry.get("content") else "",
                "url": entry.get("link"),
                "created_at": calendar.timegm(parsed),
                "engagement": 0,
                "extra": {"via": "rss"},
            }
            if upsert_post(conn, post):
                res.new += 1
            else:
                res.seen += 1
        conn.commit()
        time.sleep(2)   # rester discret : les flux publics sont limités en débit
    return res
