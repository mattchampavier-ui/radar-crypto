"""Filtres anti-bruit : promotions, quasi-doublons, poids auteur, poids final d'un post."""
from __future__ import annotations

import re

PROMO_RE = re.compile(
    r"\bref(?:erral)?(?:[_ -]?code)?\s*[:=]|[?&](?:ref|referral|invite|aff)=|\bsponsored\b|#ad\b|\bpaid partnership\b|"
    r"use my (?:link|code)|sign ?up (?:with|using) my|airdrop (?:link|claim)|\bclaim now\b",
    re.IGNORECASE,
)
NFA_RE = re.compile(r"\b(?:nfa|not financial advice|dyor)\b", re.IGNORECASE)
CASHTAG_RE = re.compile(r"\$[A-Za-z][A-Za-z0-9]{1,9}\b")
WORD_RE = re.compile(r"[a-z0-9$]+")


def is_promo(text: str) -> bool:
    """Lien de parrainage, mention sponsorisée, ou « NFA + ticker » typique du shill."""
    if PROMO_RE.search(text):
        return True
    return bool(NFA_RE.search(text) and CASHTAG_RE.search(text))


def shingles(text: str, n: int = 3) -> set[str]:
    words = WORD_RE.findall(text.lower())
    if len(words) < n:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def author_weight(author_row, post_created_at: int, source: str, noise: dict) -> float:
    """Poids de crédibilité de l'auteur (1 par défaut si inconnu)."""
    if author_row is None:
        return 1.0
    if author_row["suspect"]:
        return 0.0
    created = author_row["created_at"]
    if created and post_created_at - created < noise["min_account_age_days"] * 86400:
        return 0.0
    if source == "farcaster":
        followers, following = author_row["followers"] or 0, author_row["following"] or 0
        if following > 1000 and followers / following < noise["farcaster_min_follower_ratio"]:
            return 0.0
    if source == "reddit" and author_row["karma"] is not None and author_row["karma"] < noise["reddit_min_karma"]:
        return 0.5
    return 1.0


def post_weight(post, author_row, settings: dict) -> float:
    """w_auteur x w_source x w_type x pénalités (promo, doublon, repo sans étoile)."""
    if post["dup_of"]:
        return 0.0
    noise = settings["noise"]
    w = settings["tier_weights"].get(post["tier"], 1.0)
    w *= settings["post_type_weights"].get(post["post_type"] or "unclassified", 0.7)
    w *= author_weight(author_row, post["created_at"], post["source"], noise)
    if post["promo_flag"]:
        w *= noise["promo_weight"]
    if post["source"] == "github" and (post["engagement"] or 0) == 0:
        w *= noise["github_zero_star_weight"]
    return w
