"""Tests for Qdrant filter conversion."""

from src.similarity_search.qdrant_search.filter import dict_to_qdrant_filter


def test_workspace_id_filters_metadata_workspace_id() -> None:
    qdrant_filter = dict_to_qdrant_filter({"workspace_id": ["workspace-1", "workspace-2"]})

    assert qdrant_filter is not None
    assert qdrant_filter.must[0].key == "metadata.workspace_id"


def test_file_name_and_user_id_are_supported_filters() -> None:
    qdrant_filter = dict_to_qdrant_filter({
        "workspace_id": ["workspace-1"],
        "file_name": "report.pdf",
        "user_id": "user-1",
    })

    assert qdrant_filter is not None
    assert [condition.key for condition in qdrant_filter.must] == [
        "metadata.workspace_id",
        "metadata.file_name",
        "metadata.user_id",
    ]


def test_legacy_qdrant_filters_are_ignored() -> None:
    qdrant_filter = dict_to_qdrant_filter({
        "brain_id": "brain-1",
        "external_id": "document-1",
        "language": "en",
    })

    assert qdrant_filter is None
