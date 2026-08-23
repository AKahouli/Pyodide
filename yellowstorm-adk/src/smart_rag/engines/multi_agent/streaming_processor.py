"""Streaming event processor for handling real-time events from manager agents.

This module provides functionality to process streaming events from manager agents,
handle function calls, track delegations, and format responses for real-time
communication with clients.

Classes:
    StreamingEventProcessor: Main class for processing streaming events from agents.
"""

import asyncio
import contextlib
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, Any, Dict, List

from google.adk.agents import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.genai import types

from src.logger.logging import get_logger
from src.smart_rag.engines.multi_agent.config import langfuse_client
from src.smart_rag.engines.helpers import (
    build_content_with_images,
    coerce_to_dict,
    coerce_to_plain,
)
from src.smart_rag.messaging.component_tracker import ComponentTracker
from src.smart_rag.messaging.ui_tool_component_registry import UI_TOOL_COMPONENT_REGISTRY
from src.guardrails.adapters.google_adk import agent_tree_has_output_guardrail
from src.smart_rag.infrastructure.model_parameters import get_context_window_for_model
from src.smart_rag.tool_activity_presenter import present_tool_call, sanitize_activity_summary, serialize_tool_value

logger = get_logger("api.routers.agentic_rag.StreamingEventProcessor")


