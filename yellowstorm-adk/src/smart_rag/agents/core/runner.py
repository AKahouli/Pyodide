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
from datetime import datetime, timezone
from urllib.parse import urlparse
from typing import Optional, Tuple, Any, List, Dict
from google.adk import Agent, Runner
from google.adk.agents.run_config import StreamingMode, RunConfig
from google.adk.sessions import InMemorySessionService
from src.temporary_child_summary import record_temporary_child_tool_call
from src.guardrails.adapters.google_adk import agent_tree_has_output_guardrail
from google.genai import types

from src.smart_rag.infrastructure.monitoring import TraceRecorder
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.messaging import MessageTransformer, StreamingFormatter
from src.smart_rag.engines.helpers import build_content_with_images, coerce_to_dict
from src.smart_rag.messaging.ui_tool_component_registry import UI_TOOL_COMPONENT_REGISTRY
from src.flow_engine.runtime.artifact_routing import infer_artifact_kind
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.agentic_rag.AgentRunner")
APP_NAME = "manager_app"
_STATE_KEY_CONNECTOR_TEXT_SOURCES = "_connector_text_sources"
_STATE_KEY_CONNECTOR_IMAGE_SOURCES = "_connector_image_sources"
_STATE_KEY_CONNECTOR_SOURCE_SIGNATURES = "_connector_source_signatures"
_STATE_KEY_CONNECTOR_REFERENCE_COUNTER = "_connector_reference_counter"


def _is_locate_answer_citations_tool(tool_name: str) -> bool:
    return "locate_answer_citations" in str(tool_name or "")


def _registers_connector_citations(tool_name: str) -> bool:
    return _is_locate_answer_citations_tool(tool_name)


def _normalize_structured_sources(value: Any) -> List[Dict[str, str]]:
    """Keep only direct, URL-backed sources that are safe for a public UI."""
    if not isinstance(value, list):
        return []

    sources: List[Dict[str, str]] = []
    seen_urls = set()
    for item in value:
        if not isinstance(item, dict):
            continue

        raw_url = item.get("url")
        if not isinstance(raw_url, str):
            continue
        url = raw_url.strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            continue

        dedupe_key = url
        if dedupe_key in seen_urls:
            continue
        seen_urls.add(dedupe_key)

        raw_title = item.get("title")
        title = raw_title.strip() if isinstance(raw_title, str) else ""
        sources.append({"title": title or parsed.netloc, "url": url})

    return sources


def _loggable_structured_response(tool_name: str, response: Any) -> Any:
    if _registers_connector_citations(tool_name):
        return response
    return "[non-locator structured response omitted]"


def _display_source_name(value: Any) -> str:
    """Normalize a source field to a filename when it contains a URL or path."""
    text = str(value or "").strip()
    if not text:
        return ""

    parsed = urlparse(text)
    if parsed.scheme and parsed.netloc:
        path = parsed.path.rstrip("/")
        if path:
            candidate = path.rsplit("/", 1)[-1].strip()
            if candidate:
                return candidate

    normalized = text.rstrip("/")
    if "/" in normalized:
        candidate = normalized.rsplit("/", 1)[-1].strip()
        if candidate:
            return candidate

    return text


def _normalize_vectorstore_source(value: Any) -> str:
    text = str(value or "").strip()
    prefix = "s3://vectorstore/"
    if text.startswith(prefix):
        return text[len(prefix):]
    return text


def _normalize_reference_token(value: Any) -> str:
    """Normalize citation references so `1` and `[1]` resolve identically."""
    text = str(value or "").strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1].strip()
    return text


def _log_payload(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str, indent=2)
    except (TypeError, ValueError):
        return str(value)


