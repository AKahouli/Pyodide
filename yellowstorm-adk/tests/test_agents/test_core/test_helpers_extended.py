"""Extended unit tests for AgentHelper uncovered methods."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from src.smart_rag.agents.core.helpers import AgentHelper
from src.smart_rag.engines.multi_agent.config import DEFAULT_AGENT_NAME


class TestAgentHelperExtended:
    def test_sanitize_function_name_strips_channel_suffix(self):
        assert AgentHelper.sanitize_function_name("agent<|channel|>commentary") == "agent"

    def test_sanitize_function_name_prefixes_leading_digit(self):
        assert AgentHelper.sanitize_function_name("123agent") == "_123agent"

    def test_sanitize_function_name_defaults_when_empty(self):
        assert AgentHelper.sanitize_function_name("!!!") == DEFAULT_AGENT_NAME

    def test_get_document_tree_info_includes_brain_tree(self):
        doc_tree = [{"name": "doc"}]
        brain_tree = [{"relation": "x"}]
        info = AgentHelper.get_document_tree_info(doc_tree, brain_tree)
        assert "documents_tree" in info
        assert "brain_tree" in info

    def test_get_manager_prompt_from_agents_uses_manager(self):
        agents = [{"agent_type": "manager", "name": "mgr", "prompt": "custom mgr"}]
        prompt = AgentHelper.get_manager_prompt_from_agents(agents, "fallback")
        assert prompt == "custom mgr"

    def test_get_manager_prompt_from_agents_uses_fallback(self):
        agents = [{"agent_type": "worker", "name": "w", "prompt": "p"}]
        prompt = AgentHelper.get_manager_prompt_from_agents(agents, "fallback")
        assert prompt == "fallback"

    def test_get_html_prompt_from_agents_uses_visualizer(self):
        agents = [{"agent_type": "visualizer", "name": "viz", "prompt": "html custom"}]
        prompt = AgentHelper.get_html_prompt_from_agents(agents, "fallback")
        assert prompt == "html custom"

    def test_get_html_prompt_disabled_without_visualizer(self, monkeypatch):
        monkeypatch.setattr(
            "src.smart_rag.agents.core.helpers.settings.DEFAULT_HTML_AGENT_ENABLED",
            False,
        )
        agents = [{"agent_type": "worker", "name": "w", "prompt": "p"}]
        prompt = AgentHelper.get_html_prompt_from_agents(agents, "fallback")
        assert prompt == "fallback"

    def test_build_file_context_prompt_lists_files(self):
        prompt = AgentHelper._build_file_context_prompt(
            [{"filename": "a.pdf"}, {"filename": "b.pdf"}]
        )
        assert "a.pdf" in prompt
        assert "b.pdf" in prompt

    def test_prepare_agent_data_keeps_search_when_brain_data_present(self):
        team = MagicMock()
        team.config = MagicMock()
        agent = {
            "id": "a1",
            "name": "worker",
            "description": "d",
            "prompt": "p",
            "tools": [{"name": "search"}],
            "brain_documents": [{"file_name": "doc.pdf"}],
            "brain_relations": {"nodes": [{"id": "n1"}], "relationships": []},
            "brain_ids": ["brain-1"],
            "chatbot_name": "gpt-4o",
            "vectorstore_name": "vs",
            "agent_params": {},
            "save_memory": False,
        }
        request = SimpleNamespace(
            brain_documents=[],
            brain_relations={"nodes": [], "relationships": []},
            brain_ids=["brain-1"],
            vectorstore_name="vs",
            search_web=False,
            user_id="user-1",
        )
        prepared = AgentHelper._prepare_agent_data(agent, request, team)
        assert prepared["name"] == "worker"
        assert any(
            (t.get("name") if isinstance(t, dict) else t) == "search"
            or (isinstance(t, str) and t == "search")
            for t in prepared["tools"]
        )

    def test_create_enhanced_manager_prompt_lists_agents(self):
        config = MagicMock()
        config.user_id = "user-1"
        agents = [{"name": "searcher", "description": "finds docs"}]
        prompt = AgentHelper._create_enhanced_manager_prompt("base", agents, config)
        assert "searcher" in prompt
        assert "base" in prompt
