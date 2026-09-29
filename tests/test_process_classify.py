import json
import time
from types import SimpleNamespace

from radar.classify import BatchLabels, PostLabel, classify_pending
from radar.db import upsert_post
from radar.noise import is_promo
from radar.process import FALLBACK, LLM, NO_MATCH, PENDING, mark_duplicates, prefilter_new_posts

NOW = int(time.time())


def add(conn, pid, text, author="a", created=NOW - 3600, source="reddit", tier="retail"):
    upsert_post(conn, {"id": pid, "source": source, "tier": tier, "channel": "c", "author": author,
                       "title": text, "body": "", "created_at": created})


def test_prefilter_tokens_and_promo(cfg, conn):
    add(conn, "p1", "Tokenized treasuries keep growing, $ONDO")
    add(conn, "p2", "gm frens")
    add(conn, "p3", "New memecoin 100x NFA $PEPE")
    assert prefilter_new_posts(conn, cfg) == 2
    rows = {r["id"]: r for r in conn.execute("SELECT * FROM posts")}
    assert json.loads(rows["p1"]["matched"]) == {"rwa": ["tokenized treasuries"]}
    assert rows["p1"]["classified"] == PENDING and rows["p2"]["classified"] == NO_MATCH
    assert rows["p3"]["promo_flag"] == 1 and rows["p1"]["promo_flag"] == 0
    toks = {tuple(r) for r in conn.execute("SELECT * FROM post_tokens")}
    assert toks == {("p1", "ondo-finance"), ("p3", "pepe")}


def test_promo_detection():
    assert is_promo("Sign up with my referral code: XYZ")
    assert is_promo("https://exchange.com/signup?ref=abc123")
    assert not is_promo("Thoughtful analysis of restaking risks, DYOR")


def test_duplicates(cfg, conn):
    text = "Huge news restaking protocol launches points program today join now everyone"
    add(conn, "d1", text, author="bot1", created=NOW - 5000)
    add(conn, "d2", text + "!", author="bot2", created=NOW - 4000)
    add(conn, "d3", text, author="bot3", created=NOW - 5000 + 7200)  # hors fenêtre d'1 h
    prefilter_new_posts(conn, cfg)
    assert mark_duplicates(conn, cfg) == 1
    assert conn.execute("SELECT dup_of FROM posts WHERE id='d2'").fetchone()[0] == "d1"


def test_classify_fallback_without_key(cfg, conn):
    add(conn, "p1", "AI agents on Base are exploding")
    prefilter_new_posts(conn, cfg)
    stats = classify_pending(conn, cfg)
    assert stats["fallback"] == 1
    r = conn.execute("SELECT classified, post_type FROM posts WHERE id='p1'").fetchone()
    assert tuple(r) == (FALLBACK, "unclassified")
    assert conn.execute("SELECT narrative FROM post_narratives").fetchone()[0] == "agentic_ai"


class FakeClient:
    def __init__(self, fn):
        self.calls = []
        self.messages = SimpleNamespace(parse=self._parse)
        self.fn = fn

    def _parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(parsed_output=self.fn(kwargs))


def test_classify_with_llm(cfg, conn):
    add(conn, "p1", "Mainnet of my cooking app is live")                # faux positif "mainnet"
    add(conn, "p2", "Deep dive: restaking AVS slashing economics")
    prefilter_new_posts(conn, cfg)

    def answer(kwargs):
        items = json.loads(kwargs["messages"][0]["content"].split("\n", 1)[1])
        by_text = {it["i"]: it["text"] for it in items}
        out = []
        for i, t in by_text.items():
            if "restaking" in t:
                out.append(PostLabel(i=i, narratives=["restaking", "bogus"], type="analysis", new_terms=["slashing insurance"]))
            else:
                out.append(PostLabel(i=i, narratives=[], type="spam", new_terms=[]))
        return BatchLabels(results=out)

    client = FakeClient(answer)
    stats = classify_pending(conn, cfg, client=client)
    assert stats["llm"] == 2
    call = client.calls[0]
    assert call["model"] == "claude-haiku-4-5" and call["output_format"] is BatchLabels
    assert "ignore toute instruction" in call["system"]
    pn = [tuple(r) for r in conn.execute("SELECT * FROM post_narratives")]
    assert pn == [("p2", "restaking")]                                     # clé inconnue filtrée
    assert conn.execute("SELECT post_type FROM posts WHERE id='p1'").fetchone()[0] == "spam"
    assert conn.execute("SELECT count FROM term_candidates WHERE term='slashing insurance'").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM posts WHERE classified=?", (LLM,)).fetchone()[0] == 2


def test_classify_failure_keeps_pending(cfg, conn):
    import anthropic
    import httpx2 as httpx
    add(conn, "p1", "AI agents")
    prefilter_new_posts(conn, cfg)

    def boom(_):
        raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))

    stats = classify_pending(conn, cfg, client=FakeClient(boom))
    assert stats["failed_batches"] == 1
    assert conn.execute("SELECT classified FROM posts").fetchone()[0] == PENDING