def _replace_citation_marker(text: str, original_ref: str, ui_reference: str) -> str:
    """Replace a citation marker in text with the mapped UI reference."""
    if not text:
        return text
    normalized_original = _normalize_reference_token(original_ref)
    if not normalized_original:
        return text
    return text.replace(f"[{normalized_original}]", f"[{ui_reference}]")


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
        session_id: Optional[str] = None,
        seed_events: Optional[list] = None,
        task_summary: Optional[str] = None,
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

            if hasattr(agent, "_mcp_search_state"):
                initial_state.update(agent._mcp_search_state)

            # When a session_id is provided, reuse the conversation's session so
            # history carries across turns; otherwise mint an ephemeral one
            # (sub-agents / one-shot runs).
            if session_id is None:
                session_id = f"session-{uuid.uuid4()}"
                session = await session_helper.create_session(
                    app_name="manager_app",
                    user_id=user_id,
                    session_id=session_id,
                    state=initial_state or None,
                )
            else:
                session = await session_helper.get_session(
                    app_name="manager_app",
                    user_id=user_id,
                    session_id=session_id,
                )
                if session is None:
                    session = await session_helper.create_session(
                        app_name="manager_app",
                        user_id=user_id,
                        session_id=session_id,
                        state=initial_state or None,
                    )
                    # Seed a read-only snapshot of the shared conversation so this
                    for seed_event in (seed_events or []):
                        await session_helper.append_event(session, seed_event)
            logger.info(f"[SESSION] run_agent_tool using ADK session_id: '{session_id}' (user_id: {user_id})")

        except Exception as e:
            logger.error(
                f"🔴 Exception occurred during session initialization for agent {agent.name}: {str(e)}"
            )
            raise

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

        task_desc = task_summary.strip() if task_summary and task_summary.strip() else self.prompt_processor.extract_task_description(message)
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
                    session,
                    agent_config,
                )
            else:
                return await self._run_html_agent(
                    agent, session_helper, user_id, session_id, content, q, agent_id
                )

        except Exception as e:
            logger.error(f"🔴 Exception occurred in agent {agent.name}: {str(e)}")
            raise

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
        session=None,
        agent_config=None,
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
        agent_role = (
            "temporary_child"
            if agent_config and agent_config.get("_is_temporary_child_agent")
            else "parent"
        )
        accumulated_text = ""
        # Citation buffering using MessageTransformer
        citation_buffer = ""
        # Preserve citation numbers generated upstream while deduplicating repeats.
        citation_mapping = {}
        # Track current text component ID for citation parent_id
        current_text_component_id = None
        # Chain-of-thought: one growing component that collects a tool title per
        # tool call, appended in place.
        cot_steps = []                    # ordered list of tool title strings
        cot_component_id = str(uuid.uuid4())
        cot_sent = False
        pending_tool_components_by_call_id: Dict[str, List[str]] = {}
        pending_tool_components_by_name: Dict[str, List[str]] = {}
        seen_tool_component_ids: set[str] = set()

        runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_helper)
        guarded_output = agent_tree_has_output_guardrail(agent)

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
                        and getattr(part, "thought", False) is not True
                        and not event.is_final_response()
                        and not has_multiple_parts
                        and not guarded_output
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
                        if detected_citations:
                            logger.debug(
                                f"[CITATION DETECTION] Agent referenced {len(detected_citations)} citation(s): {detected_citations}"
                            )

                            for citation_ref in detected_citations:
                                # Assign sequential UI reference on first encounter
                                if citation_ref not in citation_mapping:
                                    citation_mapping[citation_ref] = (
                                        _normalize_reference_token(citation_ref)
                                    )
                                    logger.debug(
                                        f"[CITATION PRESERVE] {citation_ref} -> {citation_mapping[citation_ref]}"
                                    )
                                ui_reference = citation_mapping[citation_ref]

                                # Look up the source
                                source_info = self._find_source_by_reference(
                                    citation_ref,
                                    toolkit,
                                    getattr(session, "state", {}),
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

                                text_to_send = _replace_citation_marker(
                                    text_to_send,
                                    citation_ref,
                                    ui_reference,
                                )

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
                        logger.info(
                            "[TOOL CALL] ADK requested agent_role=%s agent_name=%s agent_id=%s tool_name=%s args=%s",
                            agent_role,
                            agent_name,
                            agent_id,
                            func_name,
                            dict(part.function_call.args),
                        )
                        if agent_role == "temporary_child":
                            agent_params = agent_config.get("agent_params", {}) if agent_config else {}
                            child_name = str(agent_id or agent_name)
                            logger.info(
                                "[TEMP CHILD] Tool call requested child=%s tool_name=%s args=%s",
                                child_name,
                                func_name,
                                dict(part.function_call.args),
                            )
                            record_temporary_child_tool_call(
                                session_id=str(
                                    agent_params.get("temporary_child_summary_session_id")
                                    or session_id
                                ),
                                child=child_name,
                                tool_name=func_name,
                                args=dict(part.function_call.args),
                                status="requested",
                            )

                        if q:
                            tool_args = dict(part.function_call.args or {})
                            raw_call_id = getattr(part.function_call, "id", None)
                            call_id = raw_call_id if isinstance(raw_call_id, str) and raw_call_id else str(uuid.uuid4())
                            actor_id = str(agent_id or agent_name or "agent")
                            tool_component_id = f"tool-{actor_id}-{call_id}"
                            if tool_component_id in seen_tool_component_ids:
                                tool_component_id = f"{tool_component_id}-{uuid.uuid4()}"
                            seen_tool_component_ids.add(tool_component_id)
                            pending_tool_components_by_call_id.setdefault(call_id, []).append(tool_component_id)
                            pending_tool_components_by_name.setdefault(func_name, []).append(tool_component_id)
                            await q.put(
                                self.streaming_formatter.format_component_event(
                                    agent_id=agent_id,
                                    component_type="tool_info",
                                    component_data={
                                        "title": func_name,
                                        "status": "running",
                                        "params": json.dumps(tool_args, default=str, sort_keys=True),
                                        "started_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                                    },
                                    message_id=session_id,
                                    component_id=tool_component_id,
                                    action="add",
                                )
                            )

                        # Chain-of-thought: append this tool title as a step
                        if q:
                            cot_steps.append(func_name)
                            await q.put(
                                self.streaming_formatter.format_component_event(
                                    agent_id=agent_id,
                                    component_type="chain_of_thought",
                                    component_data={"steps": list(cot_steps)},
                                    message_id=session_id,
                                    component_id=cot_component_id,
                                    action="update" if cot_sent else "add",
                                )
                            )
                            cot_sent = True
                            logger.info(
                                f"[CHAIN_OF_THOUGHT] Appended step - title: {func_name}, steps: {len(cot_steps)}, agent: {agent_name}"
                            )

                            if self.streaming_formatter.component_tracker:
                                self.streaming_formatter.component_tracker.finish_component(agent_id)
                            current_text_component_id = None

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

                        if q:
                            raw_call_id = getattr(part.function_response, "id", None)
                            response_call_id = raw_call_id if isinstance(raw_call_id, str) and raw_call_id else None
                            pending_for_call = pending_tool_components_by_call_id.get(response_call_id, []) if response_call_id else []
                            tool_component_id = pending_for_call.pop(0) if pending_for_call else None
                            if response_call_id and not pending_for_call:
                                pending_tool_components_by_call_id.pop(response_call_id, None)
                            if tool_component_id:
                                pending_for_name = pending_tool_components_by_name.get(func_name, [])
                                if tool_component_id in pending_for_name:
                                    pending_for_name.remove(tool_component_id)
                            else:
                                pending_for_name = pending_tool_components_by_name.get(func_name, [])
                                tool_component_id = pending_for_name.pop(0) if pending_for_name else None
                                if tool_component_id:
                                    for call_id, pending_component_ids in list(pending_tool_components_by_call_id.items()):
                                        if tool_component_id == (pending_component_ids[0] if pending_component_ids else None):
                                            pending_component_ids.pop(0)
                                            if not pending_component_ids:
                                                pending_tool_components_by_call_id.pop(call_id)
                                            break

                            if tool_component_id:
                                result_json = ""
                                if getattr(q, "include_tool_results", False) and func_name != "generate_web_preview":
                                    try:
                                        candidate_result_json = json.dumps(
                                            part.function_response.response,
                                            default=str,
                                            separators=(",", ":"),
                                        )
                                        if len(candidate_result_json.encode("utf-8")) <= 65536:
                                            result_json = candidate_result_json
                                    except (TypeError, ValueError):
                                        logger.warning(
                                            "tool_result_serialization_failed tool=%s",
                                            func_name,
                                        )
                                await q.put(
                                    self.streaming_formatter.format_component_event(
                                        agent_id=agent_id,
                                        component_type="tool_info",
                                        component_data={
                                            "title": func_name,
                                            "status": "completed" if success else "failed",
                                            **({"result_json": result_json} if result_json else {}),
                                        },
                                        message_id=session_id,
                                        component_id=tool_component_id,
                                        action="update",
                                    )
                                )

                        if q and await self._handle_ui_tool_response(
                            func_name,
                            part.function_response,
                            agent_id,
                            session_id,
                            q,
                        ):
                            continue

                        response_payload = part.function_response.response
                        if q and isinstance(response_payload, dict) and response_payload.get("ceph_path"):
                            ceph_path = response_payload.get("ceph_path", "")
                            filename = (response_payload.get("path") or ceph_path).rstrip("/").split("/")[-1]
                            artifact_kind = infer_artifact_kind(filename) or "document"
                            await q.put(
                                self.streaming_formatter.format_component_event(
                                    agent_id=agent_id,
                                    component_type="artifact",
                                    component_data={
                                        "file_path": ceph_path,
                                        "filename": filename,
                                        "artifact_kind": artifact_kind,
                                        "output_port_id": "",
                                    },
                                    message_id=session_id,
                                )
                            )
                            logger.info(
                                f"[ARTIFACT] Ceph file artifact emitted - filename: {filename}, kind: {artifact_kind}, ceph_path: {ceph_path}, agent: {agent_name}"
                            )

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
                            if agent_role == "temporary_child":
                                agent_params = agent_config.get("agent_params", {}) if agent_config else {}
                                child_name = str(agent_id or agent_name)
                                result_preview = str(
                                    _log_payload(
                                        _loggable_structured_response(
                                            func_name,
                                            part.function_response.response,
                                        )
                                    )
                                )
                                logger.info(
                                    "[TEMP CHILD] Tool call completed child=%s tool_name=%s result_preview=%s",
                                    child_name,
                                    func_name,
                                    result_preview[:500],
                                )
                                record_temporary_child_tool_call(
                                    session_id=str(
                                        agent_params.get("temporary_child_summary_session_id")
                                        or session_id
                                    ),
                                    child=child_name,
                                    tool_name=func_name,
                                    args={},
                                    result_preview=result_preview,
                                    status="completed",
                                )
                            await self._handle_web_search_response(
                                part.function_response, agent_id, session_id, q
                            )
                        elif q:
                            await self._handle_structured_tool_response(
                                part.function_response,
                                agent_id,
                                session_id,
                                q,
                                getattr(session, "state", {}),
                                agent_role,
                                agent_name,
                                str(
                                    agent_config.get("agent_params", {}).get("temporary_child_summary_session_id")
                                    if agent_config
                                    else session_id
                                ),
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


                if event.is_final_response() and event.content and event.content.parts:
                    final_text_for_citations = "".join(
                        (part.text or "")
                        for part in event.content.parts
                        if getattr(part, "text", None)
                        and getattr(part, "thought", False) is not True
                    )
                    logger.info(
                        "[STREAM END] final_text_length=%s buffered_length=%s final_text_preview=%s",
                        len(final_text_for_citations),
                        len(citation_buffer),
                        final_text_for_citations[:1000],
                    )

                    # Force flush the buffer plus any final text because final-only citations
                    # otherwise bypass the normal non-final streaming detection path.
                    text_to_send, _, detected_citations = (
                        MessageTransformer.simple_tag_transformer(
                            tempmsg=final_text_for_citations,
                            task_n=1,
                            buffer=citation_buffer,
                            force_flush=True,
                        )
                    )
                    citation_buffer = ""

                    # Process detected citations
                    if detected_citations:
                        logger.info(
                            f"[CITATION DETECTION] Found {len(detected_citations)} citation(s) in final flush: {detected_citations}"
                        )

                        for citation_ref in detected_citations:
                            # Assign sequential UI reference on first encounter
                            if citation_ref not in citation_mapping:
                                citation_mapping[citation_ref] = (
                                    _normalize_reference_token(citation_ref)
                                )
                                logger.debug(
                                    f"[CITATION PRESERVE] {citation_ref} -> {citation_mapping[citation_ref]}"
                                )
                            ui_reference = citation_mapping[citation_ref]

                            source_info = self._find_source_by_reference(
                                citation_ref,
                                toolkit,
                                getattr(session, "state", {}),
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

                            text_to_send = _replace_citation_marker(
                                text_to_send,
                                citation_ref,
                                ui_reference,
                            )

                    if not detected_citations:
                        logger.info("[CITATION DETECTION] No citations found in final flush")

                    final_result = await self._handle_final_response(
                        event,
                        agent_id,
                        agent_name,
                        toolkit,
                        task_order,
                        q,
                        session_id,
                        citation_mapping,
                        agent_config,
                        accumulated_text,
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

            raise RuntimeError("Agent stream ended without a final response")

        except (asyncio.CancelledError, GeneratorExit):
            should_close_stream = False
            raise
        except Exception as e:
            logger.error(f"🔴 Exception occurred in agent {agent.name}: {str(e)}")
            import traceback

            logger.error(f"🔴 Full traceback: {traceback.format_exc()}")
            recorder.record_error(e)
            raise
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
        guarded_output = agent_tree_has_output_guardrail(agent)
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
                if guarded_output and event.is_final_response():
                    accumulated_text = ""
                for part in event.content.parts:
                    if (
                        part.text
                        and getattr(part, "thought", False) is not True
                        and (not guarded_output or event.is_final_response())
                    ):
                        accumulated_text += part.text

                if event.is_final_response():
                    recorder.record_chunk(accumulated_text)

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
        self,
        event,
        agent_id,
        agent_name,
        toolkit,
        task_order,
        q,
        session_id,
        citation_mapping: Optional[Dict[str, str]] = None,
        agent_config: Optional[dict] = None,
        streamed_text: str = "",
    ):
        """Handle final response from agent."""
        event_text = "".join(
            (part.text or "")
            for part in event.content.parts
            if getattr(part, "text", None)
            and getattr(part, "thought", False) is not True
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

        for citation_ref, ui_reference in (citation_mapping or {}).items():
            event_text = _replace_citation_marker(
                event_text,
                citation_ref,
                ui_reference,
            )

        should_emit_final = bool(event_text) and event_text != streamed_text
        if q and should_emit_final:
            if self.streaming_formatter.component_tracker:
                self.streaming_formatter.component_tracker.finish_component(agent_id)
            await q.put(self.streaming_formatter.format_streaming_event(
                agent_id=agent_id,
                agent_name=agent_name,
                agent_type="agent",
                chunk=event_text,
                message_id=session_id,
                content_type="final_response",
            ))

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

            if not isinstance(response_data, dict):
                logger.debug(
                    f"[WEB SEARCH] No sources found in response or response is not dict. Type: {type(response_data)}"
                )
                return

            sources = _normalize_structured_sources(response_data.get("sources"))
            if not sources:
                logger.debug("[WEB SEARCH] No valid URL-backed sources to stream")
                return

            sources_chunk = self.streaming_formatter.format_component_event(
                agent_id=agent_id,
                component_type="sources",
                component_data={"sources": sources},
                message_id=session_id,
            )
            await q.put(sources_chunk)
            logger.info(f"[WEB SEARCH] Streamed {len(sources)} web sources to queue")

        except Exception as e:
            logger.error(
                f"[WEB SEARCH] Error handling web search response: {str(e)}",
                exc_info=True,
            )

    async def _handle_structured_tool_response(
        self,
        function_response: Any,
        agent_id: str,
        session_id: str,
        q: asyncio.Queue,
        session_state: Optional[Dict[str, Any]] = None,
        agent_role: str = "parent",
        agent_name: str = "",
        summary_session_id: str = "",
    ) -> None:
        """Emit supported source components from structured tool responses."""
        try:
            response_data = function_response.response
            tool_name = getattr(function_response, "name", "unknown")
            logger.info(
                "[STRUCTURED TOOL RESPONSE] agent_role=%s agent_name=%s tool=%s response_type=%s full_response=%s",
                agent_role,
                agent_name,
                tool_name,
                type(response_data).__name__,
                _log_payload(_loggable_structured_response(tool_name, response_data)),
            )
            if agent_role == "temporary_child":
                child_name = str(agent_id or agent_name)
                result_preview = str(_log_payload(_loggable_structured_response(tool_name, response_data)))
                logger.info(
                    "[TEMP CHILD] Tool call completed child=%s tool_name=%s result_preview=%s",
                    child_name,
                    tool_name,
                    result_preview[:500],
                )
                record_temporary_child_tool_call(
                    session_id=summary_session_id or session_id,
                    child=child_name,
                    tool_name=tool_name,
                    args={},
                    result_preview=result_preview,
                    status="completed",
                )
            if not isinstance(response_data, dict):
                return

            if _registers_connector_citations(tool_name):
                self._register_connector_citation_sources_from_response(
                    response_data,
                    session_state if session_state is not None else {},
                    tool_name,
                )

            sources = _normalize_structured_sources(response_data.get("sources"))
            if sources:
                logger.info(
                    "[STRUCTURED TOOL RESPONSE] tool=%s valid_sources_count=%s",
                    tool_name,
                    len(sources),
                )
                sources_chunk = self.streaming_formatter.format_component_event(
                    agent_id=agent_id,
                    component_type="sources",
                    component_data={"sources": sources},
                    message_id=session_id,
                )
                await q.put(sources_chunk)
            else:
                logger.info(
                    "[STRUCTURED TOOL RESPONSE] tool=%s no_valid_sources",
                    tool_name,
                )
        except Exception as e:
            logger.error(
                f"[STRUCTURED TOOL RESPONSE] Error handling structured tool response: {str(e)}",
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

    async def _handle_ui_tool_response(
        self, tool_name: str, function_response: Any, agent_id: str, session_id: str, q: asyncio.Queue[dict]
    ) -> bool:
        """Convert registered native UI-tool responses into atomic components."""
        definition = UI_TOOL_COMPONENT_REGISTRY.get(tool_name)
        if definition is None:
            return False
        response = coerce_to_dict(getattr(function_response, "response", None))
        normalized = definition.normalize_response(response) if response else None
        if normalized is None:
            logger.warning("[UI TOOL] rejected response tool=%s", tool_name)
            return True
        component_id = getattr(function_response, "id", None) or str(uuid.uuid4())
        await q.put(
            self.streaming_formatter.format_component_event(
                agent_id=agent_id,
                component_type=definition.component_type,
                component_data=normalized,
                message_id=session_id,
                component_id=component_id,
                action="add",
            )
        )
        logger.info("[UI TOOL] emitted component tool=%s component_id=%s", tool_name, component_id)
        return True

    def _find_source_by_reference(
        self,
        citation_ref: str,
        toolkit,
        session_state: Optional[Dict[str, Any]] = None,
    ) -> Optional[dict]:
        """Find source information by citation reference.

        Args:
            citation_ref: Citation reference like "1" or "[1]"
            toolkit: The toolkit with sources_text and sources_image
            session_state: Optional session state containing connector sources

        Returns:
            Dictionary with raw source object and type if found, None otherwise
        """
        logger.info(
            "[CITATION LOOKUP] looking_for=%s toolkit_text_count=%s toolkit_image_count=%s connector_text_count=%s connector_image_count=%s",
            citation_ref,
            len(getattr(toolkit, "sources_text", [])) if toolkit else 0,
            len(getattr(toolkit, "sources_image", [])) if toolkit else 0,
            len((session_state or {}).get(_STATE_KEY_CONNECTOR_TEXT_SOURCES, [])),
            len((session_state or {}).get(_STATE_KEY_CONNECTOR_IMAGE_SOURCES, [])),
        )

        def _matches_reference(source_entry: Dict[str, Any]) -> bool:
            if _normalize_reference_token(source_entry.get("reference")) == _normalize_reference_token(citation_ref):
                return True
            aliases = source_entry.get("reference_aliases", [])
            return (
                isinstance(aliases, list)
                and _normalize_reference_token(citation_ref)
                in {_normalize_reference_token(alias) for alias in aliases}
            )

        # Search in text sources
        for idx, source in enumerate(getattr(toolkit, "sources_text", [])):
            source_ref = source.get("reference")

            if _normalize_reference_token(source_ref) == _normalize_reference_token(citation_ref):
                source_obj = source.get("object", {})
                logger.info(
                    "[CITATION LOOKUP] found_in_toolkit_text reference=%s source=%s file_name=%s",
                    citation_ref,
                    source_obj.get("content", {}).get("source", ""),
                    source_obj.get("content", {}).get("file_name", ""),
                )

                return {"source_object": source_obj, "type": "text"}

        # Search in image sources
        for idx, source in enumerate(getattr(toolkit, "sources_image", [])):
            source_ref = source.get("reference")

            if _normalize_reference_token(source_ref) == _normalize_reference_token(citation_ref):
                source_obj = source.get("object", {})
                logger.info(
                    "[CITATION LOOKUP] found_in_toolkit_image reference=%s path=%s workspace_name=%s",
                    citation_ref,
                    source_obj.get("content", {}).get("path", ""),
                    source_obj.get("content", {}).get("workspace_name", ""),
                )

                return {"source_object": source_obj, "type": "image"}

        for source in (session_state or {}).get(_STATE_KEY_CONNECTOR_TEXT_SOURCES, []):
            if _matches_reference(source):
                logger.info(
                    "[CITATION LOOKUP] found_in_connector_text reference=%s stored_reference=%s aliases=%s source=%s file_name=%s",
                    citation_ref,
                    source.get("reference", ""),
                    source.get("reference_aliases", []),
                    source.get("object", {}).get("content", {}).get("source", ""),
                    source.get("object", {}).get("content", {}).get("file_name", ""),
                )
                return {"source_object": source.get("object", {}), "type": "text"}

        for source in (session_state or {}).get(
            _STATE_KEY_CONNECTOR_IMAGE_SOURCES, []
        ):
            if _matches_reference(source):
                logger.info(
                    "[CITATION LOOKUP] found_in_connector_image reference=%s stored_reference=%s aliases=%s path=%s workspace_name=%s",
                    citation_ref,
                    source.get("reference", ""),
                    source.get("reference_aliases", []),
                    source.get("object", {}).get("content", {}).get("path", ""),
                    source.get("object", {}).get("content", {}).get("workspace_name", ""),
                )
                return {"source_object": source.get("object", {}), "type": "image"}

        logger.info("[CITATION LOOKUP] not_found reference=%s", citation_ref)
        return None

    def _build_connector_source_signature(self, source: Dict[str, Any]) -> str:
        source_type = str(source.get("type") or "text")
        if source_type == "image":
            parts = [
                source_type,
                str(source.get("source") or source.get("path") or ""),
                str(source.get("file_name") or ""),
                str(source.get("page") or ""),
                str(source.get("highlight_text") or ""),
                str(source.get("highlight_bbox") or source.get("block_bbox") or ""),
            ]
        else:
            parts = [
                source_type,
                str(source.get("source") or ""),
                str(source.get("file_name") or ""),
                str(source.get("page") or ""),
                str(source.get("page_content") or ""),
            ]
        return "::".join(parts)

    def _register_connector_citation_sources_from_response(
        self,
        response_data: Dict[str, Any],
        session_state: Dict[str, Any],
        tool_name: str,
    ) -> None:
        citation_sources = response_data.get("citation_sources")
        if not isinstance(citation_sources, list):
            citation_sources = self._extract_connector_citation_sources_from_response(
                response_data,
                tool_name,
            )
        if not isinstance(citation_sources, list) or session_state is None:
            return

        text_sources = session_state.setdefault(_STATE_KEY_CONNECTOR_TEXT_SOURCES, [])
        image_sources = session_state.setdefault(
            _STATE_KEY_CONNECTOR_IMAGE_SOURCES, []
        )
        signatures = session_state.setdefault(_STATE_KEY_CONNECTOR_SOURCE_SIGNATURES, {})

        logger.info(
            "[STRUCTURED TOOL RESPONSE] tool=%s citation_source_count_in_response=%s existing_connector_text_count=%s existing_connector_image_count=%s",
            tool_name,
            len(citation_sources),
            len(text_sources),
            len(image_sources),
        )

        for source in citation_sources:
            if not isinstance(source, dict):
                continue

            normalized_source = dict(source)
            source_reference = _normalize_reference_token(
                normalized_source.get("reference")
            )
            signature = self._build_connector_source_signature(normalized_source)
            reference = signatures.get(signature)

            if not reference:
                next_ref = int(session_state.get(_STATE_KEY_CONNECTOR_REFERENCE_COUNTER, 0)) + 1
                session_state[_STATE_KEY_CONNECTOR_REFERENCE_COUNTER] = next_ref
                reference = str(next_ref)
                signatures[signature] = reference

                source_type = str(normalized_source.get("type") or "text")
                if source_type == "image":
                    image_sources.append(
                        {
                            "reference": reference,
                            "reference_aliases": list(
                                normalized_source.get("reference_aliases") or []
                            ),
                            "object": {
                                "content": {
                                    "path": str(
                                        normalized_source.get("source")
                                        or normalized_source.get("path")
                                        or ""
                                    ),
                                    "page": str(normalized_source.get("page") or ""),
                                    "file_name": str(
                                        normalized_source.get("file_name") or ""
                                    ),
                                    "workspace_name": "",
                                    "workspace_id": "",
                                    "brain_id": "",
                                    "height": str(normalized_source.get("height") or ""),
                                    "width": str(normalized_source.get("width") or ""),
                                    "highlight_text": str(
                                        normalized_source.get("highlight_text") or ""
                                    ),
                                    "highlight_bbox": normalized_source.get(
                                        "highlight_bbox"
                                    ) or [],
                                    "block_bbox": normalized_source.get("block_bbox")
                                    or [],
                                }
                            },
                        }
                    )
                else:
                    text_sources.append(
                        {
                            "reference": reference,
                            "reference_aliases": list(
                                normalized_source.get("reference_aliases") or []
                            ),
                            "object": {
                                "content": {
                                    "source": str(normalized_source.get("source") or ""),
                                    "file_name": str(
                                        normalized_source.get("file_name") or ""
                                    ),
                                    "page": str(normalized_source.get("page") or ""),
                                    "page_content": str(
                                        normalized_source.get("page_content") or ""
                                    ),
                                    "_read_content_doc": bool(
                                        normalized_source.get("_read_content_doc")
                                    ),
                                    "_pages_cache": normalized_source.get("_pages_cache") or [],
                                    "brain_id": str(
                                        normalized_source.get("workspace_id") or ""
                                    ),
                                    "highlight_text": str(
                                        normalized_source.get("highlight_text") or ""
                                    ),
                                    "highlight_bbox": normalized_source.get(
                                        "highlight_bbox"
                                    ) or [],
                                    "block_bbox": normalized_source.get("block_bbox")
                                    or [],
                                }
                            },
                        }
                    )
                target_sources = image_sources if source_type == "image" else text_sources
                if source_reference and source_reference != reference:
                    target_sources[-1]["reference_aliases"].append(source_reference)
                source_id_field = normalized_source.get("type", "text") == "image" and normalized_source.get("workspace_name") or normalized_source.get("file_name") or ""
                logger.info(
                    "[STRUCTURED TOOL RESPONSE] tool=%s registered_fallback_connector_citation reference=%s aliases=%s source_type=%s source=%s id_value=%s",
                    tool_name,
                    reference,
                    normalized_source.get("reference_aliases") or [],
                    normalized_source.get("type", "text"),
                    normalized_source.get("source") or normalized_source.get("path") or "",
                    source_id_field,
                )
            else:
                source_id_field = normalized_source.get("type", "text") == "image" and normalized_source.get("workspace_name") or normalized_source.get("file_name") or ""
                logger.info(
                    "[STRUCTURED TOOL RESPONSE] tool=%s reused_fallback_connector_citation reference=%s aliases=%s source=%s id_value=%s",
                    tool_name,
                    reference,
                    normalized_source.get("reference_aliases") or [],
                    normalized_source.get("source") or normalized_source.get("path") or "",
                    source_id_field,
                )

        logger.info(
            "[STRUCTURED TOOL RESPONSE] tool=%s connector_source_totals_after_registration text=%s image=%s",
            tool_name,
            len(text_sources),
            len(image_sources),
        )

    def _extract_connector_citation_sources_from_response(
        self,
        response_data: Dict[str, Any],
        tool_name: str,
    ) -> List[Dict[str, Any]]:
        """Build citation sources from raw connector response payloads.

        Handles connectors like searchv2 that return a dict with a JSON-string
        `result` field containing document blocks.
        """
        result_payload = response_data.get("result")
        raw_citations = response_data.get("citations")
        if isinstance(raw_citations, list):
            citation_sources: List[Dict[str, Any]] = []
            seen = set()
            for index, citation in enumerate(raw_citations):
                if not isinstance(citation, dict):
                    continue

                raw_source = citation.get("source") or citation.get("path") or ""
                source = _normalize_vectorstore_source(raw_source)
                file_name = _display_source_name(raw_source)
                page = str(
                    citation.get("page")
                    or citation.get("page_number")
                    or ""
                ).strip()
                highlight_text = str(
                    citation.get("highlight_text")
                    or citation.get("highlightText")
                    or citation.get("page_content")
                    or ""
                )
                highlight_bbox = (
                    citation.get("highlight_bbox")
                    or citation.get("highlightBBox")
                    or []
                )
                reference = str(
                    citation.get("reference")
                    or citation.get("citation")
                    or index + 1
                )
                signature = (source, page, highlight_text)
                if signature in seen:
                    continue
                seen.add(signature)

                citation_sources.append(
                    {
                        "type": "text",
                        "source": source,
                        "file_name": file_name,
                        "page": page,
                        "page_content": highlight_text,
                        "workspace_id": str(
                            citation.get("workspace_id")
                            or citation.get("workspace_name")
                            or ""
                        ),
                        "reference": reference,
                        "reference_aliases": [],
                        "highlight_text": highlight_text,
                        "highlight_bbox": highlight_bbox,
                        "block_bbox": highlight_bbox,
                    }
                )
            if citation_sources:
                logger.info(
                    "[STRUCTURED TOOL RESPONSE] tool=%s extracted_citation_sources_from_citations count=%s",
                    tool_name,
                    len(citation_sources),
                )
            return citation_sources

        if isinstance(result_payload, str):
            try:
                result_payload = json.loads(result_payload)
            except json.JSONDecodeError:
                logger.info(
                    "[STRUCTURED TOOL RESPONSE] tool=%s result_field_not_json_string",
                    tool_name,
                )
                return []

        if not isinstance(result_payload, list):
            return []

        citation_sources: List[Dict[str, Any]] = []
        seen = set()
        for block in result_payload:
            if not isinstance(block, dict):
                continue

            content = str(block.get("content") or "").strip()
            if not content:
                continue

            file_name = str(
                block.get("block_id")
                or block.get("file_name")
                or block.get("filename")
                or block.get("external_id")
                or block.get("doc_id")
                or block.get("id")
                or ""
            ).strip()
            page_number = block.get("page_number")
            if isinstance(page_number, int):
                page = str(page_number + 1)
            else:
                page = str(page_number or "").strip()

            source = _display_source_name(
                block.get("source")
                or block.get("document_name")
                or block.get("filename")
                or block.get("file_name")
                or tool_name
            )
            workspace_id = str(
                block.get("brain_id") or block.get("workspace_id") or ""
            ).strip()
            reference_aliases: List[str] = []

            document_id = block.get("document_id")
            if document_id is not None:
                document_id_value = str(document_id).strip()
                if document_id_value:
                    reference_aliases.append(document_id_value)

            signature = (source, file_name, page, content)
            if signature in seen:
                continue
            seen.add(signature)

            citation_sources.append(
                {
                    "type": "text",
                    "source": source,
                    "file_name": file_name,
                    "page": page,
                    "page_content": content,
                    "workspace_id": workspace_id,
                    "reference": "",
                    "reference_aliases": reference_aliases,
                }
            )

        if citation_sources:
            logger.info(
                "[STRUCTURED TOOL RESPONSE] tool=%s extracted_citation_sources_from_result count=%s",
                tool_name,
                len(citation_sources),
            )

        return citation_sources

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
        match = re.search(r"(?i)page\s+(\d+)", page_info)
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
            component_data = {
                "parent_id": parent_text_component_id,
                "text_source": {
                    "type": "text",
                    "source": content.get("source", ""),
                    "file_name": content.get("file_name", ""),
                    "page": content.get("page", ""),
                    "page_content": content.get("page_content", ""),
                    "workspace_id": content.get(
                        "brain_id", ""
                    ),
                    "reference": citation_ref,
                    "highlight_text": content.get("highlight_text", ""),
                    "highlight_bbox": content.get("highlight_bbox", []),
                    "block_bbox": content.get("block_bbox", []),
                },
            }
        else:
            component_data = {
                "parent_id": parent_text_component_id,
                "image_source": {
                    "type": "image",
                    "path": content.get("path", ""),
                    "page": content.get("page", ""),
                    "file_name": content.get("file_name", ""),
                    "workspace_name": content.get("workspace_name", ""),
                    "workspace_id": content.get(
                        "brain_id", ""
                    ),
                    "height": str(content.get("height", "")),
                    "width": str(content.get("width", "")),
                    "reference": citation_ref,
                    "highlight_text": content.get("highlight_text", ""),
                    "highlight_bbox": content.get("highlight_bbox", []),
                    "block_bbox": content.get("block_bbox", []),
                },
            }

        # Each citation is a standalone component (like checkpoints/sandboxes)
        logger.info(
            "[CITATION EMIT] parent_text_component_id=%s citation_ref=%s source_type=%s component_data_preview=%s",
            parent_text_component_id,
            citation_ref,
            source_type,
            str(component_data)[:1000],
        )
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
