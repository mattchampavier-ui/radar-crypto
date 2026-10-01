"""Snapshot : propositions de gouvernance des DAO (phase 1 : thèses et virages des protocoles).

API GraphQL publique, sans clé. Beaucoup d'espaces Snapshot sont du spam : on ne garde que les
propositions qui atteignent `min_votes`. Les 7 derniers jours sont re-balayés à chaque passage,
une proposition entre donc dans la base dès qu'elle franchit le seuil.
Auteur = l'espace (la DAO) : la diversité mesure combien de DAO parlent d'un narratif.
"""
from __future__ import annotations

import logging
import time

from ..config import Config
from ..db import upsert_post
from ..http import HttpError, make_session, post_json
from .base import CollectResult

log = logging.getLogger(__name__)

API = "https://hub.snapshot.org/graphql"
QUERY = """
query Proposals($first: Int!, $skip: Int!, $since: Int!) {
  proposals(first: $first, skip: $skip, where: {created_gte: $since},
            orderBy: "created", orderDirection: desc) {
    id title body created author votes scores_total state link
    space { id name }
  }
}
"""


def collect(conn, cfg: Config) -> CollectResult:
    c = cfg.collector("snapshot")
    res = CollectResult("snapshot")
    session = make_session({"Content-Type": "application/json"})
    since = int(time.time()) - int(c.get("lookback_days", 7)) * 86400
    min_votes = int(c.get("min_votes", 20))
    for page in range(int(c.get("pages", 3))):
        try:
            data = post_json(session, API, {"query": QUERY,
                                            "variables": {"first": 1000, "skip": page * 1000, "since": since}})
        except HttpError as exc:
            if exc.status == 0:
                raise
            res.errors.append(f"page {page}: {exc}")
            break
        if data.get("errors"):
            res.errors.append("GraphQL : " + "; ".join(e.get("message", "?") for e in data["errors"])[:300])
            break
        proposals = (data.get("data") or {}).get("proposals") or []
        for prop in proposals:
            if (prop.get("votes") or 0) < min_votes or not prop.get("title"):
                continue
            space = prop.get("space") or {}
            post = {
                "id": f"snapshot:{prop['id']}",
                "source": "snapshot",
                "tier": c.get("tier", "niche"),
                "channel": space.get("name") or space.get("id"),
                "author": space.get("id") or prop.get("author"),
                "title": prop["title"],
                "body": prop.get("body") or "",
                "url": prop.get("link") or f"https://snapshot.box/#/s:{space.get('id')}/proposal/{prop['id']}",
                "created_at": int(prop["created"]),
                "engagement": prop.get("votes") or 0,
                "extra": {"state": prop.get("state"), "scores_total": prop.get("scores_total"),
                          "proposer": prop.get("author")},
            }
            if upsert_post(conn, post):
                res.new += 1
            else:
                res.seen += 1
        conn.commit()
        if len(proposals) < 1000:
            break
        time.sleep(1)
    return res
