"""Farcaster via l'API Neynar (phase 1, discussions crypto natives).

Nécessite NEYNAR_API_KEY. Si la clé est absente ou si le plan ne donne pas accès
à l'endpoint (HTTP 401/402/403), le collecteur est sauté sans faire échouer la collecte.
"""
from __future__ import annotations

import logging
import time

from ..config import Config, env
from ..db import upsert_post
from ..http import HttpError, get_json, make_session
from .base import CollectResult, SkipCollector, iso_to_epoch

log = logging.getLogger(__name__)

API = "https://api.neynar.com/v2/farcaster"


def collect(conn, cfg: Config) -> CollectResult:
    c = cfg.collector("farcaster")
    key = env("NEYNAR_API_KEY")
    if not key:
        raise SkipCollector("NEYNAR_API_KEY absent : Farcaster sauté")
    session = make_session({"x-api-key": key, "accept": "application/json"})
    res = CollectResult("farcaster")
    channels = c.get("channels", [])
    limit = int(c.get("limit_per_channel", 100))

    for channel in channels:
        cursor, fetched = None, 0
        while fetched < limit:
            params = {"channel_ids": channel, "limit": min(100, limit - fetched),
                      "with_recasts": "false", "should_moderate": "false"}
            if cursor:
                params["cursor"] = cursor
            try:
                data = get_json(session, f"{API}/feed/channels", params=params)
            except HttpError as exc:
                if exc.status == 0:
                    raise
                if exc.status in (401, 402, 403):
                    raise SkipCollector(f"Neynar : accès refusé (HTTP {exc.status}), plan gratuit insuffisant ?")
                res.errors.append(f"/{channel}: {exc}")
                break
            casts = data.get("casts", [])
            reached_known = False
            for cast in casts:
                author = cast.get("author", {})
                post = {
                    "id": f"farcaster:{cast['hash']}",
                    "source": "farcaster",
                    "tier": c.get("tier", "niche"),
                    "channel": (cast.get("channel") or {}).get("id", channel),
                    "author": author.get("username"),
                    "title": "",
                    "body": cast.get("text", ""),
                    "url": f"https://farcaster.xyz/{author.get('username')}/{cast['hash'][:10]}",
                    "created_at": iso_to_epoch(cast["timestamp"]),
                    "engagement": (cast.get("reactions") or {}).get("likes_count", 0),
                    "extra": {"recasts": (cast.get("reactions") or {}).get("recasts_count", 0),
                              "replies": (cast.get("replies") or {}).get("count", 0),
                              "fid": author.get("fid")},
                }
                if upsert_post(conn, post):
                    res.new += 1
                    _store_author(conn, author)
                else:
                    res.seen += 1
                    reached_known = True
            fetched += len(casts)
            conn.commit()
            cursor = (data.get("next") or {}).get("cursor")
            if reached_known or not cursor or not casts:
                break
            time.sleep(0.5)
    return res


def _store_author(conn, author: dict) -> None:
    if not author.get("username"):
        return
    score = (author.get("experimental") or {}).get("neynar_user_score")
    conn.execute(
        "INSERT OR REPLACE INTO authors (source, author, karma, followers, following, fetched_at) "
        "VALUES ('farcaster', ?, ?, ?, ?, ?)",
        (author["username"], score, author.get("follower_count"), author.get("following_count"),
         int(time.time())),
    )
