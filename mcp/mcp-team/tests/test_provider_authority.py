"""Provider authority: Graph calls use only the per-request delegated token."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import pytest

from graph_helpers import _delegated_provider_token, get_access_token


def test_uses_the_per_request_delegated_token():
    handle = _delegated_provider_token.set("delegated-graph-token")
    try:
        assert get_access_token() == "delegated-graph-token"
    finally:
        _delegated_provider_token.reset(handle)


def test_fails_closed_without_a_delegated_token():
    with pytest.raises(RuntimeError, match="No delegated Microsoft Graph token"):
        get_access_token()


def test_environment_token_is_not_a_fallback(monkeypatch):
    """A server-wide Graph credential would let a caller inherit tenant authority."""
    monkeypatch.setenv("M365_ACCESS_TOKEN", "ambient-tenant-token")

    with pytest.raises(RuntimeError, match="No delegated Microsoft Graph token"):
        get_access_token()


def test_delegated_token_wins_over_any_environment_value(monkeypatch):
    monkeypatch.setenv("M365_ACCESS_TOKEN", "ambient-tenant-token")
    handle = _delegated_provider_token.set("delegated-graph-token")
    try:
        assert get_access_token() == "delegated-graph-token"
    finally:
        _delegated_provider_token.reset(handle)
