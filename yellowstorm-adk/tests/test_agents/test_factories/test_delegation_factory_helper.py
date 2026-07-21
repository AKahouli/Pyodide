"""Unit tests for delegation_factory_helper module functions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.agents.factories.delegation_factory_helper import (
    _append_connector_repo_context,
    _append_workspace_document_context,
    _build_connector_repo_fixed_params,
    _build_mcp_context_note,
    _build_workspace_document_context,
    _extract_original_expected_output,
    _get_connector_repo,
    _get_team_skills,
    _inject_connector_repo_into_bindings,
    _resolve_temperature,
    get_enhanced_prompt,
    merge_skills,
    prepare_agent_data,
)


def test_resolve_temperature_normalizes_grpc_string_values():
    assert _resolve_temperature({"temperature": "0.25"}) == 0.25
    assert _resolve_temperature({"omit_temperature": "true", "temperature": "0"}) is None
    assert _resolve_temperature({"temperature": "invalid"}) == 0.0


class TestConnectorRepoHelpers:
    def test_build_connector_repo_fixed_params_owner_repo(self):
        params = _build_connector_repo_fixed_params({
            "repo_name": "acme/widget",
            "repo_id": "1",
            "repo_url": "https://example.com",
        })
        assert params["owner"] == "acme"
        assert params["repo"] == "widget"
        assert params["repository"] == "acme/widget"

    def test_build_connector_repo_fixed_params_missing_name(self):
        assert _build_connector_repo_fixed_params({"repo_id": "1"}) == {}

    def test_inject_connector_repo_into_bindings(self):
        bindings = [{"connector_id": "c1", "fixed_params": {"branch": "main"}}]
        repo = {"connector_id": "c1", "repo_name": "org/app", "repo_url": "https://x"}
        result = _inject_connector_repo_into_bindings(bindings, repo)
        assert result[0]["fixed_params"]["repo_name"] == "org/app"
        assert result[0]["fixed_params"]["branch"] == "main"

    def test_append_connector_repo_context(self):
        prompt = _append_connector_repo_context(
            "base",
            {"connector_name": "GitHub", "repo_name": "org/app", "repo_url": "https://x"},
        )
        assert "<selected_connector_repository>" in prompt
        assert "org/app" in prompt

    def test_build_workspace_document_context_dedupes(self):
        docs = [
            {"filename": "a.pdf", "file_name": "a.pdf", "workspace_id": "w1"},
            {"filename": "a.pdf", "file_name": "a.pdf", "workspace_id": "w1"},
        ]
        context = _build_workspace_document_context(docs)
        assert context.count("a.pdf") == 2

    def test_append_workspace_document_context(self):
        result = _append_workspace_document_context(
            "prompt",
            [{"filename": "doc.pdf", "workspace_id": "w1"}],
        )
        assert "<workspace_documents>" in result


class TestSkillAndConfigHelpers:
    def test_merge_skills_deduplicates_by_id(self):
        team = [{"id": "s1", "name": "Search"}]
        agent = [{"id": "s1", "name": "Search"}, {"id": "s2", "name": "Calc"}]
        merged = merge_skills(agent, team)
        assert len(merged) == 2
        assert merged[1]["id"] == "s2"

    def test_get_connector_repo_and_team_skills(self):
        config = SimpleNamespace(
            connector_repo={"repo_name": "r"},
            skills=[{"id": "s1"}],
        )
        assert _get_connector_repo(config)["repo_name"] == "r"
        assert _get_team_skills(config) == [{"id": "s1"}]

    def test_build_mcp_context_note(self):
        config = SimpleNamespace(user_id="u1", brain_ids=["w1"])
        note = _build_mcp_context_note(
            config,
            {
                "mcp": {"transport_type": "streamable_http"},
                "file_names": ["a.pdf"],
            },
        )
        assert "user_id" in note
        assert "workspace_id" in note
        assert "file_name" in note

    def test_extract_original_expected_output(self):
        raw = "Task ##original_expected_output##JSON table##/original_expected_output##"
        cleaned, original = _extract_original_expected_output(raw)
        assert cleaned == "Task"
        assert original == "JSON table"


class TestPrepareAgentData:
    def test_prepare_agent_data_appends_tool_prompts(self):
        helper = MagicMock()
        config = SimpleNamespace(brain_ids=["b1"], vectorstore_name="vs")
        agent_config = {
            "brain_documents": [],
            "brain_relations": {},
            "tools": [{"name": "search", "prompt": "Use top_k wisely"}],
            "brain_ids": ["b2"],
            "vectorstore_name": "custom-vs",
            "chatbot_name": {"provider": "gpt-4o"},
        }
        with patch("src.smart_rag.agents.factories.delegation_factory_helper.build_tree", return_value=([], {})):
            result = prepare_agent_data(helper, config, agent_config, ["search"], "base", "bot")
        assert result[2].startswith("base")
        assert "Use top_k wisely" in result[2]
        assert result[3] == ["b2"]
        assert result[4] == "custom-vs"
        assert result[5] == "gpt-4o"

    def test_get_enhanced_prompt_adds_document_tree(self):
        helper = MagicMock()
        helper.get_document_tree_info.return_value = "\n<docs/>"
        prompt = get_enhanced_prompt(helper, [{"id": "d1"}], {}, ["search"], "base")
        assert prompt.endswith("<docs/>")
