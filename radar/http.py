"""Session HTTP commune : User-Agent, retries avec backoff sur 429/5xx."""
from __future__ import annotations

import logging
import time

import requests

log = logging.getLogger(__name__)

USER_AGENT = "radar-crypto/0.1 (+https://github.com/mattchampavier-ui/radar-crypto)"


class HttpError(RuntimeError):
    """Erreur HTTP (status = code) ou réseau (status = 0 : hôte injoignable, timeout...)."""

    def __init__(self, status: int, url: str, body: str = ""):
        what = f"HTTP {status}" if status else "erreur réseau"
        super().__init__(f"{what} sur {url.split('?')[0]}: {body[:200]}")
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
    return _request_json(session, "GET", url, params=params, retries=retries, timeout=timeout, backoff=backoff)


def post_json(session: requests.Session, url: str, payload: dict, *,
              retries: int = 3, timeout: int = 30, backoff: float = 2.0):
    """POST JSON (GraphQL...) avec la même politique de retries que get_json."""
    return _request_json(session, "POST", url, json=payload, retries=retries, timeout=timeout, backoff=backoff)


def _request_json(session, method, url, *, retries, timeout, backoff, **kwargs):
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = session.request(method, url, timeout=timeout, **kwargs)
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
    if isinstance(last_exc, HttpError):
        raise last_exc
    raise HttpError(0, url, f"{type(last_exc).__name__}: {last_exc}")
