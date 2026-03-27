import asyncio
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
sys.modules.setdefault("litellm", types.SimpleNamespace(acompletion=None))
sys.modules.setdefault(
    "src.config.settings",
    types.SimpleNamespace(
        get_settings=lambda: types.SimpleNamespace(
            MEMORY_MODEL="test-judge",
            LITELLM_API_BASE_URL="http://test",
            LITELLM_API_SECRET_KEY="test-key",
        )
    ),
)
sys.modules.setdefault(
    "src.logger.logging",
    types.SimpleNamespace(
        get_logger=lambda _name: types.SimpleNamespace(
            info=lambda *args, **kwargs: None,
            warning=lambda *args, **kwargs: None,
        )
    ),
)
sys.modules.setdefault(
    "src.similarity_search.embeddings",
    types.SimpleNamespace(get_embeddings=lambda user_id: None),
)

from src.evaluation import semantic_match


class FakeEmbeddings:
    def __init__(self, mapping):
        self.mapping = mapping

    def embed_query(self, text):
        return self.mapping[text]


def test_evaluate_semantic_match_includes_evidence_consistency(monkeypatch):
    mapping = {
        "baseline output": [1.0, 0.0],
        "current output": [1.0, 0.0],
        "baseline evidence A\n\nbaseline evidence B": [1.0, 0.0],
        "current evidence A\n\ncurrent evidence B": [0.0, 1.0],
    }

    monkeypatch.setattr(
        semantic_match,
        "get_embeddings",
        lambda user_id: FakeEmbeddings(mapping),
    )

    async def fake_judge_semantic_match(**kwargs):
        return {
            "semantic_match_score": 80,
            "reason": "Meaning is mostly preserved.",
            "missing_points": ["One detail omitted"],
            "changed_points": ["Evidence shifted"],
            "_model": "test-judge",
        }

    monkeypatch.setattr(
        semantic_match,
        "_judge_semantic_match",
        fake_judge_semantic_match,
    )

    result = asyncio.run(
        semantic_match.evaluate_semantic_match(
            baseline_output="baseline output",
            current_output="current output",
            user_id="u1",
            task_title="Task",
            task_description="Desc",
            baseline_tool_summaries=["baseline evidence A", "baseline evidence B"],
            current_tool_summaries=["current evidence A", "current evidence B"],
        )
    )

    assert result is not None
    assert result["semantic_similarity_score"] == 100
    assert result["evidence_consistency_score"] == 50
    assert result["judge_score"] == 80
    assert result["match_score"] == 82
    assert result["reason"] == "Meaning is mostly preserved."
    assert result["missing_points"] == ["One detail omitted"]
    assert result["changed_points"] == ["Evidence shifted"]


def test_evaluate_semantic_match_falls_back_when_evidence_missing(monkeypatch):
    mapping = {
        "baseline output": [1.0, 0.0],
        "current output": [0.0, 1.0],
    }

    monkeypatch.setattr(
        semantic_match,
        "get_embeddings",
        lambda user_id: FakeEmbeddings(mapping),
    )

    async def fake_judge_semantic_match(**kwargs):
        return {
            "semantic_match_score": 40,
            "reason": "Outputs diverge.",
            "missing_points": [],
            "changed_points": ["Different conclusion"],
            "_model": "test-judge",
        }

    monkeypatch.setattr(
        semantic_match,
        "_judge_semantic_match",
        fake_judge_semantic_match,
    )

    result = asyncio.run(
        semantic_match.evaluate_semantic_match(
            baseline_output="baseline output",
            current_output="current output",
            user_id="u1",
            baseline_tool_summaries=[],
            current_tool_summaries=[],
        )
    )

    assert result is not None
    assert result["semantic_similarity_score"] == 50
    assert result["evidence_consistency_score"] == 50
    assert result["judge_score"] == 40
    assert result["match_score"] == 48