class StreamingEventProcessor:
    """Handles processing of streaming events from manager agents.

    This class processes real-time streaming events from manager agents, including
    text responses, function calls, and agent delegations. It manages message IDs,
    tracks delegation counts, and formats events for client consumption.

    Attributes:
        config: Configuration object containing user and system settings.
        streaming_formatter: Formatter for converting events to client format.
        current_message_id (str): ID of the currently active message.
    """

    def __init__(self, config, streaming_formatter, agent_repository=None):
        """Initialize the streaming event processor.

        Args:
            config: Configuration object containing user ID and system settings.
            streaming_formatter: Formatter for converting streaming events to client format.
            agent_repository: Repository for accessing agent information including IDs.
        """
        self.config = config
        self.streaming_formatter = streaming_formatter
        self.agent_repository = agent_repository
        self.current_message_id = None
        # Initialize call_id registry in config if not exists
        if not hasattr(self.config, "call_id_registry"):
            self.config.call_id_registry = {}
        self._manager_pending_tools_by_call_id: Dict[str, List[str]] = {}
        self._manager_pending_tools_by_name: Dict[str, List[str]] = {}
        self._manager_pending_tool_metadata: Dict[str, Dict[str, Any]] = {}
        self._manager_seen_tool_ids: set[str] = set()

    def _get_manager_info(self, manager_agent: Any = None) -> tuple:
        """Resolve manager agent ID and name from repository or agent object.

        Returns:
            Tuple of (manager_id, manager_name) where manager_id defaults to "manager"
        """
        manager_id = None
        manager_name = "manager"

        if self.agent_repository:
            for agent in self.agent_repository.get_all_agents():
                if agent.get("agent_type") == "manager":
                    manager_id = agent.get("id")
                    manager_name = agent.get("name", "manager")
                    break

        if not manager_id and manager_agent and hasattr(manager_agent, "id"):
            manager_id = manager_agent.id
        if (
            manager_name == "manager"
            and manager_agent
            and hasattr(manager_agent, "name")
        ):
            manager_name = manager_agent.name

        return manager_id or "manager", manager_name

    async def process_streaming_events(
        self,
        session_id: str,
        user_prompt: str,
        manager_agent: Any,
        agent_runner,
        q: Optional[asyncio.Queue[dict]] = None,
        team_execution_span=None,
        image_input: Optional[List] = None,
    ) -> str:
        """Process streaming events from the manager agent.

        Processes all streaming events from a manager agent session, handling text
        responses, function calls, and delegations. Tracks accumulated text and
        delegation counts for monitoring and logging.

        Args:
            session_id (str): Unique identifier for the current session.
            user_prompt (str): The original user prompt that initiated the session.
            manager_agent (Any): The manager agent handling the session.
            agent_runner: Runner for executing agent operations.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses to client.
            team_execution_span: Langfuse span for tracking team execution metrics.

        Returns:
            str: The accumulated manager text from the entire conversation
        """
        if image_input:
            content = build_content_with_images(user_prompt, image_input)
        else:
            content = types.Content(role="user", parts=[types.Part(text=user_prompt)])
        message_id = str(uuid.uuid4())
        self.current_message_id = message_id

        accumulated_manager_text = ""
        delegation_count = 0

        # Token usage tracking
        total_prompt_tokens = 0
        total_response_tokens = 0
        total_tokens = 0

        # Track current agent for delegation detection
        current_agent = None

        # Initialize ComponentTracker for plan components (isolated from text tracking)
        component_tracker = ComponentTracker(session_id)
        self._manager_pending_tools_by_call_id: Dict[str, List[str]] = {}
        self._manager_pending_tools_by_name: Dict[str, List[str]] = {}
        self._manager_seen_tool_ids: set[str] = set()

        event_count = 0
        guarded_output = agent_tree_has_output_guardrail(manager_agent)
        validated_final_received = False
        stream = agent_runner.run_async(
            user_id=self.config.user_id,
            session_id=session_id,
            new_message=content,
            run_config=RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=200),
        )
        should_close_stream = True
        try:
            async for event in stream:
                if not event.content or not event.content.parts:
                    continue
                if guarded_output and event.is_final_response():
                    validated_final_received = True
                event_count += 1

                # Track manager as current agent at the start (first event)
                if event_count == 1:
                    _, manager_name = self._get_manager_info(manager_agent)
                    current_agent = manager_name

                # Track token usage if available
                if event.usage_metadata:
                    prompt_tokens = event.usage_metadata.prompt_token_count or 0
                    response_tokens = event.usage_metadata.candidates_token_count or 0
                    event_total_tokens = event.usage_metadata.total_token_count or 0
                    model_name = (
                        event.model_version
                        if hasattr(event, "model_version") and event.model_version
                        else "unknown"
                    )

                    total_prompt_tokens += prompt_tokens
                    total_response_tokens += response_tokens
                    total_tokens += event_total_tokens

                    logger.info(
                        f"[TOKEN USAGE] Event #{event_count} tokens - prompt: {prompt_tokens}, response: {response_tokens}, total: {event_total_tokens}, model: {model_name}"
                    )

                    # Send usage as stream chunk (no component, just usage field)
                    if q:
                        usage_chunk = {
                            "usage": {
                                "input_tokens": prompt_tokens,
                                "output_tokens": response_tokens,
                                "total_tokens": event_total_tokens,
                                "model": model_name,
                                "context_window_tokens": get_context_window_for_model(model_name) or 0,
                            },
                            "metadata": {"message_id": session_id},
                        }
                        await q.put(usage_chunk)
                        logger.info(
                            f"[TOKEN USAGE] Sent usage chunk to client - event #{event_count}, model: {model_name}"
                        )
                else:
                    logger.debug(
                        f"[TOKEN USAGE] Event #{event_count} has no usage_metadata"
                    )

                (
                    message_id,
                    delegation_count,
                    accumulated_manager_text,
                    current_agent,
                ) = await self._handle_event_parts(
                    event,
                    manager_agent,
                    message_id,
                    q,
                    team_execution_span,
                    delegation_count,
                    accumulated_manager_text,
                    current_agent,
                    component_tracker,
                    guarded_output,
                )
        except (asyncio.CancelledError, GeneratorExit):
            should_close_stream = False
            raise
        finally:
            aclose = getattr(stream, "aclose", None)
            if should_close_stream and aclose is not None:
                with contextlib.suppress(Exception):
                    await aclose()

        # Complete final generation span
        if guarded_output and not validated_final_received:
            accumulated_manager_text = ""
        if team_execution_span:
            team_execution_span.update(output=accumulated_manager_text)

        # Log completion of streaming with token usage
        logger.info(
            f"Processed {event_count} streaming events for session {session_id}"
        )
        logger.info(
            f"[TOKEN USAGE] Total tokens - prompt: {total_prompt_tokens}, response: {total_response_tokens}, total: {total_tokens}"
        )

        # Return the accumulated manager text
        return accumulated_manager_text

    async def _handle_event_parts(
        self,
        event,
        manager_agent: Any,
        message_id: str,
        q: Optional[asyncio.Queue[dict]] = None,
        manager_generation_span=None,
        delegation_count: int = 0,
        accumulated_manager_text: str = "",
        current_agent: str = None,
        component_tracker: ComponentTracker = None,
        guarded_output: bool = False,
    ) -> tuple:
        """Handle individual event parts and update message_id if needed.

        Processes individual parts of streaming events, including text content,
        function calls, and function responses. Updates tracking variables and
        creates Langfuse events for monitoring.

        Args:
            event: The streaming event containing content parts.
            manager_agent (Any): The manager agent processing the event.
            message_id (str): Current message identifier.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses.
            manager_generation_span: Langfuse span for tracking generation.
            delegation_count (int): Current count of agent delegations.
            accumulated_manager_text (str): Text accumulated from manager responses.
            current_agent (str): Currently active agent name for delegation tracking.
            component_tracker: ComponentTracker for plan component add/update logic.

        Returns:
            tuple: Updated (message_id, delegation_count, accumulated_manager_text, current_agent).
        """
        current_message_id = message_id
        if not event.content or not event.content.parts:
            return (
                current_message_id,
                delegation_count,
                accumulated_manager_text,
                current_agent,
            )

        has_function_call = any(part.function_call for part in event.content.parts)

        for part in event.content.parts:
            if (
                part.text
                and getattr(part, "thought", False) is not True
                and has_function_call
                and not event.is_final_response()
                and not guarded_output
            ):
                summary = sanitize_activity_summary(part.text)
                if summary and q:
                    manager_id, manager_name = self._get_manager_info(manager_agent)
                    await q.put(self.streaming_formatter.format_component_event(
                        agent_id=manager_id,
                        component_type="agent_activity",
                        component_data={
                            "summary": summary,
                            "status": "completed",
                            "actor_id": manager_id,
                            "actor_name": manager_name,
                        },
                        message_id=current_message_id,
                        component_id=f"activity-{uuid.uuid4()}",
                        action="add",
                    ))
            elif part.text and not event.is_final_response() and not has_function_call:
                event_text = part.text
                accumulated_manager_text += event_text
                if not guarded_output:
                    current_agent = await self._handle_text_event(
                        event_text, current_message_id, q, manager_agent, current_agent
                    )

            # Track function calls to agents
            elif part.function_call:
                # Complete current generation span
                if manager_generation_span:
                    manager_generation_span.update(output=accumulated_manager_text)
                    accumulated_manager_text = ""

                delegation_count += 1
                func_name = part.function_call.name
                tool_args = dict(part.function_call.args or {})
                presentation = present_tool_call(func_name, tool_args)

                if q:
                    raw_call_id = getattr(part.function_call, "id", None)
                    call_id = raw_call_id if isinstance(raw_call_id, str) and raw_call_id else str(uuid.uuid4())
                    manager_id, manager_name = self._get_manager_info(manager_agent)
                    tool_component_id = f"tool-{manager_id}-{call_id}"
                    if tool_component_id in self._manager_seen_tool_ids:
                        tool_component_id = f"{tool_component_id}-{uuid.uuid4()}"
                    self._manager_seen_tool_ids.add(tool_component_id)
                    self._manager_pending_tools_by_call_id.setdefault(call_id, []).append(tool_component_id)
                    self._manager_pending_tools_by_name.setdefault(func_name, []).append(tool_component_id)
                    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    self._manager_pending_tool_metadata[tool_component_id] = {
                        "started_monotonic": time.monotonic(),
                    }
                    await q.put(self.streaming_formatter.format_component_event(
                        agent_id=manager_id,
                        component_type="tool_activity",
                        component_data={
                            "tool_name": func_name,
                            "status": "running",
                            "params_json": serialize_tool_value(tool_args),
                            "started_at": started_at,
                            "display_key": presentation.display_key or "",
                            "fallback_display_name": presentation.fallback_display_name or "",
                            "summary": presentation.summary,
                            "render_kind": presentation.render_kind,
                            "actor_id": manager_id,
                            "actor_name": manager_name,
                            **({
                                "primary_input": tool_args.get("code", ""),
                                "primary_input_language": tool_args.get("language", ""),
                            } if func_name == "run_code" else {}),
                        },
                        message_id=current_message_id,
                        component_id=tool_component_id,
                        action="add",
                    ))

                # Handle dataviz generate_ui function call
                if func_name == "generate_ui" and q:
                    ui_chunk = self.streaming_formatter.format_streaming_event(
                        agent_id="manager",
                        agent_name="manager",
                        agent_type="manager",
                        chunk="generating ui",
                        message_id=current_message_id,
                        content_type="ui",
                    )
                    await q.put(ui_chunk)
                    logger.info(
                        f"[MANAGER DATAVIZ] Sent 'generating ui' chunk for tool: {func_name}"
                    )

                # Handle generate_form_viz function call
                if func_name == "generate_form_viz" and q:
                    ui_chunk = self.streaming_formatter.format_streaming_event(
                        agent_id="manager",
                        agent_name="manager",
                        agent_type="manager",
                        chunk="generating ui",
                        message_id=current_message_id,
                        content_type="ui",
                    )
                    await q.put(ui_chunk)
                    logger.info(
                        f"[FORMVIZ] Sent 'generating ui' chunk for tool: {func_name}"
                    )

                # render_chart: no function_call emission; emit once on function_response.

                # Handle python_interpreter function call - send sandbox with code
                if func_name == "python_interpreter" and q:
                    # Extract code from function arguments
                    code = ""
                    if hasattr(part.function_call, "args") and part.function_call.args:
                        args_dict = dict(part.function_call.args)
                        code = args_dict.get("code", "")

                    # Use function_call.id as component_id for tracking
                    call_id = (
                        part.function_call.id
                        if hasattr(part.function_call, "id")
                        else None
                    )

                    # Send sandbox component with code only (output_available = false)
                    sandbox_chunk = self.streaming_formatter.format_component_event(
                        agent_id="manager",
                        component_type="sandbox",
                        component_data={
                            "code": code,
                            "output": "",
                            "error": "",
                            "output_available": False,
                        },
                        message_id=current_message_id,
                        component_id=call_id,  # Use function call ID as component ID
                    )
                    await q.put(sandbox_chunk)
                    logger.info(
                        f"[PROCESSOR] Sending SANDBOX component to client - component_id: {call_id}"
                    )

                # Extract and accumulate call_id if available (will be streamed at the end)
                if hasattr(part.function_call, "id") and part.function_call.id:
                    call_id = part.function_call.id

                    # Extract agent name from function name (delegate_to_<agent_name>)
                    func_agent_name = (
                        func_name.replace("delegate_to_", "")
                        if func_name.startswith("delegate_to_")
                        else func_name
                    )

                    # Get agent details from repository
                    agent_id = None
                    real_agent_name = func_agent_name  # fallback
                    if self.agent_repository:
                        agent = self.agent_repository.get_agent_by_name(func_agent_name)
                        if agent:
                            agent_id = agent.get("id")
                            real_agent_name = agent.get(
                                "name", func_agent_name
                            )  # Use real name from agent
                        else:
                            agent_id = self.agent_repository.get_agent_id_by_name(
                                func_agent_name
                            )

                    # Store call_id info in registry for delegation function to retrieve
                    self.config.call_id_registry[func_agent_name] = {
                        "call_id": call_id,
                        "agent_id": agent_id,
                        "agent_name": func_agent_name,
                    }
                    logger.debug(
                        f"[AUTO MODE] Stored function call_id: {call_id} for agent: {func_agent_name} (ID: {agent_id}) in registry"
                    )

                    # Track delegated agent as current
                    if (
                        func_name.startswith("delegate_to_")
                        and current_agent != real_agent_name
                    ):
                        current_agent = real_agent_name

                # Create manager function delegation event (following smart_rag_helper pattern)
                function_delegation_event = langfuse_client.event(
                    name=func_name,
                    input={
                        "function_name": func_name,
                        "arguments": dict(part.function_call.args)
                        if part.function_call.args
                        else {},
                        "delegation_order": delegation_count,
                    },
                )

            elif part.function_response:
                func_name = part.function_response.name
                if q:
                    raw_call_id = getattr(part.function_response, "id", None)
                    response_call_id = raw_call_id if isinstance(raw_call_id, str) and raw_call_id else None
                    pending_for_call = self._manager_pending_tools_by_call_id.get(response_call_id, []) if response_call_id else []
                    tool_component_id = pending_for_call.pop(0) if pending_for_call else None
                    if response_call_id and not pending_for_call:
                        self._manager_pending_tools_by_call_id.pop(response_call_id, None)
                    if tool_component_id:
                        pending_for_name = self._manager_pending_tools_by_name.get(func_name, [])
                        if tool_component_id in pending_for_name:
                            pending_for_name.remove(tool_component_id)
                    else:
                        pending_for_name = self._manager_pending_tools_by_name.get(func_name, [])
                        tool_component_id = pending_for_name.pop(0) if pending_for_name else None
                        if tool_component_id:
                            for call_id, pending_component_ids in list(self._manager_pending_tools_by_call_id.items()):
                                if tool_component_id == (pending_component_ids[0] if pending_component_ids else None):
                                    pending_component_ids.pop(0)
                                    if not pending_component_ids:
                                        self._manager_pending_tools_by_call_id.pop(call_id)
                                    break
                    if tool_component_id:
                        metadata = self._manager_pending_tool_metadata.pop(tool_component_id, {})
                        result_json = ""
                        if getattr(q, "include_tool_results", False) and func_name != "generate_web_preview" and not func_name.startswith("delegate_to_"):
                            result_json = serialize_tool_value(part.function_response.response)
                        manager_id, _ = self._get_manager_info(manager_agent)
                        failed = getattr(part.function_response, "is_error", False)
                        response_payload = part.function_response.response
                        if func_name == "run_code" and isinstance(response_payload, dict) and response_payload.get("ok") is False:
                            failed = True
                        started_monotonic = metadata.get("started_monotonic")
                        duration_ms = max(0, round((time.monotonic() - started_monotonic) * 1000)) if isinstance(started_monotonic, float) else 0
                        await q.put(self.streaming_formatter.format_component_event(
                            agent_id=manager_id,
                            component_type="tool_activity",
                            component_data={
                                "tool_name": func_name,
                                "status": "failed" if failed else "completed",
                                "completed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                                "duration_ms": duration_ms,
                                **({"result_json": result_json} if result_json else {}),
                            },
                            message_id=current_message_id,
                            component_id=tool_component_id,
                            action="update",
                        ))
                if func_name == "generate_ui" and q:
                    await self._handle_dataviz_response(
                        part.function_response, current_message_id, q
                    )
                if func_name == "generate_form_viz" and q:
                    await self._handle_formviz_response(
                        part.function_response, current_message_id, q
                    )
                if func_name == "generate_execution_plan" and q:
                    await self._handle_plan_response(
                        part.function_response, current_message_id, q, component_tracker
                    )
                if func_name == "perform_web_search" and q:
                    await self._handle_web_search_response(
                        part.function_response, current_message_id, q
                    )
                if func_name == "python_interpreter" and q:
                    await self._handle_python_interpreter_response(
                        part.function_response, current_message_id, q
                    )
                if func_name == "render_chart" and q:
                    await self._handle_render_chart_response(
                        part.function_response, current_message_id, q
                    )
                if func_name in UI_TOOL_COMPONENT_REGISTRY and func_name != "render_chart" and q:
                    await self._handle_ui_tool_response(part.function_response, current_message_id, q)

            elif event.is_final_response() and event.content and event.content.parts:
                if guarded_output:
                    final_text = "".join(str(getattr(item, "text", "") or "") for item in event.content.parts)
                    accumulated_manager_text = final_text
                    if final_text:
                        current_agent = await self._handle_text_event(
                            final_text, current_message_id, q, manager_agent, current_agent
                        )
                await self._handle_final_response(current_message_id, q)

        return (
            current_message_id,
            delegation_count,
            accumulated_manager_text,
            current_agent,
        )

    async def _handle_text_event(
        self,
        event_text: str,
        message_id: str,
        q: Optional[asyncio.Queue[dict]] = None,
        manager_agent: Any = None,
        current_agent: str = None,
    ) -> str:
        """Handle text events from the stream.

        Processes text content from streaming events and formats them for client
        consumption. Adds text to the streaming queue if available.

        Args:
            event_text (str): The text content from the streaming event.
            message_id (str): Unique identifier for the current message.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses to client.
            manager_agent (Any): The manager agent object.
            current_agent (str): Currently active agent name.

        Returns:
            str: Updated current_agent name
        """
        if q:
            manager_id, manager_name = self._get_manager_info(manager_agent)

            # Reset manager's component tracking when manager speaks again after delegation
            if current_agent and current_agent != manager_name:
                if self.streaming_formatter.component_tracker:
                    self.streaming_formatter.component_tracker.finish_component(
                        manager_id
                    )

            # Send text chunk
            output = self.streaming_formatter.format_streaming_event(
                agent_id=manager_id,
                agent_name=manager_name,
                agent_type="manager",
                chunk=event_text,
                message_id=message_id,
            )
            logger.debug(
                f"[AUTO MODE] Sending manager chunk to backend - message_id: {message_id}"
            )
            await q.put(output)

            # Update current agent to manager
            return manager_name

        return current_agent

    async def _handle_final_response(
        self, message_id: str, q: Optional[asyncio.Queue[dict]] = None
    ) -> None:
        """Handle final response events.

        Processes the final response event in a streaming session, signaling
        the end of message generation to clients.

        Args:
            message_id (str): Unique identifier for the completed message.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses to client.

        Returns:
            None
        """
        # No longer sending "end_of_message" chunk
        # The gRPC stream will naturally terminate when None is put in the queue
        logger.debug(
            f"[AUTO MODE] Final response event received - message_id: {message_id}. Stream will end naturally."
        )

    async def _handle_dataviz_response(
        self, function_response, message_id: str, q: asyncio.Queue[dict]
    ) -> None:
        """Handle DataViz MCP tool response and send entire response to backend.

        Args:
            function_response: The function response object from the tool
            message_id: The message ID for the current response
            q: Queue for streaming events

        Returns:
            None
        """
        import json

        try:
            # Get the entire response data
            response_data = function_response.response
            # Send entire function response as UI chunk
            ui_chunk = self.streaming_formatter.format_streaming_event(
                agent_id="manager",
                agent_name="manager",
                agent_type="manager",
                chunk=json.dumps(response_data),
                message_id=message_id,
                content_type="ui",
            )
            await q.put(ui_chunk)
            logger.info(f"[MANAGER DATAVIZ] Sent tool response as UI chunk to backend")

        except Exception as e:
            logger.error(f"[MANAGER DATAVIZ] Error handling dataviz response: {str(e)}")

    async def _handle_formviz_response(
        self, function_response, message_id: str, q: asyncio.Queue[dict]
    ) -> None:
        """Handle form visualization tool response and send entire response to backend.

        Args:
            function_response: The function response object from the tool
            message_id: The message ID for the current response
            q: Queue for streaming events

        Returns:
            None
        """
        import json

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
            # Get the entire response data
            response_data = function_response.response
            serializable_data = serialize_ui_resources(response_data)
            # Send entire function response as UI chunk
            json_str = json.dumps(serializable_data)
            logger.info(f"[FORMVIZ] JSON string length: {len(json_str)}")

            ui_chunk = self.streaming_formatter.format_streaming_event(
                agent_id="manager",
                agent_name="manager",
                agent_type="manager",
                chunk=json_str,
                message_id=message_id,
                content_type="ui",
            )
            await q.put(ui_chunk)
            logger.info(f"[FORMVIZ] Successfully sent UI chunk to backend")

        except Exception as e:
            logger.error(
                f"[FORMVIZ] Error handling formviz response: {str(e)}", exc_info=True
            )

    async def _handle_plan_response(
        self,
        function_response,
        message_id: str,
        q: asyncio.Queue[dict],
        component_tracker: ComponentTracker = None,
    ) -> None:
        """Handle execution plan tool response and stream plan component.

        Uses a dedicated ComponentTracker (isolated from text tracking) to ensure
        only one plan component exists per session. If a plan already exists,
        it will be updated instead of creating a new one.

        Args:
            function_response: The function response object from the tool
            message_id: The message ID for the current response
            q: Queue for streaming events
            component_tracker: ComponentTracker instance to track plan components per session

        Returns:
            None
        """
        import json

        try:
            response_data = function_response.response

            # Check if response is dict with 'result' key or direct string
            if isinstance(response_data, dict) and "result" in response_data:
                plan_json = response_data["result"]
            else:
                plan_json = response_data

            plan_data = json.loads(plan_json)

            if "error" in plan_data:
                logger.error(f"[PLAN] Tool returned error: {plan_data['error']}")
                return

            # Use dedicated tracker to isolate plan from text tracking
            if component_tracker:
                formatter_with_tracker = type(self.streaming_formatter)(
                    component_tracker=component_tracker
                )
            else:
                formatter_with_tracker = self.streaming_formatter

            plan_events = formatter_with_tracker.format_plan_events(
                agent_id="manager", component_data=plan_data, message_id=message_id
            )

            for event in plan_events:
                await q.put(event)

        except Exception as e:
            logger.error(
                f"[PLAN] Error handling plan response: {str(e)}", exc_info=True
            )

    async def _handle_web_search_response(
        self, function_response, message_id: str, q: asyncio.Queue[dict]
    ) -> None:
        """Handle web search response and extract sources to stream as component.

        Args:
            function_response: The function response object from the web search tool
            message_id: The message ID for the current response
            q: Queue for streaming events

        Returns:
            None
        """
        try:
            response_data = function_response.response

            # Check if response has sources
            if isinstance(response_data, dict) and "sources" in response_data:
                sources = response_data.get("sources", [])

                if sources:
                    # Stream sources as sources component
                    sources_chunk = self.streaming_formatter.format_component_event(
                        agent_id="manager",
                        component_type="sources",
                        component_data={"sources": sources},
                        message_id=message_id,
                    )
                    await q.put(sources_chunk)
                    logger.info(
                        f"[PROCESSOR] Sending SOURCES component to client - count: {len(sources)}"
                    )

        except Exception as e:
            logger.error(
                f"[WEB SEARCH] Error handling web search response: {str(e)}",
                exc_info=True,
            )

    async def _handle_python_interpreter_response(
        self, function_response, message_id: str, q: asyncio.Queue[dict]
    ) -> None:
        """Handle python_interpreter response and update sandbox component with output/error.

        Args:
            function_response: The function response object from python_interpreter
            message_id: The message ID for the current response
            q: Queue for streaming events

        Returns:
            None
        """
        try:
            response_data = function_response.response

            # Extract function call ID to match the original sandbox component
            call_id = function_response.id if hasattr(function_response, "id") else None

            # Extract stdout from result (don't send stderr to client)
            if isinstance(response_data, dict):
                stdout = response_data.get("stdout", "")
                stderr = response_data.get("stderr", "")  # Keep for logging only

                # Update sandbox component with output and stderr
                sandbox_chunk = self.streaming_formatter.format_component_event(
                    agent_id="manager",
                    component_type="sandbox",
                    component_data={
                        "code": "",  # Code already sent in function_call
                        "output": stdout,
                        "error": stderr,  # Include stderr in sandbox component
                        "output_available": True,  # Output is now available
                    },
                    message_id=message_id,
                    action="update",
                    component_id=call_id,  # Use same function call ID as component ID
                )
                await q.put(sandbox_chunk)
                logger.info(
                    f"[PROCESSOR] Sending SANDBOX component to client - component_id: {call_id}"
                )

                # Note: File artifacts are now handled via old File chunks converted at gRPC level

        except Exception as e:
            logger.error(
                f"[SANDBOX] Error handling python interpreter response: {str(e)}",
                exc_info=True,
            )

    async def _handle_ui_tool_response(self, function_response, message_id: str, q: asyncio.Queue[dict]) -> None:
        definition = UI_TOOL_COMPONENT_REGISTRY.get(getattr(function_response, "name", ""))
        response = coerce_to_dict(getattr(function_response, "response", None))
        if definition is None or not response:
            return
        normalized = definition.normalize_response(response)
        if normalized is None:
            logger.warning("[UI TOOL] rejected response tool=%s", getattr(function_response, "name", ""))
            return
        await q.put(self.streaming_formatter.format_component_event(
            agent_id="", component_type=definition.component_type, component_data=normalized,
            message_id=message_id, component_id=getattr(function_response, "id", None) or str(uuid.uuid4()), action="add",
        ))

    async def _handle_render_chart_response(
        self, function_response, message_id: str, q: asyncio.Queue[dict]
    ) -> None:
        try:
            response_data = coerce_to_dict(
                getattr(function_response, "response", None)
            )
            call_id = getattr(function_response, "id", None) or str(uuid.uuid4())

            if not response_data:
                logger.warning(
                    "[CHART] render_chart response empty or un-coercible; "
                    "raw type=%s",
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
                agent_id="manager",
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
                message_id=message_id,
                action="add",
                component_id=call_id,
            )
            await q.put(chart_chunk)
        except Exception as e:
            logger.error(
                f"[CHART] Error handling render_chart response: {str(e)}",
                exc_info=True,
            )
