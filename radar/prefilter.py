"""Pré-filtre par mots-clés : seuls les posts qui matchent un narratif partent au LLM."""
from __future__ import annotations

import re
from functools import lru_cache

from .config import Narrative


@lru_cache(maxsize=None)
def _compile(keywords: tuple[str, ...]) -> re.Pattern:
    parts = sorted((re.escape(k) for k in keywords), key=len, reverse=True)
    # Bornes "souples" : pas de lettre/chiffre collé de part et d'autre.
    return re.compile(r"(?<![\w])(" + "|".join(parts) + r")(?![\w])", re.IGNORECASE)


def match_narratives(text: str, narratives: dict[str, Narrative]) -> dict[str, list[str]]:
    """Retourne {narratif: [mots-clés trouvés]} pour le texte donné."""
    found: dict[str, list[str]] = {}
    if not text:
        return found
    for key, n in narratives.items():
        if not n.keywords:
            continue
        hits = _compile(tuple(n.keywords)).findall(text)
        if hits:
            found[key] = sorted({h.lower() for h in hits})
    return found


@lru_cache(maxsize=None)
def _token_pattern(symbols: tuple[str, ...]) -> re.Pattern:
    # Cashtags ($HYPE) insensibles à la casse, ou symbole en MAJUSCULES isolé (HYPE).
    alts = "|".join(re.escape(s) for s in sorted(symbols, key=len, reverse=True))
    return re.compile(r"(?:\$(?i:(" + alts + r"))|(?<![\w$])(" + alts + r"))(?![\w])")


def match_tokens(text: str, tokens: dict[str, dict]) -> set[str]:
    """Ids CoinGecko des tokens mentionnés (cashtag ou symbole en majuscules)."""
    if not text or not tokens:
        return set()
    by_symbol = {t["symbol"].upper(): tid for tid, t in tokens.items() if len(t["symbol"]) >= 2}
    pat = _token_pattern(tuple(by_symbol))
    out = set()
    for m in pat.finditer(text):
        sym = (m.group(1) or m.group(2) or "").upper()
        # Symbole nu : écrit en MAJUSCULES et d'au moins 3 lettres ("SEI" oui, "sei" ou "IO" non).
        if m.group(2) and (m.group(2) != m.group(2).upper() or len(m.group(2)) < 3):
            continue
        if sym in by_symbol:
            out.add(by_symbol[sym])
    return out
