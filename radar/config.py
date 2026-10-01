"""Chargement de la configuration YAML et des secrets (variables d'environnement)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"


def _load_dotenv(path: Path) -> None:
    """Charge un fichier .env minimal (tests locaux), sans écraser l'environnement."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if value and key.strip() not in os.environ:
            os.environ[key.strip()] = value.strip()


@dataclass
class Narrative:
    key: str
    label: str
    keywords: list[str]
    coingecko_categories: list[str] = field(default_factory=list)
    defillama_categories: list[str] = field(default_factory=list)
    tokens: list[dict] = field(default_factory=list)
    alarm_only: bool = False
    github_queries: list[str] = field(default_factory=list)
    wikipedia_articles: list[str] = field(default_factory=list)


@dataclass
class Config:
    settings: dict
    narratives: dict[str, Narrative]

    @property
    def db_path(self) -> Path:
        return ROOT / self.settings["db_path"]

    def collector(self, name: str) -> dict:
        return self.settings.get("collectors", {}).get(name, {})

    def all_tokens(self) -> dict[str, dict]:
        """id CoinGecko -> {symbol, narrative}."""
        out: dict[str, dict] = {}
        for n in self.narratives.values():
            for t in n.tokens:
                out[t["id"]] = {"symbol": t["symbol"], "narrative": n.key}
        return out


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value else default


def load_config(config_dir: Path | None = None) -> Config:
    config_dir = config_dir or CONFIG_DIR
    _load_dotenv(ROOT / ".env")
    settings = yaml.safe_load((config_dir / "settings.yaml").read_text())
    raw = yaml.safe_load((config_dir / "narratives.yaml").read_text())["narratives"]
    narratives = {
        key: Narrative(
            key=key,
            label=val.get("label", key),
            keywords=val.get("keywords", []),
            coingecko_categories=val.get("coingecko_categories", []) or [],
            defillama_categories=val.get("defillama_categories", []) or [],
            tokens=val.get("tokens", []) or [],
            alarm_only=bool(val.get("alarm_only", False)),
            github_queries=val.get("github_queries", []) or [],
            wikipedia_articles=val.get("wikipedia_articles", []) or [],
        )
        for key, val in raw.items()
    }
    return Config(settings=settings, narratives=narratives)
