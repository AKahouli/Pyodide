"""
Module for running agents and processing their outputs.

Classes:
- AgentRunner: Handles running agents and processing their outputs.
"""

import asyncio
import json
import os
import re2 as re
import uuid
from typing import Optional, Tuple, Any, List
from google.adk import Agent, Runner
from google.adk.agents.run_config import StreamingMode, RunConfig
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.smart_rag.infrastructure.monitoring import TraceRecorder
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.messaging import MessageTransformer, StreamingFormatter
from src.smart_rag.engines.helpers import build_content_with_images, coerce_to_dict
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.agentic_rag.AgentRunner")
APP_NAME = "manager_app"


class AgentRunner:
    """Handles running agents and processing their outputs.

    Attributes:
        event_extractor (EventExtractor): Extracts information from events.
        message_transformer (MessageTransformer): Transforms messages for processing.
        streaming_formatter (StreamingFormatter): Formats streaming events.
        prompt_processor (PromptProcessor): Processes prompts for agents.
        config (RunConfig): Configuration for running agents.
    """

    def __init__(
        self,
        event_extractor: Any,
        message_transformer: MessageTransformer,
        streaming_formatter: StreamingFormatter,
        prompt_processor: PromptProcessor,
    ):
        self.event_extractor = event_extractor
        self.message_transformer = message_transformer
        self.streaming_formatter = streaming_formatter
        self.prompt_processor = prompt_processor
        self.config = RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=200)

    async def run_agent_tool(
        self,
        agent: Agent,
        message: str,
        session_helper: InMemorySessionService,
        user_id: str = "default_user",
        toolkit=None,
        q: Optional[asyncio.Queue[dict]] = None,
        task_order: str = None,
        expected_output: str = None,
        agent_id="no_id",
        agent_config: Optional[dict] = None,
        function_call_id_info: Optional[dict] = None,
        image_input: Optional[list] = None,
    ) -> Tuple[str, List[str], dict]:
        """Run an agent tool and yield streaming events.

        Args:
            agent (Agent): The agent to run.
            message (str): The input message for the agent.
            session_helper (InMemorySessionService): Helper for managing sessions.
            user_id (str): The user ID for the session.
            toolkit: The toolkit associated with the agent.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming events.
            task_order (str): The order of the task and the reference to use for source citation.
            agent_id (str): The ID of the agent.
            image_input (Optional[list]): List of image dicts to include in the agent's context.

        Returns:
            Tuple[str, List[str], dict]: A tuple containing:
                - str: The final result/response from the agent (None if error)
                - List[str]: List of MCP types that were used during execution
                - dict: Execution summary with performance and usage metrics
                :param agent_config:
        """
        try:
            # Build initial session state from agent's code interpreter params (if any)
            initial_state = {}
            if hasattr(agent, "_code_interpreter_state"):
                initial_state.update(agent._code_interpreter_state)

            # Create a simple session to examine its properties
            session_id = f"session-{uuid.uuid4()}"
            session = await session_helper.create_session(
                app_name="manager_app",
                user_id=user_id,
                session_id=session_id,
                state=initial_state or None,
            )

        except Exception as e:
            logger.error(
                f"🔴 Exception occurred during session initialization for agent {agent.name}: {str(e)}"
            )
            return None, [], {}, []

        mcp_tools_used = []  # Track which specific MCPs actually get used during execution
        if image_input:
            content = build_content_with_images(message, image_input)
        else:
            content = types.Content(role="user", parts=[types.Part(text=message)])
        agent_name = agent.name
        # Send initial description
        if agent_name in ["SearchAgent", "OperatorAgent"]:
            agent_type = "agent"
        elif (
            agent_name == "ReportWriterAgent"
            or agent_name == "report_writer"
            or agent_name == "Report Writer"
        ):
            agent_type = "reporter"
        elif (
            agent_name == "HtmlAgent"
            or agent_name == "html_agent"
            or agent_name == "Visualizer Agent"
            or "visualizer_agent" in agent_name.lower()
        ):
            agent_type = "html"
        elif agent_config and agent_config.get("agent_type") == "visualizer":
            agent_type = "html"
        else:
            agent_type = "agent"

        task_desc = self.prompt_processor.extract_task_description(message)
        output = self.streaming_formatter.format_streaming_event(
            agent_id=agent_id,
            agent_name=agent_name,
            agent_type=agent_type,
            chunk=task_desc,
            message_id=session_id,
            content_type="description",
        )
        logger.info(
            f"[AGENT RUNNER] Sending agent description to backend - agent_name: {agent_name}, agent_type: {agent_type}, session_id: {session_id}"
        )
        await q.put(output)

        # The expected_output contains internal agent instructions (JSON schemas)
        # that should not be displayed to users. It's only used to guide the agent's response format.
        # This prevents internal implementation details from leaking into the UI.
        #
        # if expected_output:
        # the client chunks format_streaming_event
        #     expected_output_event = self.streaming_formatter.format_streaming_event(
        #         agent_id=agent_id,
        #         agent_name=agent_name,
        #         agent_type=agent_type,
        #         chunk=expected_output,
        #         message_id=session_id,
        #         content_type="expected_output"
        #     )
        #     logger.info(f"[AGENT RUNNER] Sending expected output to backend - agent_name: {agent_name}, session_id: {session_id}")
        #  send it to outgoing stream queue
        #     await q.put(expected_output_event)

        try:
            if agent_type != "html":
                return await self._run_standard_agent(
                    agent,
                    agent_name,
                    agent_type,
                    session_helper,
                    user_id,
                    session_id,
                    content,
                    q,
                    task_order,
                    toolkit,
                    mcp_tools_used,
                    agent_id,
                )
            else:
                return await self._run_html_agent(
                    agent, session_helper, user_id, session_id, content, q, agent_id
                )

        except Exception as e:
            logger.error(f"🔴 Exception occurred in agent {agent.name}: {str(e)}")
            return None, [], {}, []

    async def _run_standard_agent(
        self,
        agent,
        agent_name,
        agent_type,
        session_helper,
        user_id,
        session_id,
        content,
        q,
        task_order,
        toolkit,
        mcp_tools_used,
        agent_id,
    ):
        """Run a standard agent (non-HTML) with detailed execution recording.

        Args:
            agent: The agent to run.
            agent_name: The name of the agent.
            agent_type: The type of the agent.
            session_helper: Helper for managing sessions.
            user_id: The user ID for the session.
            session_id: The session ID.
            content: The input content for the agent.
            q: Queue for streaming events.
            task_order: The order of the task.
            toolkit: The toolkit associated with the agent.
            mcp_tools_used: List of MCP types that were used during execution.
            agent_id: The ID of the agent.

        Returns:
            Tuple containing final result, list of MCP tools used, and execution summary (for langfuse tracing).
        """
        recorder = TraceRecorder(agent_name=agent_name, agent_type=agent_type)
        accumulated_text = ""
        # Citation buffering using MessageTransformer
        citation_buffer = ""
        # Sequential citation remapping: LLM ref (e.g., "[8]") -> UI ref (e.g., "[1]")
        citation_mapping = {}
        citation_counter = 0
        # Track current text component ID for citation parent_id
        current_text_component_id = None

        runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_helper)

        stream = runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content,
            run_config=self.config,
        )
        should_close_stream = True

        try:
            async for event in stream:
                # Log event for debugging
                logger.debug(
                    f"Received event for {agent_name}: is_final={event.is_final_response() if hasattr(event, 'is_final_response') else 'N/A'}, has_content={bool(event.content)}, has_parts={bool(event.content.parts) if event.content else False}"
                )

                if not event.content or not event.content.parts:
                    continue

                # Skip text parts if event has multiple parts (indicates explanation + function call)
                has_multiple_parts = len(event.content.parts) > 1

                for part in event.content.parts:
                    if (
                        agent_type != "html"
                        and part.text
                        and not event.is_final_response()
                        and not has_multiple_parts
                    ):
                        event_text = part.text or ""

                        # Use MessageTransformer for citation buffering and detection
                        text_to_send, citation_buffer, detected_citations = (
                            MessageTransformer.simple_tag_transformer(
                                tempmsg=event_text,
                                task_n=1,  # Not used but required
                                buffer=citation_buffer,
                                force_flush=False,
                            )
                        )

                        # Process detected citations and send citation components
                        if detected_citations and toolkit:
                            logger.debug(
                                f"[CITATION DETECTION] Agent referenced {len(detected_citations)} citation(s): {detected_citations}"
                            )

                            for citation_ref in detected_citations:
                                # Assign sequential UI reference on first encounter
                                if citation_ref not in citation_mapping:
                                    citation_counter += 1
                                    citation_mapping[citation_ref] = (
                                        f"[{citation_counter}]"
                                    )
                                    logger.debug(
                                        f"[CITATION REMAP] {citation_ref} -> {citation_mapping[citation_ref]}"
                                    )
                                ui_reference = citation_mapping[citation_ref]

                                # Look up the source
                                source_info = self._find_source_by_reference(
                                    citation_ref, toolkit
                                )
                                if source_info and q:
                                    logger.debug(
                                        f"Source found for {citation_ref} -> sending as {ui_reference}"
                                    )
                                    await self._send_citation_component(
                                        source_info,
                                        agent_id,
                                        session_id,
                                        q,
                                        current_text_component_id,
                                        ui_reference,
                                    )
                                else:
                                    logger.debug(f"No source found for {citation_ref}")

                        # Send text chunk if we have any (might be empty if buffering)
                        if text_to_send and q:
                            output = self.streaming_formatter.format_streaming_event(
                                agent_id=agent_id,
                                agent_name=agent_name,
                                agent_type=agent_type,
                                chunk=text_to_send,
                                message_id=session_id,
                                content_type="chunk",
                            )

                            # Extract text component ID from output
                            if "component" in output and "id" in output["component"]:
                                current_text_component_id = output["component"]["id"]

                            await q.put(output)
                            accumulated_text += text_to_send

                    if part.function_call:
                        if accumulated_text != "":
                            recorder.record_chunk(accumulated_text)
                            accumulated_text = ""

                        func_name = part.function_call.name
                        tool_category = (
                            "mcp"
                            if func_name
                            not in [
                                "calculator",
                                "perform_document_search",
                                "perform_web_search",
                                "perform_standard_search",
                                "python_interpreter",
                            ]
                            else "standard"
                        )

                        recorder.record_function_call(
                            func_name, dict(part.function_call.args), tool_category
                        )

                        # Send newline chunk for visual separation before any tool execution
                        if q:
                            # If we have a current text component, update it; otherwise create new one
                            if current_text_component_id:
                                newline_chunk = (
                                    self.streaming_formatter.format_component_event(
                                        agent_id=agent_id,
                                        component_type="text",
                                        component_data={"content": " \n "},
                                        message_id=session_id,
                                        action="update",
                                        component_id=current_text_component_id,
                                    )
                                )
                            else:
                                newline_chunk = (
                                    self.streaming_formatter.format_streaming_event(
                                        agent_id=agent_id,
                                        agent_name=agent_name,
                                        agent_type=agent_type,
                                        chunk=" \n ",
                                        message_id=session_id,
                                        content_type="chunk",
                                    )
                                )
                                # Extract component ID if this created a new component
                                if (
                                    "component" in newline_chunk
                                    and "id" in newline_chunk["component"]
                                ):
                                    current_text_component_id = newline_chunk[
                                        "component"
                                    ]["id"]

                            await q.put(newline_chunk)
                            logger.info(
                                f"[RUNNER] Sent newline chunk before {func_name} execution"
                            )

                        # Track python_interpreter usage
                        if (
                            func_name == "python_interpreter"
                            and "python_interpreter" not in mcp_tools_used
                        ):
                            mcp_tools_used.append("python_interpreter")
                            logger.info(
                                f"[RUNNER] python_interpreter tool used by {agent_name}"
                            )

                        # Send sandbox component with code for python_interpreter
                        if func_name == "python_interpreter" and q:
                            # Extract code from function arguments
                            code = ""
                            if (
                                hasattr(part.function_call, "args")
                                and part.function_call.args
                            ):
                                args_dict = dict(part.function_call.args)
                                code = args_dict.get("code", "")

                            # Use function_call.id as component_id for tracking
                            call_id = (
                                part.function_call.id
                                if hasattr(part.function_call, "id")
                                else None
                            )

                            # Send sandbox component with code only (output_available = false)
                            sandbox_chunk = (
                                self.streaming_formatter.format_component_event(
                                    agent_id=agent_id,
                                    component_type="sandbox",
                                    component_data={
                                        "code": code,
                                        "output": "",
                                        "error": "",
                                        "output_available": False,
                                    },
                                    message_id=session_id,
                                    component_id=call_id,
                                )
                            )
                            await q.put(sandbox_chunk)
                            logger.info(
                                f"[RUNNER] Sending SANDBOX component to client - agent: {agent_name}, component_id: {call_id}"
                            )

                        if func_name == "generate_ui" and q:
                            # Send UI generation status chunk
                            ui_chunk = self.streaming_formatter.format_streaming_event(
                                agent_id=agent_id,
                                agent_name=agent_name,
                                agent_type=agent_type,
                                chunk="generating ui",
                                message_id=session_id,
                                content_type="ui",
                            )
                            await q.put(ui_chunk)
                            logger.info(
                                f"[DATAVIZ] Sent 'generating ui' chunk for tool: {func_name}"
                            )

                        if func_name == "generate_form_viz" and q:
                            # Send form viz generation status chunk
                            ui_chunk = self.streaming_formatter.format_streaming_event(
                                agent_id=agent_id,
                                agent_name=agent_name,
                                agent_type=agent_type,
                                chunk="generating ui",
                                message_id=session_id,
                                content_type="ui",
                            )
                            await q.put(ui_chunk)
                            logger.info(
                                f"[FORMVIZ] Sent 'generating form' chunk for tool: {func_name}"
                            )

                        # Handle function call and update component ID if search event was sent
                        current_text_component_id = await self._handle_function_call(
                            part,
                            event,
                            agent,
                            agent_name,
                            q,
                            session_id,
                            agent_id,
                            current_text_component_id,
                        )

                    if part.function_response:
                        success = not getattr(part.function_response, "is_error", False)
                        recorder.record_function_response(
                            part.function_response.response, success
                        )

                        # Check if this is a DataViz generate_ui tool response
                        func_name = part.function_response.name
                        if func_name == "generate_ui" and q:
                            await self._handle_dataviz_response(
                                part.function_response,
                                agent_name,
                                agent_type,
                                session_id,
                                q,
                            )

                        # Check if this is a generate_form_viz tool response
                        if func_name == "generate_form_viz" and q:
                            await self._handle_formviz_response(
                                part.function_response,
                                agent_name,
                                agent_type,
                                session_id,
                                q,
                            )

                        # Check if this is a perform_web_search tool response
                        if func_name == "perform_web_search" and q:
                            await self._handle_web_search_response(
                                part.function_response, agent_id, session_id, q
                            )

                        # Check if this is a python_interpreter tool response
                        if func_name == "python_interpreter" and q:
                            await self._handle_python_interpreter_response(
                                part.function_response,
                                agent_id,
                                agent_name,
                                session_id,
                                q,
                            )

                        # Check if this is a render_chart tool response
                        if func_name == "render_chart" and q:
                            await self._handle_render_chart_response(
                                part.function_response,
                                agent_id,
                                session_id,
                                q,
                            )

                if event.is_final_response() and event.content and event.content.parts:
                    # Force flush any remaining citation buffer on stream end
                    if citation_buffer:
                        logger.debug(
                            f"[STREAM END] Flushing remaining buffer: '{citation_buffer}'"
                        )

                        # Force flush to detect citations in remaining buffer
                        text_to_send, _, detected_citations = (
                            MessageTransformer.simple_tag_transformer(
                                tempmsg="",
                                task_n=1,
                                buffer=citation_buffer,
                                force_flush=True,
                            )
                        )

                        # Process detected citations
                        if detected_citations and toolkit:
                            logger.debug(
                                f"[CITATION DETECTION] Found {len(detected_citations)} citation(s) in flushed buffer: {detected_citations}"
                            )

                            for citation_ref in detected_citations:
                                # Assign sequential UI reference on first encounter
                                if citation_ref not in citation_mapping:
                                    citation_counter += 1
                                    citation_mapping[citation_ref] = (
                                        f"[{citation_counter}]"
                                    )
                                    logger.debug(
                                        f"[CITATION REMAP] {citation_ref} -> {citation_mapping[citation_ref]}"
                                    )
                                ui_reference = citation_mapping[citation_ref]

                                source_info = self._find_source_by_reference(
                                    citation_ref, toolkit
                                )
                                if source_info and q:
                                    logger.debug(
                                        f"Sending citation component for {citation_ref} -> {ui_reference}"
                                    )
                                    await self._send_citation_component(
                                        source_info,
                                        agent_id,
                                        session_id,
                                        q,
                                        current_text_component_id,
                                        ui_reference,
                                    )

                        # Send any remaining text
                        if text_to_send and q:
                            output = self.streaming_formatter.format_streaming_event(
                                agent_id=agent_id,
                                agent_name=agent_name,
                                agent_type=agent_type,
                                chunk=text_to_send,
                                message_id=session_id,
                                content_type="chunk",
                            )
                            await q.put(output)

                    final_result = await self._handle_final_response(
                        event, agent_name, toolkit, task_order, q, session_id
                    )
                    if accumulated_text != "":
                        recorder.record_chunk(accumulated_text)
                        accumulated_text = ""

                    recorder.record_final_result(final_result)
                    execution_summary = recorder.get_execution_summary()
                    generated_files = await self._extract_generated_files(
                        session_helper, user_id, session_id
                    )

                    return (
                        final_result,
                        mcp_tools_used,
                        execution_summary,
                        generated_files,
                    )

            execution_summary = recorder.get_execution_summary()
            generated_files = await self._extract_generated_files(
                session_helper, user_id, session_id
            )
            return (None, mcp_tools_used, execution_summary, generated_files)

        except (asyncio.CancelledError, GeneratorExit):
            should_close_stream = False
            raise
        except Exception as e:
            logger.error(f"🔴 Exception occurred in agent {agent.name}: {str(e)}")
            import traceback

            logger.error(f"🔴 Full traceback: {traceback.format_exc()}")
            recorder.record_error(e)
            execution_summary = recorder.get_execution_summary()
            generated_files = await self._extract_generated_files(
                session_helper, user_id, session_id
            )
            return (None, mcp_tools_used, execution_summary, generated_files)
        finally:
            aclose = getattr(stream, "aclose", None)
            if should_close_stream and aclose is not None:
                with contextlib.suppress(Exception):
                    await aclose()

    async def _run_html_agent(
        self, agent, session_helper, user_id, session_id, content, q, agent_id
    ):
        """Run HTML agent with detailed execution recording.

        Args:
            agent: The HTML agent to run.
            session_helper: Helper for managing sessions.
            user_id: The user ID for the session.
            session_id: The session ID.
            content: The input content for the agent.
            q: Queue for streaming events.
            agent_id: The ID of the agent.
        Returns:
            Tuple containing final result, False (no MCP tools), and execution summary (for langfuse tracing).
        """
        recorder = TraceRecorder(agent_name=agent.name, agent_type="html")
        accumulated_text = ""
        runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_helper)

        stream = runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content,
        )
        should_close_stream = True

        try:
            async for event in stream:
                if not event.content or not event.content.parts:
                    continue
                for part in event.content.parts:
                    if part.text:
                        accumulated_text += part.text or ""

                    if (
                        event.is_final_response()
                        and event.content
                        and event.content.parts
                    ):
                        event_text = part.text or ""
                        recorder.record_chunk(event_text)

                        # Send entire HTML as web_preview component (new component format)
                        logger.info(
                            f"[HTML AGENT] Sending HTML as web_preview component - agent_name: {agent.name}, session_id: {session_id}, length: {len(accumulated_text)} chars"
                        )

                        web_preview_chunk = self.streaming_formatter.format_component_event(
                            agent_id=agent_id,
                            component_type="web_preview",
                            component_data={
                                "content": accumulated_text  # Send entire HTML at once
                            },
                            message_id=session_id,
                        )
                        await q.put(web_preview_chunk)
                        logger.info(
                            f"[HTML AGENT] Sending WEB_PREVIEW component to client - agent: {agent.name}"
                        )

                        final_result = (
                            "html was generated successfully and sent to the user"
                        )
                        recorder.record_final_result(final_result)
                        execution_summary = recorder.get_execution_summary()

                        return (final_result, [], execution_summary, [])

            return (None, [], recorder.get_execution_summary(), [])

        except (asyncio.CancelledError, GeneratorExit):
            should_close_stream = False
            raise
        except Exception as e:
            logger.error(f"🔴 Exception occurred in HTML agent: {str(e)}")
            recorder.record_error(e)
            execution_summary = recorder.get_execution_summary()
            return (None, [], execution_summary, [])
        finally:
            aclose = getattr(stream, "aclose", None)
            if should_close_stream and aclose is not None:
                with contextlib.suppress(Exception):
                    await aclose()

    async def _extract_generated_files(self, session_helper, user_id, session_id):
        """Read generated files from session state after agent execution."""
        try:
            session = await session_helper.get_session(
                app_name="manager_app", user_id=user_id, session_id=session_id
            )
            if session and session.state:
                from src.smart_rag.tools.utilities.code_interpreter import (
                    _STATE_KEY_GENERATED_FILES,
                )

                generated_files = session.state.get(_STATE_KEY_GENERATED_FILES, [])
                if generated_files:
                    logger.info(
                        f"[AGENT RUNNER] Extracted {len(generated_files)} generated files from session state"
                    )
                    return generated_files
        except Exception as e:
            logger.warning(
                f"[AGENT RUNNER] Could not extract generated files from session: {e}"
            )
        return []

    async def _handle_function_call(
        self,
        part,
        event,
        agent,
        agent_name,
        q,
        session_id,
        agent_id,
        current_text_component_id=None,
    ):
        """Handle function call events.

        Args:
            part: The part of the event containing the function call.
            event: The full event object.
            agent: The agent making the function call.
            agent_name: The name of the agent.
            q: Queue for streaming events.
            session_id: The session ID.
            agent_id: The ID of the agent.
            current_text_component_id: Optional ID of current text component to append search notification to.

        Returns:
            Updated component ID (if search event was sent), or original component_id

        """
        event_text = self.event_extractor.extract_function_call_info(event, part)
        func_name = part.function_call.name

        # Function call info is no longer sent to client as it's redundant
        # with the specialized search events that provide better context

        # Create specialized search event if applicable
        search_event = self.streaming_formatter.create_search_events_for_function(
            func_name,
            dict(part.function_call.args),
            agent_name,
            session_id,
            agent_id,
            current_text_component_id,
        )
        if search_event and q:
            action = search_event.get("action", "N/A")
            component_id = search_event.get("component", {}).get("id", "N/A")
            logger.info(
                f"[AGENT RUNNER] Sending search_event to backend - agent_name: {agent_name}, function: {func_name}, action: {action}, component_id: {component_id}"
            )
            await q.put(search_event)

            # Extract and return component ID from search event if available
            if "component" in search_event and "id" in search_event["component"]:
                return search_event["component"]["id"]

        return current_text_component_id

    async def _handle_final_response(
        self, event, agent_name, toolkit, task_order, q, session_id
    ):
        """Handle final response from agent."""
        # Safely handle empty parts list
        if not event.content.parts:
            event_text = ""
        else:
            event_text = (
                event.content.parts[0].text if event.content.parts[0].text else ""
            )

        # OLD LOGIC: Sending all sources at the end - DISABLED
        # Sources are now sent dynamically as citations are detected during streaming
        # if toolkit and hasattr(toolkit, 'sources_text') and hasattr(toolkit, 'sources_image'):
        #     sources = toolkit.sources_text + toolkit.sources_image
        #     if q and sources:  # Only send sources if they exist
        #         unique_sources = []
        #         seen_signatures = set()
        #         for source in sources:
        #             try:
        #                 signature = json.dumps(source, sort_keys=True, default=str)
        #             except (TypeError, ValueError):
        #                 signature = str(source)
        #             if signature in seen_signatures:
        #                 continue
        #             seen_signatures.add(signature)
        #             unique_sources.append(source)
        #
        #         if len(unique_sources) < len(sources):
        #             logger.info(
        #                 f"[AGENT RUNNER] Filtered {len(sources) - len(unique_sources)} duplicate sources "
        #                 f"- agent_name: {agent_name}, session_id: {session_id}"
        #             )
        #
        #         logger.info(f"[AGENT RUNNER] Sending {len(unique_sources)} sources to backend - agent_name: {agent_name}, session_id: {session_id}")
        #         for source in unique_sources:
        #             output = self.streaming_formatter.format_streaming_event(
        #                 agent_name=agent_name, agent_type="agent",
        #                 chunk=json.dumps(source), message_id=session_id,
        #                 content_type="source"
        #             )
        #             await q.put(output)
        #
        # elif agent_name == "ReportWriterAgent" and q:
        #     output = self.streaming_formatter.format_streaming_event(
        #         agent_name="ReportWriterAgent", agent_type="reporter",
        #         chunk=json.dumps([]), message_id=session_id,
        #         content_type="source"
        #     )
        #     await q.put(output)

        # Handle diagram references in the final response
        # Replace any remaining diagram references with actual diagram content
        event_text = await self._replace_diagram_references_during_streaming(
            event_text, session_id
        )

        return event_text

    async def _replace_diagram_references_during_streaming(
        self, text: str, session_id: str
    ):
        """Replace diagram references with actual HTML content during streaming.

        Args:
            text: The text chunk that may contain diagram references
            session_id: The session ID for retrieving diagrams

        Returns:
            Text with diagram references replaced by actual HTML content
        """
        import re2 as re

        # DEBUG: Log incoming text (reduced verbosity)
        logger.debug(
            f"[DIAGRAM REPLACEMENT] Processing text (len={len(text)}): {repr(text[:200])}"
        )

        # Find all diagram references in the text (including partial)
        diagram_refs = re.findall(r"\[diagram_(\d+)\]", text)

        # Also check for partial references that might be incomplete
        # This helps with debugging but doesn't replace them
        if "[diagram_" in text and not diagram_refs:
            logger.debug(
                f"[DIAGRAM REPLACEMENT] Found partial diagram reference without closing bracket"
            )

        # DEBUG: Log found references
        if diagram_refs:
            logger.info(
                f"[DIAGRAM REPLACEMENT] Found diagram references: {diagram_refs}"
            )
        else:
            # Check for partial matches that might be split across chunks
            if "[diagram_" in text:
                logger.warning(
                    f"[DIAGRAM REPLACEMENT] Found partial diagram reference in text: {text}"
                )
            logger.debug(f"[DIAGRAM REPLACEMENT] No diagram references found in text")

        if not diagram_refs:
            return text

        # Get the reference tracker from base_factory
        from ...infrastructure.diagram.reference_tracker import _global_diagram_tracker

        reference_tracker = _global_diagram_tracker

        modified_text = text
        replacements_made = 0

        # Sort by reference number in descending order to avoid offset issues when replacing
        for ref_num in sorted(diagram_refs, key=lambda x: int(x), reverse=True):
            if ref_num.isdigit():
                ref_int = int(ref_num)
                logger.info(
                    f"[DIAGRAM REPLACEMENT] Processing diagram_{ref_num} for session {session_id}"
                )

                # Fetch the stored diagram
                diagram = await reference_tracker.get_diagram(session_id, ref_int)

                # DEBUG: Log diagram retrieval result
                if diagram:
                    logger.info(
                        f"[DIAGRAM REPLACEMENT] Retrieved diagram_{ref_num}: {list(diagram.keys())}"
                    )
                    # Replace the reference with actual diagram content in the text
                    replacement_text = diagram.get("html_content", "")
                    if replacement_text:
                        old_ref = f"[diagram_{ref_num}]"
                        modified_text = modified_text.replace(old_ref, replacement_text)
                        replacements_made += 1
                        logger.info(
                            f"[DIAGRAM REPLACEMENT] Successfully replaced {old_ref} with {len(replacement_text)} chars of HTML"
                        )
                    else:
                        logger.warning(
                            f"[DIAGRAM REPLACEMENT] Diagram_{ref_num} has empty html_content"
                        )
                        # Try to get other fields
                        logger.warning(
                            f"[DIAGRAM REPLACEMENT] Available fields: {list(diagram.keys()) if diagram else 'None'}"
                        )
                else:
                    logger.warning(
                        f"[DIAGRAM REPLACEMENT] Failed to retrieve diagram_{ref_num} for session {session_id}"
                    )
                    # Check if we can see what's stored
                    logger.info(
                        f"[DIAGRAM REPLACEMENT] Reference tracker type: {type(reference_tracker)}"
                    )
                    # Try to list available diagrams
                    try:
                        if (
                            hasattr(reference_tracker, "diagrams")
                            and session_id in reference_tracker.diagrams
                        ):
                            available = list(
                                reference_tracker.diagrams[session_id].keys()
                            )
                            logger.info(
                                f"[DIAGRAM REPLACEMENT] Available diagrams in session: {available}"
                            )
                    except Exception as e:
                        logger.error(
                            f"[DIAGRAM REPLACEMENT] Error listing diagrams: {e}"
                        )

        logger.info(
            f"[DIAGRAM REPLACEMENT] Made {replacements_made} replacements, final text length: {len(modified_text)}"
        )
        return modified_text

    async def _handle_dataviz_response(
        self, function_response, agent_name, agent_type, session_id, q
    ):
        """Handle DataViz MCP tool response and send entire response to backend.

        Args:
            function_response: The function response object from the tool
            agent_name: The name of the agent
            agent_type: The type of the agent
            session_id: The session ID
            q: Queue for streaming events

        Returns:
            None
        """
        try:
            logger.info(
                f"[DATAVIZ] Processing tool response for function: {function_response.name}"
            )

            # Get the entire response data
            response_data = function_response.response
            logger.debug(f"[DATAVIZ] Response type: {type(response_data)}")

            # Send entire function response as UI chunk
            ui_chunk = self.streaming_formatter.format_streaming_event(
                agent_name=agent_name,
                agent_type=agent_type,
                chunk=json.dumps(response_data),
                message_id=session_id,
                content_type="ui",
            )
            await q.put(ui_chunk)
            logger.info(f"[DATAVIZ] Sent tool response as UI chunk to backend")

        except Exception as e:
            logger.exception(f"[DATAVIZ] Error handling DataViz response: {e}")

    async def _handle_formviz_response(
        self, function_response, agent_name, agent_type, session_id, q
    ):
        """Handle form visualization tool response and send entire response to backend.

        Args:
            function_response: The function response object from the tool
            agent_name: The name of the agent
            agent_type: The type of the agent
            session_id: The session ID
            q: Queue for streaming events

        Returns:
            None
        """

        def serialize_ui_resources(obj):
            """Recursively serialize UIResource objects in nested structures."""
            if hasattr(obj, "model_dump"):
                return obj.model_dump(mode="json")
            elif isinstance(obj, list):
                return [serialize_ui_resources(item) for item in obj]
            elif isinstance(obj, dict):
                return {
                    key: serialize_ui_resources(value) for key, value in obj.items()
                }
            else:
                return obj

        try:
            logger.info(
                f"[FORMVIZ] Processing tool response for function: {function_response.name}"
            )

            # Get the entire response data
            response_data = function_response.response
            serializable_data = serialize_ui_resources(response_data)
            json_str = json.dumps(serializable_data)
            ui_chunk = self.streaming_formatter.format_streaming_event(
                agent_name=agent_name,
                agent_type=agent_type,
                chunk=json_str,
                message_id=session_id,
                content_type="ui",
            )
            await q.put(ui_chunk)
            logger.info(f"[FORMVIZ] Successfully sent UI chunk to backend")

        except Exception as e:
            logger.error(
                f"[FORMVIZ] Error handling formviz response: {str(e)}", exc_info=True
            )

    async def _handle_web_search_response(
        self, function_response, agent_id, session_id, q
    ):
        """Handle web search response and extract sources to stream as component.

        Args:
            function_response: The function response object from the web search tool
            agent_id: The ID of the agent
            session_id: The session ID
            q: Queue for streaming events

        Returns:
            None
        """
        try:
            logger.info(
                f"[WEB SEARCH] Processing web search response from agent: {agent_id}"
            )

            response_data = function_response.response

            # Check if response has sources
            if isinstance(response_data, dict) and "sources" in response_data:
                sources = response_data.get("sources", [])

                if sources:
                    # Stream sources as sources component
                    sources_chunk = self.streaming_formatter.format_component_event(
                        agent_id=agent_id,
                        component_type="sources",
                        component_data={"sources": sources},
                        message_id=session_id,
                    )
                    await q.put(sources_chunk)
                    logger.info(
                        f"[WEB SEARCH] Successfully streamed {len(sources)} web sources to queue"
                    )
            else:
                logger.debug(
                    f"[WEB SEARCH] No sources found in response or response is not dict. Type: {type(response_data)}"
                )

        except Exception as e:
            logger.error(
                f"[WEB SEARCH] Error handling web search response: {str(e)}",
                exc_info=True,
            )

    async def _handle_python_interpreter_response(
        self, function_response, agent_id, agent_name, session_id, q
    ):
        """Handle python_interpreter response and update sandbox component with output/error.

        Args:
            function_response: The function response object from python_interpreter
            agent_id: The ID of the agent
            agent_name: The name of the agent
            session_id: The session ID
            q: Queue for streaming events

        Returns:
            None
        """
        try:
            logger.info(
                f"[RUNNER SANDBOX] Processing python_interpreter response from agent: {agent_name}"
            )

            response_data = function_response.response

            # Extract function call ID to match the original sandbox component
            call_id = function_response.id if hasattr(function_response, "id") else None

            # Extract stdout from result (don't send stderr to client)
            if isinstance(response_data, dict):
                stdout = response_data.get("stdout", "")
                stderr = response_data.get("stderr", "")  # Keep for logging only

                # Update sandbox component with output and stderr
                sandbox_chunk = self.streaming_formatter.format_component_event(
                    agent_id=agent_id,
                    component_type="sandbox",
                    component_data={
                        "code": "",  # Code already sent in function_call
                        "output": stdout,
                        "error": stderr,  # Include stderr in sandbox component
                        "output_available": True,  # Output is now available
                    },
                    message_id=session_id,
                    action="update",
                    component_id=call_id,  # Use same function call ID as component ID
                )
                await q.put(sandbox_chunk)
                logger.info(
                    f"[RUNNER] Sending SANDBOX component to client - component_id: {call_id}"
                )

                # Note: File artifacts are now handled via old File chunks converted at gRPC level
            else:
                logger.debug(
                    f"[RUNNER SANDBOX] Response is not dict. Type: {type(response_data)}"
                )

        except Exception as e:
            logger.error(
                f"[RUNNER SANDBOX] Error handling python interpreter response: {str(e)}",
                exc_info=True,
            )

    async def _handle_render_chart_response(
        self, function_response, agent_id, session_id, q
    ):
        """Emit a chart component when a sub-agent calls render_chart."""
        try:
            response_data = coerce_to_dict(
                getattr(function_response, "response", None)
            )
            call_id = getattr(function_response, "id", None) or str(uuid.uuid4())

            if not response_data:
                logger.warning(
                    "[CHART] render_chart response empty or un-coercible; raw type=%s",
                    type(getattr(function_response, "response", None)).__name__,
                )
                return

            if response_data.get("error"):
                logger.warning(
                    "[CHART] render_chart tool returned error: %s",
                    response_data.get("details"),
                )
                return

            logger.info(
                "[CHART] emitting render_chart component_id=%s kind=%s data_len=%s",
                call_id,
                response_data.get("kind"),
                len(response_data.get("chartData") or []),
            )

            chart_chunk = self.streaming_formatter.format_component_event(
                agent_id=agent_id,
                component_type="chart",
                component_data={
                    "title": response_data.get("title", ""),
                    "chartData": response_data.get("chartData", []),
                    "config": response_data.get("config", {}),
                    "xAxisKey": response_data.get("xAxisKey", ""),
                    "yAxisKey": response_data.get("yAxisKey", ""),
                    "nameKey": response_data.get("nameKey", ""),
                    "zAxisKey": response_data.get("zAxisKey", ""),
                    "series": response_data.get("series", []),
                    "kind": response_data.get("kind", "bar"),
                    "stacked": response_data.get("stacked", False),
                    "layout": response_data.get("layout", "horizontal"),
                    "innerRadius": response_data.get("innerRadius", 0),
                    "showLegend": response_data.get("showLegend", True),
                    "showGrid": response_data.get("showGrid", True),
                },
                message_id=session_id,
                action="add",
                component_id=call_id,
            )
            await q.put(chart_chunk)
        except Exception as e:
            logger.error(
                f"[CHART] Error handling render_chart response: {str(e)}",
                exc_info=True,
            )

    def _find_source_by_reference(self, citation_ref: str, toolkit) -> Optional[dict]:
        """Find source information by citation reference.

        Args:
            citation_ref: Citation reference like "[1]"
            toolkit: The toolkit with sources_text and sources_image

        Returns:
            Dictionary with raw source object and type if found, None otherwise
        """
        # Search in text sources
        for idx, source in enumerate(toolkit.sources_text):
            source_ref = source.get("reference")

            if source_ref == citation_ref:
                source_obj = source.get("object", {})

                return {"source_object": source_obj, "type": "text"}

        # Search in image sources
        for idx, source in enumerate(toolkit.sources_image):
            source_ref = source.get("reference")

            if source_ref == citation_ref:
                source_obj = source.get("object", {})

                return {"source_object": source_obj, "type": "image"}

        return None

    def _extract_page_number(self, page_info: str) -> str:
        """Extract page number from page info string.

        Args:
            page_info: String like "doc_123.pdf - page 5" or just "5"

        Returns:
            Page number as string, or empty string if not found
        """
        if not page_info:
            return ""

        # Try to match "page 5" or "Page 5"
        match = re.search(r"page\s+(\d+)", page_info, re.IGNORECASE)
        if match:
            return match.group(1)

        # If page_info is just a number string, return it
        if page_info.strip().isdigit():
            return page_info.strip()

        # Try to extract any number from the string
        match = re.search(r"(\d+)", page_info)
        if match:
            return match.group(1)

        return ""

    async def _send_citation_component(
        self,
        source_info: dict,
        agent_id: str,
        session_id: str,
        q: asyncio.Queue,
        parent_text_component_id: str,
        citation_ref: str = "",
    ):
        """Build and send a citation component to the client.

        Args:
            source_info: Dictionary with raw source_object and type
            agent_id: The agent ID
            session_id: The session/message ID
            q: Queue for streaming events
            parent_text_component_id: ID of the parent text component
            citation_ref: The citation reference string (e.g., "[1]", "[2]")
        """
        source_obj = source_info.get("source_object", {})
        source_type = source_info.get("type", "text")
        content = source_obj.get("content", {})

        # Build component data based on type
        if source_type == "text":
            # Build TextSourceData
            component_data = {
                "parent_id": parent_text_component_id,
                "text_source": {
                    "type": "text",
                    "source": content.get("source", ""),
                    "external_id": content.get("external_id", ""),
                    "page": content.get("page", ""),
                    "page_content": content.get("page_content", ""),
                    "workspace_id": content.get(
                        "brain_id", ""
                    ),  # Map brain_id to workspace_id
                    "reference": citation_ref,
                },
            }
        else:
            # Build ImageSourceData
            component_data = {
                "parent_id": parent_text_component_id,
                "image_source": {
                    "type": "image",
                    "path": content.get("path", ""),
                    "page": content.get("page", ""),
                    "file_name": content.get("file_name", ""),
                    "external_id": content.get("external_id", ""),
                    "workspace_id": content.get(
                        "brain_id", ""
                    ),  # Map brain_id to workspace_id
                    "height": str(content.get("height", "")),
                    "width": str(content.get("width", "")),
                    "reference": citation_ref,
                },
            }

        # Each citation is a standalone component (like checkpoints/sandboxes)
        citation_chunk = self.streaming_formatter.format_component_event(
            agent_id=agent_id,
            component_type="citation",
            component_data=component_data,
            message_id=session_id,
            action="add",
            component_id=str(uuid.uuid4()),
        )

        await q.put(citation_chunk)

        logger.info(
            f"[CITATION] Sent citation: type={source_type}, parent_id={parent_text_component_id}"
        )


import contextlib
