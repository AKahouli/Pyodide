"""Tests for AgentSuggestionGenerator."""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
import json

from src.smart_rag.agents.generators.suggestions_generator import AgentSuggestionGenerator


class TestAgentSuggestionGenerator:
    """Test cases for AgentSuggestionGenerator."""

    def test_init_with_string_chatbot_name(self):
        """Test initialization with string chatbot name."""
        mock_processor = MagicMock()
        mock_factory = MagicMock()

        generator = AgentSuggestionGenerator(mock_processor, mock_factory, "test-model")

        assert generator.prompt_processor == mock_processor
        assert generator.llm_factory == mock_factory
        assert generator.chatbot_name == "test-model"

    def test_init_with_dict_chatbot_name(self):
        """Test initialization with dict chatbot name."""
        mock_processor = MagicMock()
        mock_factory = MagicMock()
        chatbot_dict = {"provider": "openai", "model": "gpt-4"}

        generator = AgentSuggestionGenerator(mock_processor, mock_factory, chatbot_dict)

        assert generator.chatbot_name == "openai"

    @pytest.mark.asyncio
    @patch('src.smart_rag.agents.generators.suggestions_generator.DatabaseSessionService')
    @patch('src.smart_rag.agents.generators.suggestions_generator.Runner')
    @patch('src.smart_rag.agents.generators.suggestions_generator.Agent')
    @patch('src.smart_rag.agents.generators.suggestions_generator.model_supports_structured_output')
    @patch('src.smart_rag.agents.generators.suggestions_generator.parse_suggestions_response')
    async def test_generate_suggestions_success(self, mock_parse, mock_supports_structured, mock_agent_class, mock_runner_class, mock_db_session_class):
        """Test successful suggestion generation."""
        mock_processor = MagicMock()
        mock_factory = MagicMock()
        mock_agent = MagicMock()
        mock_agent.name = "AgentSuggestionGenerator"
        mock_agent.instruction = "Generate suggestions"

        # Setup DatabaseSessionService mock
        mock_db_session = MagicMock()
        mock_db_session.get_session = AsyncMock(return_value=None)  # No existing session
        mock_db_session.create_session = AsyncMock(return_value=MagicMock())
        mock_db_session_class.return_value = mock_db_session

        # Setup Runner mock
        mock_runner = MagicMock()
        mock_event = MagicMock()
        mock_event.content.parts = [MagicMock(text='{"suggestions": [{"name": "TestAgent"}]}')]

        # Create async generator for run_async
        async def mock_run_async(*args, **kwargs):
            yield mock_event

        mock_runner.run_async = mock_run_async
        mock_runner_class.return_value = mock_runner

        # Setup other mocks
        mock_factory.create_no_tool_calls_llm.return_value = "test-model-string"
        mock_agent_class.return_value = mock_agent
        mock_supports_structured.return_value = False  # Uses non-structured path
        mock_parse.return_value = {"suggestions": [{"name": "TestAgent"}], "available_agent_ids": []}

        generator = AgentSuggestionGenerator(mock_processor, mock_factory, "test-model")

        # Test parameters
        suggestions_prompt = "Generate agent suggestions for {available_agents_str}"
        user_prompt = "Help me with data analysis"
        available_agents = []
        config = MagicMock()
        config.user_id = "user123"
        config.workspace_name = ["brain1"]

        result = await generator.generate_suggestions(
            "test-session-id", suggestions_prompt, user_prompt, available_agents, config
        )

        # Verify result is a tuple with response and agent_id_mapping
        assert isinstance(result, tuple)
        assert len(result) == 2
        response, agent_id_mapping = result
        assert isinstance(agent_id_mapping, dict)  # Should be the agent_id_mapping

    @pytest.mark.asyncio
    async def test_generate_suggestions_exception_handling(self, mock_external_deps):
        """Test exception handling in suggestion generation."""
        mock_processor = MagicMock()
        mock_factory = MagicMock()
        mock_factory.create_no_tool_calls_llm.side_effect = Exception("LLM creation failed")

        generator = AgentSuggestionGenerator(mock_processor, mock_factory, "test-model")

        config = MagicMock()
        config.user_id = "user123"
        config.workspace_name = ["brain1"]

        result = await generator.generate_suggestions("test-session-id", "prompt", "user prompt", [], config)
        assert result == []


    def test_chatbot_name_extraction_from_complex_dict(self):
        """Test chatbot name extraction from complex dictionary."""
        mock_processor = MagicMock()
        mock_factory = MagicMock()

        complex_dict = {
            "provider": "anthropic",
            "model": "claude-3",
            "settings": {"temperature": 0.7}
        }

        generator = AgentSuggestionGenerator(mock_processor, mock_factory, complex_dict)

        assert generator.chatbot_name == "anthropic"

    def test_chatbot_name_extraction_from_dict_without_provider(self):
        """Test chatbot name extraction from dict without provider key."""
        mock_processor = MagicMock()
        mock_factory = MagicMock()

        dict_without_provider = {
            "model": "claude-3",
            "settings": {"temperature": 0.7}
        }

        generator = AgentSuggestionGenerator(mock_processor, mock_factory, dict_without_provider)

        # Should convert to string and use None value
        assert generator.chatbot_name == "None"