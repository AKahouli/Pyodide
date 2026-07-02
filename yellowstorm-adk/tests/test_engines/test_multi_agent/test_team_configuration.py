"""Unit tests for team configuration workflow helpers."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration import (
    _merge_attached_files_into_brain_documents,
    create_team,
    create_team_config,
)


def _request(**overrides):
    payload = {
        "session_id": "sess-1",
        "user_id": "user-1",
        "chatbot_name": {"provider": "gpt-4o"},
        "agent_mode": "manual",
        "brain_documents": [],
        "brain_relations": {"nodes": [], "relationships": []},
        "brain_ids": ["b1"],
        "vectorstore_name": "vs",
        "message": "hello",
    }
    payload.update(overrides)
    return RunAgentTeamRequest(**payload)


class TestTeamConfiguration:
    def test_merge_attached_files_deduplicates_by_id(self):
        request = _request(
            brain_documents=[{"id": "d1", "filepath": "/a", "filename": "a.pdf"}],
            attached_files=[
                {"id": "d1", "filepath": "/a", "filename": "a.pdf"},
                {"id": "d2", "filepath": "/b", "filename": "b.pdf"},
            ],
        )
        _merge_attached_files_into_brain_documents(request)
        ids = {doc["id"] for doc in request.brain_documents}
        assert ids == {"d1", "d2"}

    def test_merge_attached_files_skips_invalid_entries(self):
        request = SimpleNamespace(
            brain_documents=[],
            attached_files=[{"id": "d3"}],
            previous_attached_files=[{"id": "d4", "filepath": "/c", "filename": "c.pdf"}],
        )
        _merge_attached_files_into_brain_documents(request)
        assert len(request.brain_documents) == 1
        assert request.brain_documents[0]["id"] == "d4"

    @patch("src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration.build_tree")
    @patch(
        "src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration.normalize_skills",
        return_value=[],
    )
    def test_create_team_config_builds_agent_team_config(self, _normalize, mock_build_tree):
        mock_build_tree.return_value = ({"docs": []}, {"brains": []})
        config = create_team_config(_request())
        assert config.session_id == "sess-1"
        assert config.doc_tree == {"docs": []}
        assert config.brain_tree == {"brains": []}

    @patch(
        "src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration.AutoAgentGenerationTeam"
    )
    def test_create_team_passes_dependencies(self, mock_team_cls):
        config = MagicMock()
        config.chatbot_name = {"provider": "gpt-4o"}
        deps = {
            "prompt_processor": MagicMock(),
            "llm_factory": MagicMock(),
            "agent_factory": MagicMock(),
            "agent_runner": MagicMock(),
            "streaming_formatter": MagicMock(),
            "event_extractor": MagicMock(),
        }
        create_team(config, deps)
        mock_team_cls.assert_called_once()
