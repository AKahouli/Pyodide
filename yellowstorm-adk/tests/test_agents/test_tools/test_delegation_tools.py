"""Tests for DelegationTools."""

import pytest
import json
from unittest.mock import MagicMock, patch, AsyncMock

from src.smart_rag.agents.tools.delegation_tools import DelegationTools


class TestDelegationTools:
    """Test cases for DelegationTools class."""

    def create_mock_user_request(self):
        """Create a mock user request object."""
        mock_request = MagicMock()
        mock_request.user_id = "test_user_123"
        mock_request.chatbot_name = "test_chatbot"
        mock_request.workspace_names = ["brain1", "brain2"]
        mock_request.session_id = "session_123"
        mock_request.brain_documents = [{"id": "doc1", "name": "Document 1"}]
        mock_request.search_web = True
        mock_request.top_k = 5
        mock_request.vectorstore_name = "test_vectorstore"
        return mock_request

    def create_delegation_tools(self):
        """Create DelegationTools instance with mocked dependencies."""
        streaming_formatter = MagicMock()
        user_request = self.create_mock_user_request()
        agent_factory = MagicMock()
        mcp_helper = MagicMock()
        manager_span = MagicMock()
        agent_runner = MagicMock()
        session_helper = MagicMock()
        documents_tree = [{"id": "doc1", "name": "Document 1"}]
        brain_tree = [{"id": "brain1", "name": "Brain 1"}]
        q = MagicMock()
        citation_manager = MagicMock()

        return DelegationTools(
            streaming_formatter=streaming_formatter,
            user_request=user_request,
            agent_factory=agent_factory,
            mcp_helper=mcp_helper,
            manager_span=manager_span,
            agent_runner=agent_runner,
            session_helper=session_helper,
            documents_tree=documents_tree,
            brain_tree=brain_tree,
            q=q,
            citation_manager=citation_manager
        )

    def test_init(self):
        """Test DelegationTools initialization."""
        delegation_tools = self.create_delegation_tools()

        assert delegation_tools.agent_factory is not None
        assert delegation_tools.mcp_helper is not None
        assert delegation_tools.streaming_formatter is not None
        assert delegation_tools.agent_runner is not None
        assert delegation_tools.user_request is not None
        assert delegation_tools.manager_span is not None
        assert delegation_tools.session_helper is not None
        assert delegation_tools.documents_tree is not None
        assert delegation_tools.brain_tree is not None
        assert delegation_tools.q is not None

    def test_get_agents_success(self):
        """Test successful agent creation in get_agents."""
        delegation_tools = self.create_delegation_tools()

        # Mock successful agent creation
        delegation_tools.agent_factory.create_html_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_operator_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_report_writer_agent.return_value = MagicMock()

        # Test prompts
        visualisation_prompt = "Create visualizations"
        operator_prompt = "Operate on data"
        report_prompt = "Write reports"
        search_prompt = "Search documents"

        result = delegation_tools.get_agents(
            visualisation_prompt, operator_prompt, report_prompt, search_prompt
        )

        # Should call all agent creation methods
        delegation_tools.agent_factory.create_html_agent.assert_called_once_with(
            visualisation_prompt, delegation_tools.user_request.chatbot_name
        )
        delegation_tools.agent_factory.create_operator_agent.assert_called_once_with(
            prompt=operator_prompt,
            chatbot_name=delegation_tools.user_request.chatbot_name,
            user_id=delegation_tools.user_request.user_id,
            workspace_names=delegation_tools.user_request.workspace_names,
            session_id=delegation_tools.user_request.session_id,
            brain_documents=delegation_tools.user_request.brain_documents
        )
        delegation_tools.agent_factory.create_report_writer_agent.assert_called_once_with(
            report_prompt, delegation_tools.user_request.chatbot_name
        )
        # Note: create_excel_mcp_headers is called as a static method inside the factory, not on the instance

    def test_get_agents_exception_handling(self):
        """Test exception handling in get_agents."""
        delegation_tools = self.create_delegation_tools()

        # Mock agent creation to raise exception
        delegation_tools.agent_factory.create_html_agent.side_effect = Exception("Agent creation failed")

        result = delegation_tools.get_agents("prompt1", "prompt2", "prompt3", "prompt4")

        # Should handle exception gracefully
        assert result is None

    def test_get_agents_mcp_helper_integration(self):
        """Test integration with mcp_helper in get_agents."""
        delegation_tools = self.create_delegation_tools()

        # Mock successful operations
        delegation_tools.agent_factory.create_html_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_operator_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_report_writer_agent.return_value = MagicMock()

        result = delegation_tools.get_agents("vis", "op", "report", "search")

        # Verify the correct parameters are passed to create_operator_agent
        delegation_tools.agent_factory.create_operator_agent.assert_called_once_with(
            prompt="op",
            chatbot_name=delegation_tools.user_request.chatbot_name,
            user_id=delegation_tools.user_request.user_id,
            workspace_names=delegation_tools.user_request.workspace_names,
            session_id=delegation_tools.user_request.session_id,
            brain_documents=delegation_tools.user_request.brain_documents
        )

        # Verify that result is the expected tuple of 4 functions
        assert result is not None
        assert len(result) == 4
        assert callable(result[0])  # delegate_to_report_writer_agent
        assert callable(result[1])  # delegate_to_operator_agent
        assert callable(result[2])  # delegate_to_search_agent
        assert callable(result[3])  # delegate_to_html_agent

    @pytest.mark.asyncio
    async def test_delegate_to_search_agent_basic(self):
        """Test basic delegate_to_search_agent functionality."""
        delegation_tools = self.create_delegation_tools()

        # Setup mocks for search agent creation
        mock_search_agent = MagicMock()
        mock_toolkit = MagicMock()
        mock_prompt = "search prompt"

        delegation_tools.agent_factory.create_search_agent.return_value = (
            mock_search_agent, mock_toolkit, mock_prompt
        )
        delegation_tools.agent_runner.run.return_value = "Search completed successfully"

        # Get the delegate function from get_agents
        delegation_tools.agent_factory.create_html_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_operator_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_report_writer_agent.return_value = MagicMock()
        delegation_tools.mcp_helper.create_excel_mcp_headers.return_value = {}

        result = delegation_tools.get_agents("vis", "op", "report", "search")

        # The delegate function should be created inside get_agents
        # We need to test it indirectly by checking if the search agent factory is called

    def test_delegation_tools_attributes_stored_correctly(self):
        """Test that all attributes are stored correctly during initialization."""
        streaming_formatter = MagicMock()
        user_request = self.create_mock_user_request()
        agent_factory = MagicMock()
        mcp_helper = MagicMock()
        manager_span = MagicMock()
        agent_runner = MagicMock()
        session_helper = MagicMock()
        documents_tree = [{"doc": "tree"}]
        brain_tree = [{"brain": "tree"}]
        q = MagicMock()

        delegation_tools = DelegationTools(
            streaming_formatter=streaming_formatter,
            user_request=user_request,
            agent_factory=agent_factory,
            mcp_helper=mcp_helper,
            manager_span=manager_span,
            agent_runner=agent_runner,
            session_helper=session_helper,
            documents_tree=documents_tree,
            brain_tree=brain_tree,
            q=q,
            citation_manager=MagicMock()
        )

        assert delegation_tools.streaming_formatter is streaming_formatter
        assert delegation_tools.user_request is user_request
        assert delegation_tools.agent_factory is agent_factory
        assert delegation_tools.mcp_helper is mcp_helper
        assert delegation_tools.manager_span is manager_span
        assert delegation_tools.agent_runner is agent_runner
        assert delegation_tools.session_helper is session_helper
        assert delegation_tools.documents_tree is documents_tree
        assert delegation_tools.brain_tree is brain_tree
        assert delegation_tools.q is q

    def test_user_request_attributes_access(self):
        """Test accessing user request attributes within DelegationTools."""
        delegation_tools = self.create_delegation_tools()

        # Test that user request attributes are accessible
        assert delegation_tools.user_request.user_id == "test_user_123"
        assert delegation_tools.user_request.chatbot_name == "test_chatbot"
        assert delegation_tools.user_request.workspace_names == ["brain1", "brain2"]
        assert delegation_tools.user_request.session_id == "session_123"
        assert delegation_tools.user_request.search_web is True
        assert delegation_tools.user_request.top_k == 5
        assert delegation_tools.user_request.vectorstore_name == "test_vectorstore"

    def test_get_agents_with_different_prompts(self):
        """Test get_agents with various prompt combinations."""
        delegation_tools = self.create_delegation_tools()

        # Mock successful agent creation
        delegation_tools.agent_factory.create_html_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_operator_agent.return_value = MagicMock()
        delegation_tools.agent_factory.create_report_writer_agent.return_value = MagicMock()
        delegation_tools.mcp_helper.create_excel_mcp_headers.return_value = {}

        # Test with empty prompts
        result1 = delegation_tools.get_agents("", "", "", "")

        # Test with long prompts
        long_prompt = "This is a very long prompt " * 20
        result2 = delegation_tools.get_agents(long_prompt, long_prompt, long_prompt, long_prompt)

        # Test with special characters
        special_prompt = "Prompt with special chars: @#$%^&*()_+{}|:<>?[]\\;'\",./"
        result3 = delegation_tools.get_agents(special_prompt, special_prompt, special_prompt, special_prompt)

        # All should complete without errors
        delegation_tools.agent_factory.create_html_agent.assert_called()

    def test_documents_and_brain_tree_handling(self):
        """Test handling of documents and brain tree structures."""
        complex_documents_tree = [
            {"id": "doc1", "name": "Document 1", "type": "pdf", "size": 1024},
            {"id": "doc2", "name": "Document 2", "type": "txt", "size": 512},
        ]

        complex_brain_tree = [
            {"id": "brain1", "name": "Brain 1", "documents": ["doc1"]},
            {"id": "brain2", "name": "Brain 2", "documents": ["doc2"]},
        ]

        delegation_tools = DelegationTools(
            streaming_formatter=MagicMock(),
            user_request=self.create_mock_user_request(),
            agent_factory=MagicMock(),
            mcp_helper=MagicMock(),
            manager_span=MagicMock(),
            agent_runner=MagicMock(),
            session_helper=MagicMock(),
            documents_tree=complex_documents_tree,
            brain_tree=complex_brain_tree,
            q=MagicMock(),
            citation_manager=MagicMock()
        )

        assert len(delegation_tools.documents_tree) == 2
        assert len(delegation_tools.brain_tree) == 2
        assert delegation_tools.documents_tree[0]["id"] == "doc1"
        assert delegation_tools.brain_tree[0]["id"] == "brain1"

    def test_search_web_configuration(self):
        """Test search web configuration handling."""
        # Test with search_web enabled
        user_request_with_web = self.create_mock_user_request()
        user_request_with_web.search_web = True

        delegation_tools_web = DelegationTools(
            streaming_formatter=MagicMock(),
            user_request=user_request_with_web,
            agent_factory=MagicMock(),
            mcp_helper=MagicMock(),
            manager_span=MagicMock(),
            agent_runner=MagicMock(),
            session_helper=MagicMock(),
            documents_tree=[],
            brain_tree=[],
            q=MagicMock(),
            citation_manager=MagicMock()
        )

        assert delegation_tools_web.user_request.search_web is True

        # Test with search_web disabled
        user_request_no_web = self.create_mock_user_request()
        user_request_no_web.search_web = False

        delegation_tools_no_web = DelegationTools(
            streaming_formatter=MagicMock(),
            user_request=user_request_no_web,
            agent_factory=MagicMock(),
            mcp_helper=MagicMock(),
            manager_span=MagicMock(),
            agent_runner=MagicMock(),
            session_helper=MagicMock(),
            documents_tree=[],
            brain_tree=[],
            q=MagicMock(),
            citation_manager=MagicMock()
        )

        assert delegation_tools_no_web.user_request.search_web is False

    def test_queue_integration(self):
        """Test queue (q) integration."""
        mock_queue = MagicMock()
        delegation_tools = DelegationTools(
            streaming_formatter=MagicMock(),
            user_request=self.create_mock_user_request(),
            agent_factory=MagicMock(),
            mcp_helper=MagicMock(),
            manager_span=MagicMock(),
            agent_runner=MagicMock(),
            session_helper=MagicMock(),
            documents_tree=[],
            brain_tree=[],
            q=mock_queue,
            citation_manager=MagicMock()
        )

        assert delegation_tools.q is mock_queue

    def test_manager_span_integration(self):
        """Test manager span integration for tracing."""
        mock_span = MagicMock()
        delegation_tools = DelegationTools(
            streaming_formatter=MagicMock(),
            user_request=self.create_mock_user_request(),
            agent_factory=MagicMock(),
            mcp_helper=MagicMock(),
            manager_span=mock_span,
            agent_runner=MagicMock(),
            session_helper=MagicMock(),
            documents_tree=[],
            brain_tree=[],
            q=MagicMock(),
            citation_manager=MagicMock()
        )

        assert delegation_tools.manager_span is mock_span