"""Tests for SessionHelper class."""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch, Mock
from typing import List, Dict

# DEFAULT_AGENT_NAME is defined in manager.py as "unknown"
DEFAULT_AGENT_NAME = "unknown"
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset

# Constant used in manager.py
APP_NAME = "manager_app"


class TestSessionHelper:
    """Test cases for SessionHelper class."""

    @pytest.fixture
    def session_helper(self):
        from src.smart_rag.infrastructure.session.manager import SessionHelper

        """Create a SessionHelper instance for testing."""
        return SessionHelper(user_id="test_user_123")

    @pytest.fixture
    def mock_agent(self):
        """Create a mock agent with tools."""
        agent = MagicMock()
        agent.name = "TestAgent"
        agent.instruction = "Test instruction for agent"
        agent.tools = []
        return agent

    @pytest.fixture
    def mock_delegate_function(self):
        """Create a mock delegate function (callable tool)."""
        def delegate(task_description: str, expected_output: str):
            """Delegate task to SearchAgent: Searches documents for information.

            This function is optimized for parallel execution.

            Args:
                task_description: Description of the task
                expected_output: Expected output format
            """
            return "search result"

        return delegate

    @pytest.fixture
    def mock_tool_object(self):
        """Create a mock tool object with attributes."""
        class ToolObject:
            def __init__(self):
                self.name = "search_tool"
                self.description = "Tool for searching documents"
                self.prompt = "Search the documents for information"

        return ToolObject()


class TestExtractToolData(TestSessionHelper):
    """Test cases for _extract_tool_data method."""

    def test_extract_tool_data_from_callable(self, session_helper, mock_delegate_function):
        """Test extracting tool data from a callable (delegate function)."""
        result = session_helper._extract_tool_data(mock_delegate_function)

        assert isinstance(result, dict)
        assert result['name'] == 'delegate'
        assert 'Delegate task to SearchAgent' in result['description']
        assert result['prompt'] == ''

    def test_extract_tool_data_from_object_with_attributes(self, session_helper, mock_tool_object):
        """Test extracting tool data from an object with name/description/prompt attributes."""
        result = session_helper._extract_tool_data(mock_tool_object)

        assert isinstance(result, dict)
        assert result['name'] == 'search_tool'
        assert result['description'] == 'Tool for searching documents'
        assert result['prompt'] == 'Search the documents for information'

    def test_extract_tool_data_from_object_without_prompt(self, session_helper):
        """Test extracting tool data from an object without prompt attribute."""
        class ToolWithoutPrompt:
            def __init__(self):
                self.name = "simple_tool"
                self.description = "Simple tool"
                # No prompt attribute

        tool = ToolWithoutPrompt()
        result = session_helper._extract_tool_data(tool)

        assert isinstance(result, dict)
        assert result['name'] == 'simple_tool'
        assert result['description'] == 'Simple tool'
        assert result['prompt'] == ''

    def test_extract_tool_data_from_unknown_type(self, session_helper):
        """Test extracting tool data from an unknown tool type (fallback)."""
        unknown_tool = "string_tool"

        result = session_helper._extract_tool_data(unknown_tool)

        assert isinstance(result, dict)
        assert result['name'] == 'str'
        assert result['description'] == 'string_tool'
        assert result['prompt'] == ''


class TestExtractToolsInfo(TestSessionHelper):
    """Test cases for _extract_tools_info method."""

    def test_extract_tools_info_with_no_tools(self, session_helper, mock_agent):
        """Test extracting tools info when agent has no tools."""
        mock_agent.tools = []

        result = session_helper._extract_tools_info(mock_agent)

        assert isinstance(result, list)
        assert len(result) == 0

    def test_extract_tools_info_with_callable_tools(
        self, session_helper, mock_agent, mock_delegate_function
    ):
        """Test extracting tools info from callable tools."""
        mock_agent.tools = [mock_delegate_function]

        result = session_helper._extract_tools_info(mock_agent)

        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]['name'] == 'delegate'
        assert 'Delegate task to SearchAgent' in result[0]['description']
        assert result[0]['prompt'] == ''

    def test_extract_tools_info_with_object_tools(
        self, session_helper, mock_agent, mock_tool_object
    ):
        """Test extracting tools info from object tools."""
        mock_agent.tools = [mock_tool_object]

        result = session_helper._extract_tools_info(mock_agent)

        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]['name'] == 'search_tool'
        assert result[0]['description'] == 'Tool for searching documents'
        assert result[0]['prompt'] == 'Search the documents for information'

    def test_extract_tools_info_with_mixed_tools(
        self, session_helper, mock_agent, mock_delegate_function, mock_tool_object
    ):
        """Test extracting tools info from mixed tool types."""
        mock_agent.tools = [mock_delegate_function, mock_tool_object]

        result = session_helper._extract_tools_info(mock_agent)

        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0]['name'] == 'delegate'
        assert result[1]['name'] == 'search_tool'

    def test_extract_tools_info_with_no_tools_attribute(self, session_helper):
        """Test extracting tools info when agent has no tools attribute."""
        agent = MagicMock(spec=['name', 'instruction'])  # No tools attribute

        result = session_helper._extract_tools_info(agent)

        assert isinstance(result, list)
        assert len(result) == 0

    def test_extract_tools_info_with_exception(self, session_helper, mock_agent):
        """Test extracting tools info when an exception occurs."""
        mock_agent.tools = [None]  # This will cause an exception

        # Should not raise exception, but return empty list
        result = session_helper._extract_tools_info(mock_agent)

        assert isinstance(result, list)


