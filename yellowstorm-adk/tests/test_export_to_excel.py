import pytest

from evaluation.export_to_excel import (
    recompute_retrieval_metrics,
    recompute_summary_metrics,
)


def test_recompute_retrieval_metrics_treats_spaces_and_underscores_as_equivalent():
    results = [
        {
            "status": "completed",
            "required": ["Required File.pdf"],
            "optional": ["Optional_File.pdf"],
            "hard_negative": ["Hard Negative.pdf"],
            "metrics": {
                "retrieved_files": ["Required_File.pdf", "Optional File.pdf"],
                "required_found": [],
                "required_recall": 0.0,
                "exact_required_set_without_hard_negative": False,
            },
        }
    ]
    summary = {"results": results}

    recompute_retrieval_metrics(results)
    recompute_summary_metrics(summary, results)

    assert results[0]["metrics"]["required_found"] == ["Required File.pdf"]
    assert results[0]["metrics"]["optional_found"] == ["Optional_File.pdf"]
    assert results[0]["metrics"]["hard_negative_found"] == []
    assert results[0]["metrics"]["required_recall"] == 1.0
    assert results[0]["metrics"]["exact_required_set_without_hard_negative"] is True
    assert summary["average_required_recall"] == pytest.approx(1.0)
    assert summary["exact_set_accuracy"] == pytest.approx(1.0)


def test_recompute_retrieval_metrics_keeps_hard_negative_failure():
    results = [
        {
            "status": "completed",
            "required": ["Required_File.pdf"],
            "hard_negative": ["Hard Negative.pdf"],
            "metrics": {
                "retrieved_files": ["Required File.pdf", "Hard_Negative.pdf"],
            },
        }
    ]

    recompute_retrieval_metrics(results)

    assert results[0]["metrics"]["required_recall"] == 1.0
    assert results[0]["metrics"]["hard_negative_found"] == ["Hard Negative.pdf"]
    assert results[0]["metrics"]["exact_required_set_without_hard_negative"] is False
