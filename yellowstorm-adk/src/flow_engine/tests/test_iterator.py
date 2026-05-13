"""Tests for iterator topology (skeleton)."""

import json
from pathlib import Path

import pytest

from src.flow_engine.builder.iterator import is_iterator_container


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestIterator:
    def test_no_iterator_in_linear(self):
        snapshot = load_fixture("linear.json")
        iterators = [n for n in snapshot["nodes"] if is_iterator_container(n)]
        assert len(iterators) == 0

    def test_iterator_detected_by_kind(self):
        assert is_iterator_container({"kind": "iterator"})
        assert not is_iterator_container({"kind": "step"})
        assert not is_iterator_container({"kind": "router"})
