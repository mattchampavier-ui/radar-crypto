"""Reddit : derniers posts des subreddits configurés (phase 3, alarme d'arrivée des particuliers).

Authentification OAuth "application-only" (client_credentials) avec une app de type "script"
créée sur https://www.reddit.com/prefs/apps. Sans identifiants, on tente les endpoints JSON
publics (souvent bloqués depuis les IP de GitHub Actions) puis on saute proprement.
"""
from __future__ import annotations

import logging
import time

import requests

from ..config import Config, env
from ..db import upsert_post
from ..http import HttpError, get_json, make_session
from ..prefilter import match_narratives
from .base import CollectResult, SkipCollector

log = logging.getLogger(__name__)

TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OAUTH_BASE = "https://oauth.reddit.com"
PUBLIC_BASE = "https://www.reddit.com"
IGNORED_AUTHORS = {"[deleted]", "AutoModerator", None, ""}


def _session() -> tuple[requests.Session, str]:
    client_id, secret = env("REDDIT_CLIENT_ID"), env("REDDIT_CLIENT_SECRET")
    ua = env("REDDIT_USER_AGENT", "radar-crypto/0.1")
    s = make_session({"User-Agent": ua})
    if not (client_id and secret):
        log.warning("Reddit : pas d'identifiants OAuth, essai des endpoints publics")
        return s, PUBLIC_BASE
    try:
        r = s.post(TOKEN_URL, auth=(client_id, secret),
                   data={"grant_type": "client_credentials"}, timeout=30)
    except requests.RequestException as exc:
        raise HttpError(0, TOKEN_URL, str(exc)) from exc
    if r.status_code != 200:
        raise SkipCollector(f"Reddit OAuth refusé (HTTP {r.status_code}) : vérifier les secrets")
    s.headers["Authorization"] = f"bearer {r.json()['access_token']}"
    return s, OAUTH_BASE


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
    c = cfg.collector("reddit")
    res = CollectResult("reddit")
    session, base = _session()
    suffix = ".json" if base == PUBLIC_BASE else ""
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
                if base == PUBLIC_BASE and exc.status in (401, 403, 429):
                    raise SkipCollector(f"Reddit public bloqué (HTTP {exc.status}) : configurer l'OAuth")
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
