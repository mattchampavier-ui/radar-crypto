"""Hacker News via l'API de recherche Algolia (phase 1 : développeurs et chercheurs).

On ramène les stories crypto récentes (requêtes génériques de settings.yaml) ; le pré-filtre
mots-clés et le LLM les rattachent ensuite aux narratifs. Gratuit, sans clé.
"""
from __future__ import annotations

import logging
import time
from urllib.parse import urlparse

from ..config import Config
from ..db import upsert_post
from ..http import HttpError, get_json, make_session
from .base import CollectResult
from .github import CRYPTO_CONTEXT
from .rss import _clean

log = logging.getLogger(__name__)

API = "https://hn.algolia.com/api/v1/search_by_date"


def collect(conn, cfg: Config) -> CollectResult:
    c = cfg.collector("hackernews")
    res = CollectResult("hackernews")
    session = make_session()
    since = int(time.time()) - int(c.get("lookback_hours", 72)) * 3600
    seen: set[str] = set()
    for query in c.get("queries", []):
        page, pages = 0, 1
        while page < pages and page < 5:
            try:
                data = get_json(session, API, params={
                    "query": query, "tags": "story", "hitsPerPage": 100, "page": page,
                    "numericFilters": f"created_at_i>{since},points>={int(c.get('min_points', 3))}"})
            except HttpError as exc:
                if exc.status == 0:
                    raise
                res.errors.append(f"{query}: {exc}")
                break
            pages = int(data.get("nbPages") or 1)
            for hit in data.get("hits", []):
                oid = hit.get("objectID")
                if not oid or oid in seen or not hit.get("title"):
                    continue
                seen.add(oid)
                body = _clean(hit.get("story_text") or "")
                domain = urlparse(hit.get("url") or "").netloc
                # "crypto" matche aussi "cryptography" : on exige un vrai contexte crypto.
                if not CRYPTO_CONTEXT.search(f"{hit['title']} {body} {domain}"):
                    continue
                post = {
                    "id": f"hackernews:{oid}",
                    "source": "hackernews",
                    "tier": c.get("tier", "niche"),
                    "channel": domain or "news.ycombinator.com",
                    "author": hit.get("author"),
                    "title": hit["title"],
                    "body": body,
                    "url": f"https://news.ycombinator.com/item?id={oid}",
                    "created_at": int(hit["created_at_i"]),
                    "engagement": hit.get("points") or 0,
                    "extra": {"comments": hit.get("num_comments") or 0, "link": hit.get("url")},
                }
                if upsert_post(conn, post):
                    res.new += 1
                else:
                    res.seen += 1
            conn.commit()
            page += 1
            time.sleep(0.3)
    return res
