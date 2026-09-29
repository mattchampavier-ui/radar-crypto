"""Session HTTP commune : User-Agent, retries avec backoff sur 429/5xx."""
from __future__ import annotations

import logging
import time

import requests

log = logging.getLogger(__name__)

USER_AGENT = "radar-crypto/0.1 (+https://github.com/mattchampavier-ui/radar-crypto)"


class HttpError(RuntimeError):
    def __init__(self, status: int, url: str, body: str = ""):
        super().__init__(f"HTTP {status} sur {url}: {body[:200]}")
        self.status = status


def make_session(headers: dict | None = None) -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    if headers:
        s.headers.update(headers)
    return s


def get_json(session: requests.Session, url: str, *, params: dict | None = None,
             retries: int = 3, timeout: int = 30, backoff: float = 2.0):
    """GET JSON avec retries sur 429/5xx/erreurs réseau. Lève HttpError sinon."""
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = session.get(url, params=params, timeout=timeout)
        except requests.RequestException as exc:  # réseau
            last_exc = exc
        else:
            if r.status_code == 200:
                return r.json()
            if r.status_code not in (429, 500, 502, 503, 504):
                raise HttpError(r.status_code, url, r.text)
            last_exc = HttpError(r.status_code, url, r.text)
            retry_after = r.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                time.sleep(min(int(retry_after), 60))
                continue
        if attempt < retries:
            wait = backoff * (2 ** attempt)
            log.warning("Nouvel essai dans %.0fs (%s)", wait, last_exc)
            time.sleep(wait)
    assert last_exc is not None
    raise last_exc
