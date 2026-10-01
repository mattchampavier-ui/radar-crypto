"""Flux RSS : blogs de recherche, forums de gouvernance (phase 1), médias crypto (phase 2/3)
et presse généraliste (phase 4, alarme de sommet). Le niveau est fixé par flux dans settings.yaml."""
from __future__ import annotations

import calendar
import hashlib
import html
import logging
import re

import feedparser

from ..config import Config
from ..db import upsert_post
from ..http import USER_AGENT
from .base import CollectResult

log = logging.getLogger(__name__)

TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(TAG_RE.sub(" ", text or ""))).strip()


def _entry_to_post(entry, feed: dict) -> dict | None:
    link = entry.get("link") or ""
    uid = entry.get("id") or link or entry.get("title")
    if not uid:
        return None
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    body = entry.get("summary") or ""
    if entry.get("content"):
        body = entry["content"][0].get("value", body)
    return {
        "id": "rss:" + hashlib.sha1(uid.encode()).hexdigest()[:16],
        "source": "rss",
        "tier": feed.get("tier", "niche"),
        "channel": feed["name"],
        # Forums Discourse : l'auteur est dans "author" ; blogs : nom du blog par défaut.
        "author": entry.get("author") or feed["name"],
        "title": _clean(entry.get("title", "")),
        "body": _clean(body)[:4000],
        "url": link,
        "created_at": calendar.timegm(parsed),
        "engagement": 0,
    }


def collect(conn, cfg: Config) -> CollectResult:
    res = CollectResult("rss")
    for feed in cfg.collector("rss").get("feeds", []):
        parsed = feedparser.parse(feed["url"], agent=USER_AGENT)
        status = getattr(parsed, "status", None)
        if parsed.bozo and not parsed.entries:
            ctype = (getattr(parsed, "headers", {}) or {}).get("content-type", "")
            reason = ("l'URL renvoie une page HTML, pas un flux RSS : URL à corriger" if "html" in ctype
                      or "syntax error" in str(parsed.get("bozo_exception", "")) else
                      str(parsed.get("bozo_exception", "flux illisible")))
            res.errors.append(f"{feed['name']}: {reason}")
            continue
        if status and status >= 400:
            res.errors.append(f"{feed['name']}: HTTP {status}")
            continue
        for entry in parsed.entries:
            post = _entry_to_post(entry, feed)
            if not post:
                continue
            if upsert_post(conn, post):
                res.new += 1
            else:
                res.seen += 1
        conn.commit()
    return res
