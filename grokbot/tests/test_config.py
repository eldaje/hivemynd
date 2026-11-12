import pytest

import config


def test_default_chain_used_when_unset(monkeypatch):
    monkeypatch.delenv("GROKBOT_CHAIN", raising=False)
    assert config._chain() == config.DEFAULT_CHAIN.split(",")


def test_empty_override_falls_back(monkeypatch):
    monkeypatch.setenv("GROKBOT_CHAIN", "   ")
    assert config._chain() == config.DEFAULT_CHAIN.split(",")


def test_unknown_route_rejected(monkeypatch):
    monkeypatch.setenv("GROKBOT_CHAIN", "x-ai/grok-4-fast:free,paid/model")
    with pytest.raises(ValueError, match="unauthorized"):
        config._chain()


def test_all_grok_rejected(monkeypatch):
    monkeypatch.setenv("GROKBOT_CHAIN", "x-ai/grok-4-fast:free")
    with pytest.raises(ValueError, match="all-Grok"):
        config._chain()


def test_authorized_alternative_accepted(monkeypatch):
    monkeypatch.setenv("GROKBOT_CHAIN", "openai/gpt-oss-20b:free")
    assert config._chain() == ["openai/gpt-oss-20b:free"]
