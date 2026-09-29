from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


class SkipCollector(Exception):
    """Collecteur sauté proprement (identifiants absents, plan API sans accès...)."""


@dataclass
class CollectResult:
    source: str
    new: int = 0
    seen: int = 0
    errors: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        s = f"{self.source}: {self.new} nouveaux, {self.seen} déjà connus"
        if self.errors:
            s += f", {len(self.errors)} erreur(s) : " + " | ".join(self.errors[:5])
        return s


def today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def iso_to_epoch(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
