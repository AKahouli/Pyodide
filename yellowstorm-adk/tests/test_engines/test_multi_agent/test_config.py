"""Tests for multi-agent engine configuration."""

import pytest
from unittest.mock import patch

from src.smart_rag.engines.multi_agent.config import (
    AgentTeamConfig,
    DEFAULT_AGENT_NAME,
    DELEGATE_FUNCTION_PREFIX,
    MANAGER_AGENT_NAME,
    TOOL_DESCRIPTIONS,
    FUNCTION_NAME_PATTERN,
    AGENT_MENTION_PATTERN
)


class TestAgentTeamConfig:
    """Test cases for AgentTeamConfig dataclass."""

    def test_config_initialization_minimal(self):
        """Test config initialization with minimal required parameters."""
        config = AgentTeamConfig(
            session_id="test-session-123",
            user_id="user-456",
            chatbot_name={"provider": "openai", "model": "gpt-4"}
        )

        assert config.session_id == "test-session-123"
        assert config.user_id == "user-456"
        assert config.chatbot_name == {"provider": "openai", "model": "gpt-4"}
        assert config.doc_tree is None
        assert config.brain_tree is None
        assert config.brain_ids is None
        assert config.vectorstore_name == "default"

    def test_config_initialization_full(self):
        """Test config initialization with all parameters."""
        doc_tree = [{"id": "doc1", "name": "Document 1"}]
        brain_tree = [{"id": "brain1", "name": "Brain 1"}]
        brain_ids = ["brain1", "brain2"]

        config = AgentTeamConfig(
            session_id="test-session-456",
            user_id="user-789",
            chatbot_name={"provider": "anthropic", "model": "claude-3"},
            doc_tree=doc_tree,
            brain_tree=brain_tree,
            brain_ids=brain_ids,
            vectorstore_name="custom-vectorstore"
        )

        assert config.session_id == "test-session-456"
        assert config.user_id == "user-789"
        assert config.chatbot_name == {"provider": "anthropic", "model": "claude-3"}
        assert config.doc_tree == doc_tree
        assert config.brain_tree == brain_tree
        assert config.brain_ids == brain_ids
        assert config.vectorstore_name == "custom-vectorstore"

    def test_config_defaults(self):
        """Test that default values are properly set."""
        config = AgentTeamConfig(
            session_id="test",
            user_id="user",
            chatbot_name={}
        )

        # Test defaults
        assert config.vectorstore_name == "default"
        assert config.doc_tree is None
        assert config.brain_tree is None
        assert config.brain_ids is None

    def test_config_mutability(self):
        """Test that config fields can be modified after creation."""
        config = AgentTeamConfig(
            session_id="test",
            user_id="user",
            chatbot_name={}
        )

        # Modify fields
        config.top_k = 15
        config.vectorstore_name = "modified-store"
        config.brain_ids = ["new-brain"]

        assert config.top_k == 15
        assert config.vectorstore_name == "modified-store"
        assert config.brain_ids == ["new-brain"]

    def test_config_with_complex_chatbot_name(self):
        """Test config with complex chatbot name structure."""
        complex_chatbot = {
            "provider": "openai",
            "model": "gpt-4-turbo",
            "settings": {
                "temperature": 0.7,
                "max_tokens": 2000
            },
            "features": ["streaming", "function_calling"]
        }

        config = AgentTeamConfig(
            session_id="test",
            user_id="user",
            chatbot_name=complex_chatbot
        )

        assert config.chatbot_name == complex_chatbot
        assert config.chatbot_name["provider"] == "openai"
        assert config.chatbot_name["settings"]["temperature"] == 0.7


class TestConstants:
    """Test cases for configuration constants."""

    def test_default_agent_name(self):
        """Test default agent name constant."""
        assert DEFAULT_AGENT_NAME == "agent"

    def test_delegate_function_prefix(self):
        """Test delegate function prefix constant."""
        assert DELEGATE_FUNCTION_PREFIX == "delegate_to_"

    def test_manager_agent_name(self):
        """Test manager agent name constant."""
        assert MANAGER_AGENT_NAME == "manager_agent"

    def test_function_name_pattern(self):
        """Test function name regex pattern."""
        import re
        pattern = re.compile(FUNCTION_NAME_PATTERN)

        # Should match non-alphanumeric characters (except underscore, dot, dash)
        assert pattern.search("@")
        assert pattern.search("#")
        assert pattern.search("!")
        assert pattern.search(" ")

        # Should not match valid characters
        assert not pattern.search("a")
        assert not pattern.search("1")
        assert not pattern.search("_")
        assert not pattern.search(".")
        assert not pattern.search("-")

    def test_agent_mention_pattern(self):
        """Test agent mention regex pattern."""
        import re
        pattern = re.compile(AGENT_MENTION_PATTERN)

        # Should match agent mentions
        matches = pattern.findall("Please use @SearchAgent and @CalculatorAgent")
        assert "SearchAgent" in matches
        assert "CalculatorAgent" in matches

        # Should match single agent mention
        matches = pattern.findall("Call @DataAnalyst for help")
        assert "DataAnalyst" in matches

        # Should not match invalid patterns
        matches = pattern.findall("Email user@domain.com")
        assert len(matches) == 0  # Should not match email

    def test_tool_descriptions_structure(self):
        """Test tool descriptions dictionary structure."""
        assert isinstance(TOOL_DESCRIPTIONS, dict)
        assert "calculator" in TOOL_DESCRIPTIONS
        assert "search" in TOOL_DESCRIPTIONS
        assert "search_web" in TOOL_DESCRIPTIONS
        assert "in_memory" in TOOL_DESCRIPTIONS

        # Each description should be a non-empty string
        for tool_name, description in TOOL_DESCRIPTIONS.items():
            assert isinstance(description, str)
            assert len(description.strip()) > 0
            assert "Tool" in description  # Should contain the word "Tool"

    def test_tool_descriptions_content(self):
        """Test specific content of tool descriptions."""
        # Calculator description should mention mathematical operations
        calc_desc = TOOL_DESCRIPTIONS["calculator"]
        assert "mathematical" in calc_desc.lower() or "calculation" in calc_desc.lower()

        # Search description should mention documents
        search_desc = TOOL_DESCRIPTIONS["search"]
        assert "document" in search_desc.lower() or "search" in search_desc.lower()

        # Web search description should mention internet or web
        web_desc = TOOL_DESCRIPTIONS["search_web"]
        assert "web" in web_desc.lower() or "internet" in web_desc.lower()

        # In-memory description should mention files or documents
        memory_desc = TOOL_DESCRIPTIONS["in_memory"]
        assert "document" in memory_desc.lower() or "file" in memory_desc.lower()

    @patch('src.smart_rag.engines.multi_agent.config.get_settings')
    def test_settings_integration(self, mock_get_settings):
        """Test integration with application settings."""
        mock_settings = type('MockSettings', (), {
            'LANGFUSE_PUBLIC_KEY': 'test-public-key',
            'LANGFUSE_SECRET_KEY': 'test-secret-key',
            'LANGFUSE_HOST': 'https://test.langfuse.com'
        })()
        mock_get_settings.return_value = mock_settings

        # Import after mocking to ensure mock is used
        from src.smart_rag.engines.multi_agent.config import app_settings

        assert hasattr(app_settings, 'LANGFUSE_PUBLIC_KEY')
        assert hasattr(app_settings, 'LANGFUSE_SECRET_KEY')
        assert hasattr(app_settings, 'LANGFUSE_HOST')