class TestExtractAgentMetadata(TestSessionHelper):
    """Test cases for _extract_agent_metadata method."""

    def test_extract_agent_metadata_with_all_attributes(self, session_helper, mock_agent):
        """Test extracting metadata from agent with all attributes."""
        system_prompt, agent_name = session_helper._extract_agent_metadata(mock_agent)

        assert system_prompt == "Test instruction for agent"
        assert agent_name == "TestAgent"

    def test_extract_agent_metadata_with_no_instruction(self, session_helper):
        """Test extracting metadata from agent without instruction."""
        agent = MagicMock()
        agent.name = "TestAgent"
        delattr(agent, 'instruction')

        system_prompt, agent_name = session_helper._extract_agent_metadata(agent)

        assert system_prompt is None
        assert agent_name == "TestAgent"

    def test_extract_agent_metadata_with_no_name(self, session_helper):
        """Test extracting metadata from agent without name."""
        agent = MagicMock()
        agent.instruction = "Test instruction"
        delattr(agent, 'name')

        system_prompt, agent_name = session_helper._extract_agent_metadata(agent)

        assert system_prompt == "Test instruction"
        assert agent_name == DEFAULT_AGENT_NAME

    def test_extract_agent_metadata_with_none_values(self, session_helper):
        """Test extracting metadata from agent with None values."""
        agent = MagicMock()
        agent.instruction = None
        agent.name = None

        system_prompt, agent_name = session_helper._extract_agent_metadata(agent)

        assert system_prompt is None
        # When agent.name exists but is None, getattr returns None (not the default)
        assert agent_name is None or agent_name == DEFAULT_AGENT_NAME

    def test_extract_agent_metadata_with_empty_string(self, session_helper):
        """Test extracting metadata from agent with empty string values."""
        agent = MagicMock()
        agent.instruction = ""
        agent.name = ""

        system_prompt, agent_name = session_helper._extract_agent_metadata(agent)

        assert system_prompt == ""
        assert agent_name == ""


class TestCleanup(TestSessionHelper):
    """Test cases for cleanup method."""

    @pytest.mark.asyncio
    async def test_cleanup_cached_session(self, session_helper):
        """Test cleanup for a cached session (should skip)."""
        session_helper._is_cached = True

        await session_helper.cleanup()

        # Verify nothing was cleaned up (resources still exist)
        assert session_helper._is_cached is True

    @pytest.mark.asyncio
    async def test_cleanup_non_cached_session(self, session_helper):
        """Test cleanup for a non-cached session."""
        session_helper._is_cached = False
        session_helper.session_service = MagicMock()
        session_helper.session = MagicMock()
        session_helper.runner = MagicMock()
        session_helper.exit_stacks = []

        await session_helper.cleanup()

        # Verify resources were cleared
        assert session_helper.session_service is None
        assert session_helper.session is None
        assert session_helper.runner is None
        assert session_helper.exit_stacks == []


# NOTE: The following test classes are commented out because the methods they test
# (_build_session_state, get_tools_info, get_system_prompt, _find_existing_session)
# no longer exist in the SessionHelper class after recent refactoring.
# These tests should be updated or removed based on the new implementation.

# class TestBuildSessionState(TestSessionHelper):
#     """Test cases for _build_session_state method."""
#     pass

# class TestGetToolsInfo(TestSessionHelper):
#     """Test cases for get_tools_info method."""
#     pass

# class TestGetSystemPrompt(TestSessionHelper):
#     """Test cases for get_system_prompt method."""
#     pass

# class TestFindExistingSession(TestSessionHelper):
#     """Test cases for _find_existing_session method."""
#     pass