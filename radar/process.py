"""Traitement après collecte : pré-filtre mots-clés, tokens mentionnés, promos et quasi-doublons."""
from __future__ import annotations

import json

from .config import Config
from .noise import is_promo, jaccard, shingles
from .prefilter import match_narratives, match_tokens

# Valeurs de posts.classified
PENDING, LLM, FALLBACK, NO_MATCH = 0, 1, 2, 3


def post_text(row) -> str:
    return f"{row['title'] or ''}\n{row['body'] or ''}".strip()


def prefilter_new_posts(conn, cfg: Config) -> int:
    """Calcule matched / tokens / promo pour les posts jamais traités. Retourne le nb de posts matchés."""
    tokens = cfg.all_tokens()
    by_category = {c.lower(): k for k, n in cfg.narratives.items() for c in n.defillama_categories}
    rows = conn.execute("SELECT id, source, title, body, extra FROM posts WHERE matched IS NULL").fetchall()
    n_matched = 0
    for row in rows:
        text = post_text(row)
        matched = match_narratives(text, cfg.narratives)
        # Levées de fonds et nouveaux protocoles DefiLlama : la catégorie suffit à rattacher.
        if row["source"] in ("raises", "defillama") and row["extra"]:
            cat = (json.loads(row["extra"]).get("category") or "").lower()
            if cat in by_category:
                matched.setdefault(by_category[cat], []).append(f"catégorie defillama : {cat}")
        conn.execute(
            "UPDATE posts SET matched = ?, promo_flag = ?, classified = ? WHERE id = ?",
            (json.dumps(matched), int(is_promo(text)), PENDING if matched else NO_MATCH, row["id"]),
        )
        for tid in match_tokens(text, tokens):
            conn.execute("INSERT OR IGNORE INTO post_tokens VALUES (?, ?)", (row["id"], tid))
        n_matched += bool(matched)
    conn.commit()
    return n_matched


def mark_duplicates(conn, cfg: Config, lookback_hours: int = 72) -> int:
    """Textes quasi identiques publiés par des comptes différents en < 1 h : un seul compte."""
    noise = cfg.settings["noise"]
    window = noise["duplicate_window_minutes"] * 60
    rows = conn.execute(
        """SELECT id, author, title, body, created_at, dup_of FROM posts
           WHERE classified != ? AND created_at >= strftime('%s','now') - ?
           ORDER BY created_at""",
        (NO_MATCH, lookback_hours * 3600),
    ).fetchall()
    sh = {r["id"]: shingles(post_text(r)) for r in rows}
    n = 0
    for i, r in enumerate(rows):
        if r["dup_of"] or len(sh[r["id"]]) < 3:
            continue
        for later in rows[i + 1:]:
            if later["created_at"] - r["created_at"] > window:
                break
            if later["dup_of"] or later["author"] == r["author"]:
                continue
            if jaccard(sh[r["id"]], sh[later["id"]]) >= noise["duplicate_similarity"]:
                conn.execute("UPDATE posts SET dup_of = ? WHERE id = ?", (r["id"], later["id"]))
                n += 1
    conn.commit()
    return n
