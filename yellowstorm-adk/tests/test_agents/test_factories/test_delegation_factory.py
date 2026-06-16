"""Tests for AgentDelegationFactory."""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock

from src.smart_rag.agents.factories.delegation_factory import AgentDelegationFactory
from src.smart_rag.agents.factories.delegation_factory_helper import (
    _append_connector_repo_context,
    _append_workspace_document_context,
    _inject_connector_repo_into_bindings,
)


class TestAgentDelegationFactory:
    """Test cases for AgentDelegationFactory."""

    def test_init(self):
        """Test factory initialization."""
        mock_config = MagicMock()
        mock_agent_factory = MagicMock()
        mock_agent_runner = MagicMock()
        mock_agent_repository = MagicMock()
        mock_agent_helper = MagicMock()
        mock_tool_provider = MagicMock()
        mock_citation_manager = MagicMock()

        factory = AgentDelegationFactory(
            mock_config, mock_agent_factory, mock_agent_runner,
            mock_agent_repository, mock_agent_helper, mock_tool_provider, mock_citation_manager
        )

        assert factory.config == mock_config
        assert factory.agent_factory == mock_agent_factory
        assert factory.agent_runner == mock_agent_runner
        assert factory.agent_repository == mock_agent_repository

    def test_init_with_chatbot_name(self):
        """Test initialization with chatbot name in config."""
        mock_config = MagicMock()
        mock_config.chatbot_name = "test_model"
        mock_agent_factory = MagicMock()
        mock_agent_runner = MagicMock()
        mock_agent_repository = MagicMock()
        mock_agent_helper = MagicMock()
        mock_tool_provider = MagicMock()

        factory = AgentDelegationFactory(
            mock_config, mock_agent_factory, mock_agent_runner,
            mock_agent_repository, mock_agent_helper, mock_tool_provider, MagicMock()
        )

        assert factory.chatbot_name == "test_model"

    def test_make_delegate_function_basic(self):
        """Test creating a basic delegate function."""
        mock_config = MagicMock()
        mock_config.session_id = "session123"
        mock_agent_factory = MagicMock()
        mock_agent_runner = MagicMock()
        mock_agent_repository = MagicMock()
        mock_agent_helper = MagicMock()
        mock_tool_provider = MagicMock()

        factory = AgentDelegationFactory(
            mock_config, mock_agent_factory, mock_agent_runner,
            mock_agent_repository, mock_agent_helper, mock_tool_provider, MagicMock()
        )

        # Mock agent repository response
        mock_agent_helper.normalize_agent_name.return_value = "test_agent"
        mock_agent_repository.get_agent_by_name.return_value = {
            "name": "TestAgent",
            "description": "Test agent description"
        }

        with patch('src.smart_rag.agents.factories.delegation_factory.langfuse_client'):
            delegate_func = factory.make_delegate_function("TestAgent")

            assert callable(delegate_func)
            assert delegate_func.__doc__ is not None

    def test_task_search_order_counter(self):
        """Test task search order counter initialization."""
        mock_config = MagicMock()
        mock_agent_factory = MagicMock()
        mock_agent_runner = MagicMock()
        mock_agent_repository = MagicMock()
        mock_agent_helper = MagicMock()
        mock_tool_provider = MagicMock()

        factory = AgentDelegationFactory(
            mock_config, mock_agent_factory, mock_agent_runner,
            mock_agent_repository, mock_agent_helper, mock_tool_provider, MagicMock()
        )

        assert factory.task_search_order == 0

    @pytest.mark.asyncio
    async def test_delegate_function_execution(self):
        """Test delegate function execution."""
        mock_config = MagicMock()
        mock_config.session_id = "session123"
        mock_config.user_id = "user456"
        mock_agent_factory = MagicMock()
        mock_agent_runner = MagicMock()
        mock_agent_repository = MagicMock()
        mock_agent_helper = MagicMock()
        mock_tool_provider = MagicMock()

        factory = AgentDelegationFactory(
            mock_config, mock_agent_factory, mock_agent_runner,
            mock_agent_repository, mock_agent_helper, mock_tool_provider, MagicMock()
        )

        # Mock dependencies
        mock_agent_helper.normalize_agent_name.return_value = "test_agent"
        mock_agent_repository.get_agent_by_name.return_value = {
            "name": "TestAgent",
            "description": "Test agent description",
            "tools": ["search"]
        }
        mock_agent_repository.get_agent_id_by_name.return_value = "agent123"

        with patch('src.smart_rag.agents.factories.delegation_factory.langfuse_client') as mock_langfuse:
            mock_span = MagicMock()
            mock_langfuse.span.return_value = mock_span

            with patch.object(factory, '_create_agent_with_error_handling', new_callable=AsyncMock) as mock_create:
                mock_agent = MagicMock()
                mock_toolkit = MagicMock()
                mock_create.return_value = (mock_agent, mock_toolkit)

                with patch.object(factory, '_execute_agent_with_error_handling', new_callable=AsyncMock) as mock_execute:
                    mock_execute.return_value = "Test result"

                    delegate_func = factory.make_delegate_function("TestAgent")
                    result = await delegate_func("Test task", "Expected output")

                    assert result == "Test result"
                    mock_create.assert_called_once()
                    mock_execute.assert_called_once()

    def test_agent_not_found_scenario(self):
        """Test scenario when agent is not found."""
        mock_config = MagicMock()
        mock_agent_factory = MagicMock()
        mock_agent_runner = MagicMock()
        mock_agent_repository = MagicMock()
        mock_agent_helper = MagicMock()
        mock_tool_provider = MagicMock()

        factory = AgentDelegationFactory(
            mock_config, mock_agent_factory, mock_agent_runner,
            mock_agent_repository, mock_agent_helper, mock_tool_provider, MagicMock()
        )

        # Mock agent not found
        mock_agent_helper.normalize_agent_name.return_value = "nonexistent_agent"
        mock_agent_repository.get_agent_by_name.return_value = None

        with patch('src.smart_rag.agents.factories.delegation_factory.langfuse_client'):
            delegate_func = factory.make_delegate_function("NonexistentAgent")

            assert callable(delegate_func)
            assert "Agent not found" in delegate_func.__doc__

    def test_inject_connector_repo_adds_github_aliases(self):
        bindings = [{"connector_id": "connector-1", "fixed_params": {"existing": "value"}}]

        augmented = _inject_connector_repo_into_bindings(
            bindings,
            {
                "connector_id": "connector-1",
                "repo_id": "repo-1",
                "repo_name": "org-name/repo-name",
                "repo_url": "https://github.com/org-name/repo-name",
            },
        )

        assert augmented[0]["fixed_params"] == {
            "existing": "value",
            "repo_id": "repo-1",
            "repo_name": "org-name/repo-name",
            "repo_url": "https://github.com/org-name/repo-name",
            "repository": "org-name/repo-name",
            "full_name": "org-name/repo-name",
            "owner": "org-name",
            "repo_owner": "org-name",
            "repo": "repo-name",
            "repository_name": "repo-name",
        }

    def test_append_connector_repo_context_instructs_selected_repo(self):
        prompt = _append_connector_repo_context(
            "Base prompt",
            {
                "connector_name": "GitHub",
                "repo_name": "org-name/repo-name",
                "repo_url": "https://github.com/org-name/repo-name",
            },
        )

        assert "Base prompt" in prompt
        assert "Connector: GitHub" in prompt
        assert "Repository: org-name/repo-name" in prompt
        assert "Do not ask the user which repository to use." in prompt

    def test_append_workspace_document_context_exposes_mcp_identifiers(self):
        prompt = _append_workspace_document_context(
            "Base prompt",
            [
                {
                    "filename": "30-recettes.pdf",
                    "file_name": "30-recettes.pdf",
                    "workspace_id": "workspace-1",
                    "workspace_name": "Recipes",
                }
            ],
        )

        assert "Base prompt" in prompt
        assert "<workspace_documents>" in prompt
        assert "30-recettes.pdf" in prompt
        assert "workspace-1" in prompt
        assert "Use these exact file names and workspace IDs" in prompt
