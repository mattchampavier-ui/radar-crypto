"""Collecteurs de données. Chaque module expose `collect(conn, cfg) -> CollectResult`."""
from importlib import import_module

NAMES = ["reddit", "github", "farcaster", "rss", "coingecko", "defillama"]


def get_collector(name: str):
    if name not in NAMES:
        raise KeyError(f"Collecteur inconnu : {name} (disponibles : {', '.join(NAMES)})")
    return import_module(f"{__name__}.{name}").collect
