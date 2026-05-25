"""Tests for guards: iteration counters and error routing."""

import json
from pathlib import Path

import pytest

from src.flow_engine.reducers import max_of, or_, set_by_key


class TestGuards:
    def test_max_of_reducer(self):
        result = max_of({"a": 1, "b": 2}, {"a": 3, "c": 4})
        assert result["a"] == 3
        assert result["b"] == 2
        assert result["c"] == 4

    def test_max_of_empty_left(self):
        result = max_of({}, {"a": 5})
        assert result["a"] == 5

    def test_max_of_empty_right(self):
        result = max_of({"a": 5}, {})
        assert result["a"] == 5

    def test_or_reducer_false_false(self):
        assert or_(False, False) is False

    def test_or_reducer_true_false(self):
        assert or_(True, False) is True

    def test_or_reducer_false_true(self):
        assert or_(False, True) is True

    def test_or_reducer_true_true(self):
        assert or_(True, True) is True

    def test_set_by_key_merges(self):
        result = set_by_key({"a": 1}, {"b": 2})
        assert result == {"a": 1, "b": 2}

    def test_set_by_key_right_wins(self):
        result = set_by_key({"a": 1}, {"a": 2})
        assert result["a"] == 2

    def test_set_by_key_empty_left(self):
        result = set_by_key({}, {"a": 1})
        assert result == {"a": 1}

    def test_set_by_key_empty_right(self):
        result = set_by_key({"a": 1}, {})
        assert result == {"a": 1}
