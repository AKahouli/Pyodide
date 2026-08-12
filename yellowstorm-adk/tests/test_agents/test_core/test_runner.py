"""Tests for AgentRunner."""

import pytest
from unittest.mock import ANY, AsyncMock, MagicMock, patch
import asyncio
from datetime import datetime
from google.genai import types

from src.smart_rag.agents.core.runner import AgentRunner
from src.smart_rag.tools.utilities.connector_tools import (
    _register_connector_response_sources,
)


class TestAgentRunner:
    """Test cases for AgentRunner."""

    def test_init(self):
        """Test runner initialization."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        assert runner.event_extractor == mock_event_extractor
        assert runner.message_transformer == mock_message_transformer
        assert runner.streaming_formatter == mock_streaming_formatter
        assert runner.prompt_processor == mock_prompt_processor
        assert runner.config is not None

    @pytest.mark.asyncio
    async def test_run_agent_tool_search_agent(self):
        """Test running a search agent tool."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_agent.name = "SearchAgent"
        mock_session_helper = MagicMock()
        mock_session_helper.create_session = AsyncMock(return_value=MagicMock())
        mock_queue = AsyncMock()
        mock_toolkit = MagicMock()

        mock_prompt_processor.extract_task_description.return_value = "Test task description"
        mock_streaming_formatter.format_streaming_event.return_value = {"type": "description"}

        # Mock the runner execution
        with patch.object(runner, '_run_standard_agent', new_callable=AsyncMock) as mock_run_standard:
            mock_run_standard.return_value = ("Test result", [], {}, [])

            result = await runner.run_agent_tool(
                agent=mock_agent,
                message="Test message",
                session_helper=mock_session_helper,
                user_id="test_user",
                toolkit=mock_toolkit,
                q=mock_queue,
                task_order="1",
                agent_id="agent_123"
            )

            assert result == ("Test result", [], {}, [])
            mock_session_helper.create_session.assert_called_once()
            mock_run_standard.assert_called_once()
            mock_prompt_processor.extract_task_description.assert_called_once_with("Test message")

    @pytest.mark.asyncio
    async def test_run_agent_tool_prefers_explicit_task_summary(self):
        mock_streaming_formatter = MagicMock()
        mock_streaming_formatter.format_streaming_event.return_value = {"type": "description"}
        mock_prompt_processor = MagicMock()
        runner = AgentRunner(
            MagicMock(), MagicMock(), mock_streaming_formatter, mock_prompt_processor
        )
        mock_agent = MagicMock()
        mock_agent.name = "Smart Agent"
        mock_session_helper = MagicMock()
        mock_session_helper.create_session = AsyncMock(return_value=MagicMock())
        mock_queue = AsyncMock()

        with patch.object(runner, '_run_standard_agent', new_callable=AsyncMock) as mock_run_standard:
            mock_run_standard.return_value = ("Test result", [], {}, [])
            await runner.run_agent_tool(
                agent=mock_agent,
                message='{"selectedChoices":[{"submitText":"Internal"}]}',
                task_summary="  Profitability  ",
                session_helper=mock_session_helper,
                q=mock_queue,
                agent_id="agent_123",
            )

        mock_prompt_processor.extract_task_description.assert_not_called()
        mock_streaming_formatter.format_streaming_event.assert_called_once_with(
            agent_id="agent_123",
            agent_name="Smart Agent",
            agent_type="agent",
            chunk="Profitability",
            message_id=ANY,
            content_type="description",
        )

    @pytest.mark.asyncio
    async def test_run_agent_tool_html_agent(self):
        """Test running an HTML agent tool."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_agent.name = "HtmlAgent"
        mock_session_helper = MagicMock()
        mock_session_helper.create_session = AsyncMock(return_value=MagicMock())
        mock_queue = AsyncMock()

        mock_prompt_processor.extract_task_description.return_value = "Test task description"
        mock_streaming_formatter.format_streaming_event.return_value = {"type": "description"}

        # Mock the runner execution
        with patch.object(runner, '_run_html_agent', new_callable=AsyncMock) as mock_run_html:
            mock_run_html.return_value = ("HTML result", [], {}, [])

            result = await runner.run_agent_tool(
                agent=mock_agent,
                message="Test message",
                session_helper=mock_session_helper,
                user_id="test_user",
                q=mock_queue,
                agent_id="agent_123"
            )

            assert result == ("HTML result", [], {}, [])
            mock_run_html.assert_called_once()

    @pytest.mark.asyncio
    async def test_run_agent_tool_exception(self):
        """Test running agent tool with exception."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_agent.name = "TestAgent"
        mock_session_helper = MagicMock()
        mock_session_helper.init_session = AsyncMock(side_effect=Exception("Test error"))
        mock_queue = AsyncMock()

        with pytest.raises(TypeError):
            await runner.run_agent_tool(
                agent=mock_agent,
                message="Test message",
                session_helper=mock_session_helper,
                user_id="test_user",
                q=mock_queue,
                agent_id="agent_123"
            )

    @pytest.mark.asyncio
    async def test_run_standard_agent_success(self):
        """Test running standard agent successfully."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        agent_runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_agent.name = "TestAgent"
        mock_session_helper = MagicMock()
        mock_queue = AsyncMock()
        mock_content = types.Content(role="user", parts=[types.Part(text="test")])

        # Mock event with text
        mock_event = MagicMock()
        mock_event.content = MagicMock()
        mock_event.content.parts = [MagicMock()]
        mock_event.content.parts[0].text = "Test response"
        mock_event.content.parts[0].function_call = None
        mock_event.content.parts[0].function_response = None
        mock_event.is_final_response.return_value = False

        # Mock final event
        mock_final_event = MagicMock()
        mock_final_event.content = MagicMock()
        mock_final_event.content.parts = [MagicMock()]
        mock_final_event.content.parts[0].text = "Final response"
        mock_final_event.content.parts[0].function_call = None
        mock_final_event.content.parts[0].function_response = None
        mock_final_event.is_final_response.return_value = True

        # Mock Runner class
        async def mock_run_async(*args, **kwargs):
            yield mock_event
            yield mock_final_event

        mock_runner_instance = MagicMock()
        mock_runner_instance.run_async = mock_run_async

        mock_streaming_formatter.format_streaming_event.return_value = {"type": "chunk"}
        mock_message_transformer.simple_tag_transformer.return_value = (
            "processed",
            "",
            [],
        )

        with patch('src.smart_rag.agents.core.runner.Runner', return_value=mock_runner_instance):
            result = await agent_runner._run_standard_agent(
                agent=mock_agent,
                agent_name="TestAgent",
                agent_type="agent",
                session_helper=mock_session_helper,
                user_id="test_user",
                session_id="session_123",
                content=mock_content,
                q=mock_queue,
                task_order="1",
                toolkit=None,
                mcp_tools_used=[],
                agent_id="agent_123"
            )

        assert result[0] == "Final response"
        assert result[1] == []
        assert isinstance(result[2], dict)

    @pytest.mark.asyncio
    async def test_guarded_standard_agent_never_emits_unvalidated_partial_text(self):
        formatter = MagicMock()
        formatter.component_tracker = None
        formatter.format_streaming_event.side_effect = lambda **kwargs: {"chunk": kwargs.get("chunk")}
        agent_runner = AgentRunner(MagicMock(), MagicMock(), formatter, MagicMock())
        agent = MagicMock()
        agent.name = "GuardedAgent"
        agent.tools = []
        agent.sub_agents = []
        agent._guardrails_output_enabled = True
        session_helper = MagicMock()
        session_helper.state = {}
        queue = AsyncMock()
        content = types.Content(role="user", parts=[types.Part(text="test")])

        partial = MagicMock()
        partial.content.parts = [MagicMock(text="unsafe partial", function_call=None, function_response=None, thought=False)]
        partial.is_final_response.return_value = False
        final = MagicMock()
        final.content.parts = [MagicMock(text="validated replacement", function_call=None, function_response=None, thought=False)]
        final.is_final_response.return_value = True

        async def run_async(*_args, **_kwargs):
            yield partial
            yield final

        adk_runner = MagicMock()
        adk_runner.run_async = run_async
        with patch('src.smart_rag.agents.core.runner.Runner', return_value=adk_runner), \
             patch('src.smart_rag.agents.core.runner.MessageTransformer.simple_tag_transformer', side_effect=lambda tempmsg, **_kwargs: (tempmsg, "", [])), \
             patch.object(agent_runner, '_replace_diagram_references_during_streaming', new_callable=AsyncMock, side_effect=lambda text, _session: text), \
             patch.object(agent_runner, '_extract_generated_files', new_callable=AsyncMock, return_value=[]):
            result = await agent_runner._run_standard_agent(
                agent=agent, agent_name="GuardedAgent", agent_type="agent",
                session_helper=session_helper, user_id="user", session_id="session",
                content=content, q=queue, task_order="1", toolkit=None,
                mcp_tools_used=[], agent_id="agent-1",
            )

        emitted = [call.args[0] for call in queue.put.await_args_list]
        assert result[0] == "validated replacement"
        assert not any("unsafe partial" in str(item) for item in emitted)
        assert any("validated replacement" in str(item) for item in emitted)

    @pytest.mark.asyncio
    async def test_run_standard_agent_preserves_numeric_citation_reference(self):
        """Test that numeric citations keep their original reference values."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        agent_runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        mock_agent = MagicMock()
        mock_agent.name = "TestAgent"
        mock_session_helper = MagicMock()
        mock_queue = AsyncMock()
        mock_content = types.Content(role="user", parts=[types.Part(text="test")])
        mock_toolkit = MagicMock()
        mock_toolkit.sources_text = []
        mock_toolkit.sources_image = []

        mock_event = MagicMock()
        mock_event.content = MagicMock()
        mock_event.content.parts = [MagicMock()]
        mock_event.content.parts[0].text = "Evidence [6]"
        mock_event.content.parts[0].function_call = None
        mock_event.content.parts[0].function_response = None
        mock_event.is_final_response.return_value = False

        mock_final_event = MagicMock()
        mock_final_event.content = MagicMock()
        mock_final_event.content.parts = [MagicMock()]
        mock_final_event.content.parts[0].text = "Final [6]"
        mock_final_event.content.parts[0].function_call = None
        mock_final_event.content.parts[0].function_response = None
        mock_final_event.is_final_response.return_value = True

        async def mock_run_async(*args, **kwargs):
            yield mock_event
            yield mock_final_event

        mock_runner_instance = MagicMock()
        mock_runner_instance.run_async = mock_run_async

        mock_streaming_formatter.format_streaming_event.return_value = {"type": "chunk"}
        mock_message_transformer.simple_tag_transformer.side_effect = [
            ("Evidence [6]", "", ["[6]"]),
            ("", "", []),
        ]

        with patch('src.smart_rag.agents.core.runner.Runner', return_value=mock_runner_instance), \
             patch.object(agent_runner, '_find_source_by_reference', return_value={"source_object": {}, "type": "text"}), \
             patch.object(agent_runner, '_send_citation_component', new_callable=AsyncMock) as mock_send_citation_component, \
             patch.object(agent_runner, '_handle_final_response', new_callable=AsyncMock, return_value="Final [6]"):
            result = await agent_runner._run_standard_agent(
                agent=mock_agent,
                agent_name="TestAgent",
                agent_type="agent",
                session_helper=mock_session_helper,
                user_id="test_user",
                session_id="session_123",
                content=mock_content,
                q=mock_queue,
                task_order="1",
                toolkit=mock_toolkit,
                mcp_tools_used=[],
                agent_id="agent_123"
            )

        assert result[0] == "Final [6]"
        assert mock_send_citation_component.await_args_list[0].args[5] == "6"
        mock_queue.put.assert_any_call({"type": "chunk"})

    @pytest.mark.asyncio
    async def test_run_standard_agent_with_function_call(self):
        """Test running standard agent with function calls."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        agent_runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_session_helper = MagicMock()
        mock_queue = AsyncMock()
        mock_content = types.Content(role="user", parts=[types.Part(text="test")])

        mock_queue.include_tool_results = True

        # Mock event with function call
        mock_event = MagicMock()
        mock_event.content = MagicMock()
        mock_event.content.parts = [MagicMock()]
        mock_event.content.parts[0].text = None
        mock_event.content.parts[0].function_response = None
        mock_event.content.parts[0].function_call = MagicMock()
        mock_event.content.parts[0].function_call.name = "test_function"
        mock_event.content.parts[0].function_call.id = "call-1"
        mock_event.content.parts[0].function_call.args = {"arg1": "value1"}
        mock_event.is_final_response.return_value = False

        # Matching function response transitions the same tool component.
        mock_response_event = MagicMock()
        mock_response_event.content = MagicMock()
        mock_response_event.content.parts = [MagicMock()]
        mock_response_event.content.parts[0].text = None
        mock_response_event.content.parts[0].function_call = None
        mock_response_event.content.parts[0].function_response = MagicMock()
        mock_response_event.content.parts[0].function_response.name = "test_function"
        mock_response_event.content.parts[0].function_response.id = "call-1"
        mock_response_event.content.parts[0].function_response.is_error = False
        mock_response_event.content.parts[0].function_response.response = {}
        mock_response_event.is_final_response.return_value = False

        # Mock final event
        mock_final_event = MagicMock()
        mock_final_event.content = MagicMock()
        mock_final_event.content.parts = [MagicMock()]
        mock_final_event.content.parts[0].text = "Final response"
        mock_final_event.content.parts[0].function_call = None
        mock_final_event.content.parts[0].function_response = None
        mock_final_event.is_final_response.return_value = True

        # Mock Runner class
        async def mock_run_async(*args, **kwargs):
            yield mock_event
            yield mock_response_event
            yield mock_final_event

        mock_runner_instance = MagicMock()
        mock_runner_instance.run_async = mock_run_async

        with patch('src.smart_rag.agents.core.runner.Runner', return_value=mock_runner_instance), \
             patch.object(agent_runner, '_handle_function_call', new_callable=AsyncMock) as mock_handle_func, \
             patch.object(agent_runner, '_handle_final_response', new_callable=AsyncMock) as mock_handle_final, \
             patch.object(agent_runner, '_handle_ui_tool_response', new_callable=AsyncMock, return_value=False), \
             patch.object(agent_runner, '_handle_structured_tool_response', new_callable=AsyncMock):
            mock_handle_final.return_value = "Final response"

            result = await agent_runner._run_standard_agent(
                agent=mock_agent,
                agent_name="TestAgent",
                agent_type="agent",
                session_helper=mock_session_helper,
                user_id="test_user",
                session_id="session_123",
                content=mock_content,
                q=mock_queue,
                task_order="1",
                toolkit=None,
                mcp_tools_used=[],
                agent_id="agent_123"
            )

            mock_handle_func.assert_called_once()
            assert result[0] == "Final response"
            tool_events = [
                call.kwargs
                for call in mock_streaming_formatter.format_component_event.call_args_list
                if call.kwargs["component_type"] == "tool_info"
            ]
            started_at = tool_events[0]["component_data"].pop("started_at")
            assert datetime.fromisoformat(started_at.replace("Z", "+00:00")).tzinfo is not None
            assert tool_events == [
                {
                    "agent_id": "agent_123",
                    "component_type": "tool_info",
                    "component_data": {
                        "title": "test_function",
                        "status": "running",
                        "params": '{"arg1": "value1"}',
                    },
                    "message_id": "session_123",
                    "component_id": "tool-agent_123-call-1",
                    "action": "add",
                },
                {
                    "agent_id": "agent_123",
                    "component_type": "tool_info",
                    "component_data": {
                        "title": "test_function",
                        "status": "completed",
                        "result_json": "{}",
                    },
                    "message_id": "session_123",
                    "component_id": "tool-agent_123-call-1",
                    "action": "update",
                },
            ]

    @pytest.mark.asyncio
    async def test_run_html_agent_success(self):
        """Test running HTML agent successfully."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        agent_runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_session_helper = MagicMock()
        mock_queue = AsyncMock()
        mock_content = types.Content(role="user", parts=[types.Part(text="test")])

        # Mock final event
        mock_final_event = MagicMock()
        mock_final_event.content = MagicMock()
        mock_final_event.content.parts = [MagicMock()]
        mock_final_event.content.parts[0].text = "HTML content here"
        mock_final_event.is_final_response.return_value = True

        # Mock Runner class
        async def mock_run_async(*args, **kwargs):
            yield mock_final_event

        mock_runner_instance = MagicMock()
        mock_runner_instance.run_async = mock_run_async
        mock_streaming_formatter.format_streaming_event.return_value = {"type": "chunk"}

        with patch('src.smart_rag.agents.core.runner.Runner', return_value=mock_runner_instance):
            result = await agent_runner._run_html_agent(
                agent=mock_agent,
                session_helper=mock_session_helper,
                user_id="test_user",
                session_id="session_123",
                content=mock_content,
                q=mock_queue,
                agent_id="agent_123"
            )

        assert result[0] == "html was generated successfully and sent to the user"
        assert result[1] == []
        assert isinstance(result[2], dict)

    @pytest.mark.asyncio
    async def test_handle_function_call(self):
        """Test handling function calls."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_part = MagicMock()
        mock_part.function_call.name = "test_function"
        mock_part.function_call.args = {"arg1": "value1"}

        mock_event = MagicMock()
        mock_agent = MagicMock()
        mock_queue = AsyncMock()

        mock_event_extractor.extract_function_call_info.return_value = "Function call info"
        mock_streaming_formatter.format_streaming_event.return_value = {"type": "function_call"}
        mock_streaming_formatter.create_search_events_for_function.return_value = {"type": "search_event"}

        await runner._handle_function_call(
            part=mock_part,
            event=mock_event,
            agent=mock_agent,
            agent_name="TestAgent",
            q=mock_queue,
            session_id="session_123",
            agent_id="agent_123"
        )

        mock_event_extractor.extract_function_call_info.assert_called_once_with(mock_event, mock_part)
        mock_queue.put.assert_called()

    @pytest.mark.asyncio
    async def test_handle_final_response_with_toolkit(self):
        """Test handling final response with toolkit sources.

        Sources are now sent dynamically as citations during streaming,
        not in _handle_final_response. The method only extracts event_text
        and replaces diagram references.
        """
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_event = MagicMock()
        mock_event.content.parts = [MagicMock()]
        mock_event.content.parts[0].text = "Final response text"

        mock_toolkit = MagicMock()
        mock_toolkit.sources_text = [{"source": "text_source"}]
        mock_toolkit.sources_image = [{"source": "image_source"}]

        mock_queue = AsyncMock()

        with patch.object(runner, '_replace_diagram_references_during_streaming', new_callable=AsyncMock) as mock_replace:
            mock_replace.return_value = "Final response text"

            result = await runner._handle_final_response(
                event=mock_event,
                agent_id="agent_123",
                agent_name="SearchAgent",
                toolkit=mock_toolkit,
                task_order="1",
                q=mock_queue,
                session_id="session_123"
            )

        assert result == "Final response text"
        # Sources are sent dynamically; the terminal-only model answer is emitted here.
        mock_queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_final_response_report_writer(self):
        """Test handling final response for report writer agent.

        Sources are now sent dynamically as citations during streaming,
        not in _handle_final_response. The method only extracts event_text
        and replaces diagram references.
        """
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_event = MagicMock()
        mock_event.content.parts = [MagicMock()]
        mock_event.content.parts[0].text = "Report content"

        mock_queue = AsyncMock()

        with patch.object(runner, '_replace_diagram_references_during_streaming', new_callable=AsyncMock) as mock_replace:
            mock_replace.return_value = "Report content"

            result = await runner._handle_final_response(
                event=mock_event,
                agent_id="agent_123",
                agent_name="ReportWriterAgent",
                toolkit=None,
                task_order="1",
                q=mock_queue,
                session_id="session_123"
            )

        assert result == "Report content"
        # The terminal-only model answer is emitted even though no sources are present.
        mock_queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_final_response_empty_parts(self):
        """Test handling final response with empty parts."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_event = MagicMock()
        mock_event.content.parts = []

        with patch.object(runner, '_replace_diagram_references_during_streaming', new_callable=AsyncMock) as mock_replace:
            mock_replace.return_value = ""

            result = await runner._handle_final_response(
                event=mock_event,
                agent_id="agent_123",
                agent_name="TestAgent",
                toolkit=None,
                task_order="1",
                q=None,
                session_id="session_123"
            )

        assert result == ""

    @pytest.mark.asyncio
    async def test_handle_final_response_excludes_thought_parts(self):
        runner = AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())
        mock_event = MagicMock()
        mock_event.content.parts = [
            types.Part(text="Internal reasoning. ", thought=True),
            types.Part(text="Visible "),
            types.Part(text="answer"),
        ]

        with patch.object(
            runner,
            '_replace_diagram_references_during_streaming',
            new_callable=AsyncMock,
            return_value="Visible answer",
        ) as mock_replace:
            result = await runner._handle_final_response(
                event=mock_event,
                agent_id="agent_123",
                agent_name="TestAgent",
                toolkit=None,
                task_order="1",
                q=None,
                session_id="session_123",
            )

        assert result == "Visible answer"
        mock_replace.assert_awaited_once_with("Visible answer", "session_123")

    @pytest.mark.asyncio
    async def test_handle_final_response_does_not_reemit_streamed_text(self):
        runner = AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())
        mock_event = MagicMock()
        mock_event.content.parts = [types.Part(text="Visible answer")]
        mock_queue = AsyncMock()

        with patch.object(
            runner,
            '_replace_diagram_references_during_streaming',
            new_callable=AsyncMock,
            return_value="Visible answer",
        ):
            result = await runner._handle_final_response(
                event=mock_event,
                agent_id="agent_123",
                agent_name="TestAgent",
                toolkit=None,
                task_order="1",
                q=mock_queue,
                session_id="session_123",
                streamed_text="Visible answer",
            )

        assert result == "Visible answer"
        mock_queue.put.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_streams_sources_component_for_any_tool(self):
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        function_response = MagicMock()
        function_response.name = "web_directory_search"
        function_response.response = {
            "text": "Connector result",
            "sources": [{"title": "Q1 report", "url": "https://contoso.example/q1"}],
        }
        queue = AsyncMock()
        mock_streaming_formatter.format_component_event.return_value = {"type": "sources"}

        await runner._handle_structured_tool_response(
            function_response=function_response,
            agent_id="agent_123",
            session_id="session_123",
            q=queue,
        )

        mock_streaming_formatter.format_component_event.assert_called_once_with(
            agent_id="agent_123",
            component_type="sources",
            component_data={"sources": [{"title": "Q1 report", "url": "https://contoso.example/q1"}]},
            message_id="session_123",
        )
        queue.put.assert_called_once_with({"type": "sources"})

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_filters_and_deduplicates_sources(self):
        runner = AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())
        function_response = MagicMock()
        function_response.name = "web_directory_search"
        function_response.response = {
            "sources": [
                {"title": " First source ", "url": " https://example.com/a "},
                {"title": "Duplicate", "url": "https://example.com/a"},
                {"title": "Case-sensitive path", "url": "https://example.com/A"},
                {"url": "https://example.com/b"},
                {"title": "Unsafe", "url": "javascript:alert(1)"},
                {"title": "Relative", "url": "/local"},
                {"title": "Hostless", "url": "https://user@"},
                {"title": "Port only", "url": "https://:443"},
            ],
        }
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "sources"}

        await runner._handle_structured_tool_response(function_response, "agent_123", "session_123", queue)

        runner.streaming_formatter.format_component_event.assert_called_once_with(
            agent_id="agent_123",
            component_type="sources",
            component_data={
                "sources": [
                    {"title": "First source", "url": "https://example.com/a"},
                    {"title": "Case-sensitive path", "url": "https://example.com/A"},
                    {"title": "example.com", "url": "https://example.com/b"},
                ],
            },
            message_id="session_123",
        )
        queue.put.assert_called_once_with({"type": "sources"})

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_skips_invalid_sources(self):
        runner = AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())
        function_response = MagicMock()
        function_response.name = "web_directory_search"
        function_response.response = {"sources": [{"url": "data:text/plain,unsafe"}, {"url": "https:///missing-host"}]}
        queue = AsyncMock()

        await runner._handle_structured_tool_response(function_response, "agent_123", "session_123", queue)

        runner.streaming_formatter.format_component_event.assert_not_called()
        queue.put.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_registers_connector_citations_from_response(self):
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        function_response = MagicMock()
        function_response.name = "searchv2test_locate_answer_citations"
        function_response.response = {
            "text": "Connector result [1]",
            "citation_sources": [
                {
                    "type": "text",
                    "source": "SLA_Indicateurs_Performance.docx",
                    "file_name": "doc-123",
                    "page": "",
                    "page_content": "1. Objectifs de Niveau de Service (SLA)",
                    "workspace_name": "",
                }
            ],
        }
        session_state = {}
        queue = AsyncMock()

        await runner._handle_structured_tool_response(
            function_response=function_response,
            agent_id="agent_123",
            session_id="session_123",
            q=queue,
            session_state=session_state,
        )

        assert session_state["_connector_text_sources"][0]["reference"] == "1"
        assert (
            session_state["_connector_text_sources"][0]["object"]["content"]["source"]
            == "SLA_Indicateurs_Performance.docx"
        )
        queue.put.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_registers_connector_citations_from_raw_result_blocks(self):
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        function_response = MagicMock()
        function_response.name = "searchv2test_locate_answer_citations"
        function_response.response = {
            "result": """
            [
              {
                "document_id": 68,
                "workspace_name": "69e643ae25a48c9410bff159",
                "file_name": "69e643d725a48c9410bff182",
                "source": "https://yssametachatbotdev001.blob.core.windows.net/metachatbot/6992fc709968567dc766a12d/69e643ae25a48c9410bff159/69e643d725a48c9410bff182/SLA_Indicateurs_Performance.docx",
                "block_id": "p0_b0",
                "block_type": "text",
                "content": "Le présent document définit les objectifs de performance.",
                "page_number": 0
              },
              {
                "document_id": 68,
                "workspace_name": "69e643ae25a48c9410bff159",
                "block_id": "p0_b6",
                "block_type": "paragraph_title",
                "content": "1. Objectifs de Niveau de Service (SLA)",
                "page_number": 0
              }
            ]
            """
        }
        session_state = {}
        queue = AsyncMock()

        await runner._handle_structured_tool_response(
            function_response=function_response,
            agent_id="agent_123",
            session_id="session_123",
            q=queue,
            session_state=session_state,
        )

        assert len(session_state["_connector_text_sources"]) == 2
        assert session_state["_connector_text_sources"][0]["reference"] == "1"
        assert (
            session_state["_connector_text_sources"][0]["object"]["content"]["source"]
            == "SLA_Indicateurs_Performance.docx"
        )
        assert (
            session_state["_connector_text_sources"][0]["object"]["content"]["file_name"]
            == "p0_b0"
        )
        assert (
            session_state["_connector_text_sources"][0]["object"]["content"]["page"]
            == "1"
        )
        assert session_state["_connector_text_sources"][0]["reference_aliases"] == ["68"]
        queue.put.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_ignores_read_section_citations(self):
        runner = AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())
        function_response = MagicMock()
        function_response.name = "sharepoint_read_section"
        function_response.response = {
            "content": "Section text",
            "citation_sources": [
                {
                    "type": "text",
                    "source": "contract.pdf",
                    "file_name": "contract.pdf",
                    "page": "2",
                    "page_content": "Section text",
                    "workspace_id": "workspace-1",
                }
            ],
        }
        session_state = {}

        await runner._handle_structured_tool_response(
            function_response=function_response,
            agent_id="agent_123",
            session_id="session_123",
            q=AsyncMock(),
            session_state=session_state,
        )

        assert "_connector_text_sources" not in session_state

    def test_register_connector_response_sources_ignores_read_content_citations(self):
        tool_context = MagicMock()
        tool_context.state = {}

        response = _register_connector_response_sources(
            {
                "text": "Full document",
                "source": "contract.pdf",
                "file_name": "contract.pdf",
                "total_pages": 2,
                "citation_sources": [
                    {"page": "1", "content": "First page"},
                    {"page": "2", "content": "Second page"},
                ],
            },
            tool_context,
            action_key="sharepoint_read_content",
        )

        assert response["text"] == "Full document"
        assert "citation_sources" not in response
        assert "_connector_text_sources" not in tool_context.state

    def test_register_connector_response_sources_ignores_read_section_images(self):
        tool_context = MagicMock()
        tool_context.state = {}

        response = _register_connector_response_sources(
            {
                "section_id": "sec_2",
                "title": "Preparation",
                "source": "recipe.pdf",
                "file_name": "recipe.pdf",
                "page_range": "1",
                "content": "Preparation steps.",
                "highlight_text": "Preparation steps.",
                "images": [
                    {
                        "image_id": "p1_b8_img",
                        "bbox": [114.0, 1242.0, 454.0, 1585.0],
                        "image_attached": True,
                    }
                ],
                "text": "Preparation steps.",
            },
            tool_context,
            action_key="sharepoint_read_section",
        )

        assert response["text"] == "Preparation steps."
        assert "citation_sources" not in response
        assert "_connector_image_sources" not in tool_context.state

    def test_find_source_by_reference_reads_connector_sources_from_session_state(self):
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        toolkit = MagicMock()
        toolkit.sources_text = []
        toolkit.sources_image = []
        session_state = {
            "_connector_text_sources": [
                {
                    "reference": "1",
                    "object": {
                        "content": {
                            "source": "Q1-report.txt",
                            "file_name": "item-123",
                            "page": "",
                            "page_content": "Quarterly revenue increased by 18%.",
                            "workspace_name": "",
                        }
                    },
                }
            ]
        }

        source = runner._find_source_by_reference("1", toolkit, session_state)

        assert source == {
            "source_object": {
                "content": {
                    "source": "Q1-report.txt",
                    "file_name": "item-123",
                    "page": "",
                    "page_content": "Quarterly revenue increased by 18%.",
                    "workspace_name": "",
                }
            },
            "type": "text",
        }

    def test_find_source_by_reference_matches_connector_alias_reference(self):
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        toolkit = MagicMock()
        toolkit.sources_text = []
        toolkit.sources_image = []
        session_state = {
            "_connector_text_sources": [
                {
                    "reference": "4",
                    "reference_aliases": ["68"],
                    "object": {
                        "content": {
                            "source": "SLA_Indicateurs_Performance.docx",
                            "file_name": "p0_b0",
                            "page": "1",
                            "page_content": "Les indicateurs de performance sont utilises...",
                            "workspace_name": "69e643ae25a48c9410bff159",
                        }
                    },
                }
            ]
        }

        source = runner._find_source_by_reference("[68]", toolkit, session_state)

        assert source == {
            "source_object": {
                "content": {
                    "source": "SLA_Indicateurs_Performance.docx",
                    "file_name": "p0_b0",
                    "page": "1",
                    "page_content": "Les indicateurs de performance sont utilises...",
                    "workspace_name": "69e643ae25a48c9410bff159",
                }
            },
            "type": "text",
        }

    def test_extracts_connector_citations_response_with_highlight_metadata(self):
        runner = AgentRunner(
            MagicMock(),
            MagicMock(),
            MagicMock(),
            MagicMock(),
        )

        sources = runner._extract_connector_citation_sources_from_response(
            {
                "citations": [
                    {
                        "source": "s3://vectorstore/user-1/workspace/Sodexo-DEU-2024-FR.pdf",
                        "page_number": 286,
                        "highlight_text": "dividende en croissance reguliere",
                        "highlight_bbox": [42.52, 123.16, 246.73, 52.5],
                    }
                ]
            },
            "searchv2test_locate_answer_citations",
        )

        assert sources == [
            {
                "type": "text",
                "source": "user-1/workspace/Sodexo-DEU-2024-FR.pdf",
                "file_name": "Sodexo-DEU-2024-FR.pdf",
                "page": "286",
                "page_content": "dividende en croissance reguliere",
                "workspace_id": "",
                "reference": "1",
                "reference_aliases": [],
                "highlight_text": "dividende en croissance reguliere",
                "highlight_bbox": [42.52, 123.16, 246.73, 52.5],
                "block_bbox": [42.52, 123.16, 246.73, 52.5],
            }
        ]

    @pytest.mark.asyncio
    async def test_send_citation_component_includes_highlight_metadata(self):
        formatter = MagicMock()
        formatter.format_component_event.return_value = {"component": "citation"}
        runner = AgentRunner(
            MagicMock(),
            MagicMock(),
            formatter,
            MagicMock(),
        )
        queue = asyncio.Queue()

        await runner._send_citation_component(
            {
                "type": "text",
                "source_object": {
                    "content": {
                        "source": "user-1/workspace/Sodexo-DEU-2024-FR.pdf",
                        "file_name": "Sodexo-DEU-2024-FR.pdf",
                        "page": "286",
                        "page_content": "dividende en croissance reguliere",
                        "brain_id": "workspace",
                        "highlight_text": "dividende en croissance reguliere",
                        "highlight_bbox": [42.52, 123.16, 246.73, 52.5],
                        "block_bbox": [42.52, 123.16, 246.73, 52.5],
                    }
                },
            },
            "agent-id",
            "session-id",
            queue,
            "text-component-id",
            "[1]",
        )

        component_data = formatter.format_component_event.call_args.kwargs[
            "component_data"
        ]
        assert component_data["text_source"]["highlight_text"] == (
            "dividende en croissance reguliere"
        )
        assert component_data["text_source"]["highlight_bbox"] == [
            42.52,
            123.16,
            246.73,
            52.5,
        ]

    @pytest.mark.asyncio
    async def test_run_standard_agent_exception(self):
        """Test standard agent with exception during execution."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_agent.name = "TestAgent"
        mock_session_helper = MagicMock()
        mock_session_helper.runner.run_async.side_effect = Exception("Test error")
        mock_queue = AsyncMock()
        mock_content = types.Content(role="user", parts=[types.Part(text="test")])

        with pytest.raises(TypeError):
            await runner._run_standard_agent(
                agent=mock_agent,
                agent_name="TestAgent",
                agent_type="agent",
                session_helper=mock_session_helper,
                user_id="test_user",
                session_id="session_123",
                content=mock_content,
                q=mock_queue,
                task_order="1",
                toolkit=None,
                mcp_tools_used=[],
                agent_id="agent_123"
            )

    @pytest.mark.asyncio
    async def test_run_html_agent_exception(self):
        """Test HTML agent with exception during execution."""
        mock_event_extractor = MagicMock()
        mock_message_transformer = MagicMock()
        mock_streaming_formatter = MagicMock()
        mock_prompt_processor = MagicMock()

        runner = AgentRunner(
            mock_event_extractor,
            mock_message_transformer,
            mock_streaming_formatter,
            mock_prompt_processor
        )

        # Setup mocks
        mock_agent = MagicMock()
        mock_session_helper = MagicMock()
        mock_session_helper.runner.run_async.side_effect = Exception("Test error")
        mock_queue = AsyncMock()
        mock_content = types.Content(role="user", parts=[types.Part(text="test")])

        result = await runner._run_html_agent(
            agent=mock_agent,
            session_helper=mock_session_helper,
            user_id="test_user",
            session_id="session_123",
            content=mock_content,
            q=mock_queue,
            agent_id="agent_123"
        )

        assert result[0] is None
        assert result[1] == []
        assert isinstance(result[2], dict)
