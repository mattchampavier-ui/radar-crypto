import json
from pathlib import Path

import pytest

from radar.config import load_config
from radar.db import connect

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str):
    text = (FIXTURES / name).read_text()
    return json.loads(text) if name.endswith(".json") else text


@pytest.fixture
def cfg():
    return load_config()


@pytest.fixture
def conn():
    c = connect(":memory:")
    yield c
    c.close()


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    import time
    monkeypatch.setattr(time, "sleep", lambda *_: None)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ["ANTHROPIC_API_KEY", "REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "GITHUB_TOKEN", "GH_TOKEN",
              "NEYNAR_API_KEY", "COINGECKO_API_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD", "EMAIL_TO"]:
        monkeypatch.delenv(k, raising=False)
