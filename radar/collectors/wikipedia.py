"""Pages vues Wikipédia (anglais) des articles de chaque narratif : alarme de phase 4.

Une forte hausse des consultations signale l'arrivée du grand public (alternative fiable à
Google Trends, souvent bloqué depuis les serveurs). API Wikimedia publique, sans clé.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from ..config import Config
from ..http import HttpError, get_json, make_session
from .base import CollectResult

log = logging.getLogger(__name__)

API = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/"
       "{article}/daily/{start}/{end}")


def collect(conn, cfg: Config) -> CollectResult:
    c = cfg.collector("wikipedia")
    res = CollectResult("wikipedia")
    session = make_session()
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    start = end - timedelta(days=int(c.get("days", 90)))
    articles = sorted({a for n in cfg.narratives.values() for a in n.wikipedia_articles})
    missing = []
    for article in articles:
        url = API.format(article=quote(article, safe=""), start=start.strftime("%Y%m%d00"),
                         end=end.strftime("%Y%m%d00"))
        try:
            data = get_json(session, url, retries=1)
        except HttpError as exc:
            if exc.status == 0:
                raise
            if exc.status == 404:
                missing.append(article)
            else:
                res.errors.append(f"{article}: {exc}")
            continue
        for item in data.get("items", []):
            d = datetime.strptime(item["timestamp"][:8], "%Y%m%d").date().isoformat()
            conn.execute("INSERT OR REPLACE INTO wiki_pageviews VALUES (?, ?, ?)", (d, article, item.get("views", 0)))
            res.new += 1
        conn.commit()
        time.sleep(0.2)
    if missing:
        res.errors.append("articles Wikipédia introuvables (titre à corriger dans narratives.yaml) : "
                          + ", ".join(missing))
    return res
