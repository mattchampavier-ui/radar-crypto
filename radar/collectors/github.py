"""GitHub : nouveaux repos crypto par mots-clés (phase 1, développeurs).

Chaque repo créé dans la fenêtre `lookback_days` est un "post" (auteur = propriétaire).
Les repos déjà vus sont ré-upsertés pour mettre à jour leurs étoiles.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone

from ..config import Config, env
from ..db import upsert_post
from ..http import HttpError, get_json, make_session
from .base import CollectResult, iso_to_epoch

log = logging.getLogger(__name__)

API = "https://api.github.com"
# Contexte crypto exigé dans le nom/description/topics pour écarter les repos hors sujet.
CRYPTO_CONTEXT = re.compile(
    r"crypto|blockchain|web3|on-?chain|ethereum|\beth\b|solana|\bevm\b|defi|\btoken|smart contract|"
    r"rollup|\bl2\b|layer ?2|bitcoin|stablecoin|wallet|dex\b|restak|\bavs\b|depin|\brwa|farcaster|"
    r"cosmos|\bsui\b|aptos|\bbase\b|arbitrum|optimism|polygon|hyperliquid|x402|zk|nft|dao\b|memecoin|"
    r"pump\.fun|perp",
    re.IGNORECASE,
)


def _queries(cfg: Config) -> list[tuple[str, str]]:
    """(narratif, requête) — les requêtes explicites priment sur les mots-clés."""
    out = []
    for n in cfg.narratives.values():
        qs = n.github_queries or [f'"{k}"' if " " in k else k for k in n.keywords]
        out.extend((n.key, q) for q in qs)
    out.extend(("", q) for q in cfg.collector("github").get("extra_queries", []))
    return out


def collect(conn, cfg: Config) -> CollectResult:
    c = cfg.collector("github")
    res = CollectResult("github")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = env("GITHUB_TOKEN") or env("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    session = make_session(headers)
    since = (datetime.now(timezone.utc) - timedelta(days=int(c.get("lookback_days", 7)))).strftime("%Y-%m-%d")
    pause = 2.2 if token else 6.5   # 30 req/min authentifié, 10 req/min sinon
    owners: set[str] = set()
    seen_ids: set[int] = set()

    for narrative, query in _queries(cfg):
        q = f"{query} in:name,description,topics created:>={since} fork:false"
        try:
            data = get_json(session, f"{API}/search/repositories",
                            params={"q": q, "sort": "stars", "order": "desc",
                                    "per_page": int(c.get("per_query", 50))})
        except HttpError as exc:
            if exc.status == 0:
                raise
            res.errors.append(f"{query}: HTTP {exc.status}")
            if exc.status in (401, 403) and not token:
                break
            time.sleep(pause)
            continue
        for item in data.get("items", []):
            if item["id"] in seen_ids:
                continue
            seen_ids.add(item["id"])
            text = " ".join([item["full_name"], item.get("description") or "", " ".join(item.get("topics") or [])])
            if not CRYPTO_CONTEXT.search(text):
                continue
            post = {
                "id": f"github:{item['id']}",
                "source": "github",
                "tier": c.get("tier", "niche"),
                "channel": query,
                "author": item["owner"]["login"],
                "title": item["full_name"],
                "body": (item.get("description") or "") + ("\nTopics: " + ", ".join(item["topics"]) if item.get("topics") else ""),
                "url": item["html_url"],
                "created_at": iso_to_epoch(item["created_at"]),
                "engagement": item.get("stargazers_count", 0),
                "extra": {"forks": item.get("forks_count", 0), "language": item.get("language"),
                          "owner_type": item["owner"].get("type"), "query_narrative": narrative},
            }
            if upsert_post(conn, post):
                res.new += 1
                owners.add(item["owner"]["login"])
            else:
                res.seen += 1
        conn.commit()
        time.sleep(pause)

    _lookup_owners(conn, session, owners, int(c.get("max_owner_lookups", 60)))
    conn.commit()
    return res


def _lookup_owners(conn, session, owners: set[str], limit: int) -> None:
    known = {r[0] for r in conn.execute("SELECT author FROM authors WHERE source = 'github'")}
    for login in sorted(owners - known)[:limit]:
        try:
            d = get_json(session, f"{API}/users/{login}", retries=1)
        except HttpError:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO authors (source, author, created_at, followers, following, fetched_at) "
            "VALUES ('github', ?, ?, ?, ?, ?)",
            (login, iso_to_epoch(d["created_at"]) if d.get("created_at") else None,
             d.get("followers"), d.get("following"), int(time.time())),
        )
