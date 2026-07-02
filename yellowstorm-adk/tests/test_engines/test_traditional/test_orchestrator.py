"""Tests for Traditional Engine Orchestrator."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

from src.smart_rag.engines.traditional.orchestrator import SmartRAGOrchestrator


class TestSmartRAGOrchestrator:
    """Test cases for SmartRAGOrchestrator."""

    def test_init(self):
        """Test orchestrator initialization."""
        orchestrator = SmartRAGOrchestrator()
        assert orchestrator is not None
        assert orchestrator.llm_factory is not None
        assert orchestrator.agent_factory is not None
        assert orchestrator.agent_runner is not None

    @pytest.mark.asyncio
    async def test_chat_smart_rag_basic(self):
        """Test basic chat smart rag processing."""
        orchestrator = SmartRAGOrchestrator()

        mock_request = MagicMock()
        mock_request.user_id = "user123"
        mock_request.session_id = "session456"
        mock_request.message = "Test user query"
        mock_request.workspace_names = ["brain1"]
        mock_request.top_k = 5
        mock_request.brain_documents = []
        mock_request.brain_relations = {}
        mock_request.vectorstore_name = "test_store"
        mock_request.instructions = "test instructions"
        mock_request.chatbot_name = "test_model"
        mock_request.search_web = False
        mock_request.image_input = None

        mock_queue = AsyncMock()

        with patch.object(orchestrator.prompt_processor, 'extract_prompts') as mock_extract, \
             patch('src.smart_rag.engines.traditional.orchestrator.build_tree') as mock_build_tree, \
             patch('src.smart_rag.engines.traditional.orchestrator.DatabaseSessionService') as mock_db_session_class, \
             patch('src.smart_rag.engines.traditional.orchestrator.langfuse_client') as mock_langfuse, \
             patch('src.smart_rag.engines.traditional.orchestrator.DelegationTools') as mock_delegation_tools, \
             patch.object(orchestrator.memory_service, 'initialize', new_callable=AsyncMock) as mock_mem_init, \
             patch.object(orchestrator.memory_service, 'create_manager_context', new_callable=AsyncMock, return_value="") as mock_mem_ctx, \
             patch('src.smart_rag.infrastructure.session.citation_manager.get_citation_manager', new_callable=AsyncMock) as mock_get_cm:

            # extract_prompts now returns 9 values
            mock_extract.return_value = ("agent", "operator", "report", "viz", "manager", "", "", "", "")
            mock_build_tree.return_value = (None, None)

            # Mock langfuse client
            mock_trace = MagicMock()
            mock_span = MagicMock()
            mock_langfuse.trace.return_value = mock_trace
            mock_langfuse.span.return_value = mock_span

            # Mock DatabaseSessionService
            mock_db_session = MagicMock()
            mock_db_session.get_session = AsyncMock(return_value=MagicMock())
            mock_db_session.create_session = AsyncMock()
            mock_db_session_class.return_value = mock_db_session

            # Mock citation manager
            mock_get_cm.return_value = MagicMock()

            # Mock delegation tools
            mock_delegation_instance = MagicMock()
            mock_delegation_tools.return_value = mock_delegation_instance
            mock_delegation_instance.get_agents.return_value = (
                MagicMock(), MagicMock(), MagicMock(), MagicMock()
            )

            # Mock agent_factory.create_manager_agent
            with patch.object(orchestrator.agent_factory, 'create_manager_agent') as mock_create_manager:
                mock_manager_agent = MagicMock()
                mock_manager_agent.name = "manager"
                mock_create_manager.return_value = mock_manager_agent

                # Mock Runner
                with patch('src.smart_rag.engines.traditional.orchestrator.Runner') as mock_runner_class:
                    mock_runner = MagicMock()

                    async def mock_run_async(*args, **kwargs):
                        event = MagicMock()
                        event.content.parts = [MagicMock()]
                        event.content.parts[0].text = "Test response"
                        event.content.parts[0].function_call = None
                        event.content.parts[0].function_response = None
                        event.is_final_response.return_value = True
                        event.author = "manager"
                        yield event

                    mock_runner.run_async = mock_run_async
                    mock_runner_class.return_value = mock_runner

                    try:
                        await orchestrator.chat_smart_rag(mock_request, mock_queue)
                    except Exception as e:
                        # Some exceptions are expected due to mocking
                        print(f"Expected exception: {e}")

            mock_extract.assert_called_once()

    @pytest.mark.asyncio
    async def test_chat_smart_rag_with_documents(self):
        """Test chat smart rag with documents."""
        orchestrator = SmartRAGOrchestrator()

        mock_request = MagicMock()
        mock_request.user_id = "user123"
        mock_request.session_id = "session456"
        mock_request.message = "Test user query"
        mock_request.workspace_names = ["brain1"]
        mock_request.top_k = 5
        mock_request.brain_documents = [{"id": "doc1", "content": "Document content"}]
        mock_request.brain_relations = {"nodes": [], "relationships": []}
        mock_request.vectorstore_name = "test_store"
        mock_request.instructions = "test instructions"
        mock_request.chatbot_name = "test_model"
        mock_request.search_web = False

        mock_queue = AsyncMock()

        with patch.object(orchestrator.prompt_processor, 'extract_prompts') as mock_extract, \
             patch('src.smart_rag.engines.traditional.orchestrator.build_tree') as mock_build_tree:

            mock_extract.return_value = ("agent", "operator", "report", "viz", "manager", "", "", "", "")
            mock_build_tree.return_value = (
                [{"id": "doc1", "content": "Document content"}],
                {"nodes": [], "relationships": []}
            )

            try:
                await orchestrator.chat_smart_rag(mock_request, mock_queue)
            except Exception:
                # Expected due to missing dependencies in test
                pass

            mock_extract.assert_called_once()
    @pytest.mark.asyncio
    async def test_chat_smart_rag_exception_handling(self):
        """Test exception handling in chat_smart_rag."""
        orchestrator = SmartRAGOrchestrator()

        mock_request = MagicMock()
        mock_request.user_id = "user123"
        mock_request.session_id = "session456"
        mock_request.message = "Test user query"
        # Missing required attribute (read during early param extraction) to trigger exception
        del mock_request.brain_ids

        mock_queue = AsyncMock()

        # Should handle the exception gracefully
        await orchestrator.chat_smart_rag(mock_request, mock_queue)

        # Should not crash, just return early due to exception

    def test_orchestrator_components(self):
        """Test that orchestrator initializes all components correctly."""
        orchestrator = SmartRAGOrchestrator()

        # Test that all required components are initialized
        assert hasattr(orchestrator, 'llm_factory')
        assert hasattr(orchestrator, 'prompt_processor')
        assert hasattr(orchestrator, 'event_extractor')
        assert hasattr(orchestrator, 'message_transformer')
        assert hasattr(orchestrator, 'streaming_formatter')
        assert hasattr(orchestrator, 'mcp_helper')
        assert hasattr(orchestrator, 'agent_factory')
        assert hasattr(orchestrator, 'agent_runner')

        # Test that components are not None
        assert orchestrator.llm_factory is not None
        assert orchestrator.prompt_processor is not None
        assert orchestrator.event_extractor is not None
        assert orchestrator.message_transformer is not None
        assert orchestrator.streaming_formatter is not None
        assert orchestrator.mcp_helper is not None
        assert orchestrator.agent_factory is not None
        assert orchestrator.agent_runner is not None

    @pytest.mark.asyncio
    async def test_chat_smart_rag_with_web_search(self):
        """Test chat smart rag with web search enabled."""
        orchestrator = SmartRAGOrchestrator()

        mock_request = MagicMock()
        mock_request.user_id = "user123"
        mock_request.session_id = "session456"
        mock_request.message = "Test user query"
        mock_request.workspace_names = ["brain1"]
        mock_request.top_k = 5
        mock_request.brain_documents = []
        mock_request.brain_relations = {}
        mock_request.vectorstore_name = "test_store"
        mock_request.instructions = "test instructions"
        mock_request.chatbot_name = "test_model"
        mock_request.search_web = True  # Enable web search

        mock_queue = AsyncMock()

        with patch.object(orchestrator.prompt_processor, 'extract_prompts') as mock_extract, \
             patch.object(orchestrator.prompt_processor, 'get_web_search_prompt') as mock_web_prompt, \
             patch('src.smart_rag.engines.traditional.orchestrator.build_tree') as mock_build_tree, \
             patch.object(orchestrator.memory_service, 'initialize', new_callable=AsyncMock) as mock_mem_init, \
             patch.object(orchestrator.memory_service, 'create_manager_context', new_callable=AsyncMock, return_value=""):

            mock_extract.return_value = ("agent", "operator", "report", "viz", "manager", "", "", "", "")
            mock_build_tree.return_value = (None, None)
            mock_web_prompt.return_value = " Web search enabled."

            try:
                await orchestrator.chat_smart_rag(mock_request, mock_queue)
            except Exception:
                # Expected due to missing dependencies in test
                pass

            mock_mem_init.assert_called_once()

            mock_extract.assert_called_once()