"""Service for single agent execution using core ADK functions.

This module provides a simplified service interface for running individual agents
using SessionHelper and AgentFactory directly.
"""

import asyncio
from google.genai import types
from google.adk.agents.run_config import StreamingMode, RunConfig

from src.schema.chatbot_schema import RunSingleAgentRequest
from src.smart_rag.agents.factories import AgentFactory
from src.smart_rag.infrastructure.session.manager import SessionHelper
from src.smart_rag.infrastructure.session.execution_lock import (
    PERSISTED_SESSION_APP_NAME,
    session_execution_lock,
)
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.infrastructure.processing import (
    add_diagram_context_before_tool,
    prepare_web_preview_after_tool,
)
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.infrastructure.model_parameters import resolve_model_config
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.messaging import StreamingFormatter
from src.smart_rag.tools import build_tree, SearchToolkit, SearchToolADK, calculator
from src.smart_rag.tools.native_tool_registry import resolve_native_tools
from src.smart_rag.engines.helpers import coerce_to_dict
from src.smart_rag.messaging.ui_tool_component_registry import UI_TOOL_COMPONENT_REGISTRY
from google.adk import Agent
from src.guardrails.adapters.google_adk import build_guarded_adk_agent, output_guardrail_enabled
from src.logger.logging import get_logger
from src.skills.runtime import inject_skill_catalog, make_activate_skill_tool

logger = get_logger("api.smart_rag.SingleAgentService")


class SingleAgentService:
    """Service for executing individual agents directly using core ADK."""

    def __init__(self):
        """Initialize the SingleAgentService."""
        self.prompt_processor = PromptProcessor()
        self.llm_factory = LLMFactory()
        self.agent_factory = AgentFactory(self.prompt_processor, self.llm_factory)
        self.streaming_formatter = StreamingFormatter()
        self.run_config = RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=50)

    async def execute_single_agent(self, request: RunSingleAgentRequest, queue: asyncio.Queue[dict]) -> None:
        """Execute a single agent directly using core ADK functions.

        Args:
            request: The single agent request containing user message and agent configuration.
            queue: AsyncIO queue for streaming response events back to client.

        Returns:
            None: Results are streamed through the queue.
        """
        async with session_execution_lock(
            PERSISTED_SESSION_APP_NAME,
            request.user_id,
            request.session_id,
        ):
            await self._execute_single_agent(request, queue)

    async def _execute_single_agent(self, request: RunSingleAgentRequest, queue: asyncio.Queue[dict]) -> None:
        session_helper = None
        try:
            # 1. Create SessionHelper
            session_helper = SessionHelper(user_id=request.user_id)

            # 2. Create agent using AgentFactory
            agent = await self._create_agent_from_request(request)

            if not agent:
                error_msg = f"Failed to create agent: {request.agent.name}"
                logger.error(error_msg)
                await self._send_error_message(queue, request.session_id, error_msg)
                return

            # 3. Initialize session
            session_id = await session_helper.init_session(agent, request.session_id)

            # 4. Create message content
            content = types.Content(
                role="user",
                parts=[types.Part(text=request.message)]
            )

            # 5. Execute agent using core ADK runner
            accumulated_response = ""

            # Send initial message to indicate agent started
            start_message = self.streaming_formatter.format_streaming_event(
                agent_id=request.agent.id,
                agent_name=request.agent.name,
                agent_type="agent",
                chunk=f"Starting {request.agent.name}...",
                message_id=session_id,
                content_type="description"
            )
            await queue.put(start_message)

            logger.info(f"Starting agent execution for session {session_id}")
            first_response_time = None
            response_count = 0
            guarded_output = output_guardrail_enabled({
                "agent_params": getattr(request.agent, "agent_params", None) or {},
            })

            async for event in session_helper.runner.run_async(
                user_id=request.user_id,
                session_id=session_id,
                new_message=content,
                run_config=self.run_config
            ):
                if not event.content or not event.content.parts:
                    continue

                for part in event.content.parts:
                    # Handle text responses
                    if part.text and not event.is_final_response():
                        text_chunk = part.text
                        accumulated_response += text_chunk

                        response_count += 1

                        if not guarded_output:
                            output = self.streaming_formatter.format_streaming_event(
                                agent_id=request.agent.id,
                                agent_name=request.agent.name,
                                agent_type="agent",
                                chunk=text_chunk,
                                message_id=session_id,
                                content_type="chunk"
                            )
                            await queue.put(output)

                    # Handle function calls
                    if part.function_call:
                        func_name = part.function_call.name
                        func_args = dict(part.function_call.args or {})

                        # Stream function call info to client
                        func_output = self.streaming_formatter.format_streaming_event(
                            agent_id=request.agent.id,
                            agent_name=request.agent.name,
                            agent_type="agent",
                            chunk=f"Calling {func_name}: {func_args}",
                            message_id=session_id,
                            content_type="function_call"
                        )
                        await queue.put(func_output)

                    # Handle function responses
                    if part.function_response:
                        if await self._handle_ui_tool_response(
                            part.function_response,
                            request.agent.id,
                            session_id,
                            queue,
                        ):
                            continue
                        response_text = part.function_response.response
                        response_log = str(response_text)

                        # Log search tool results
                        logger.info(f"Search tool response received: {response_log[:500]}..." if len(response_log) > 500 else f"Search tool response: {response_log}")

                        # Stream search results to client
                        search_output = self.streaming_formatter.format_streaming_event(
                            agent_id=request.agent.id,
                            agent_name=request.agent.name,
                            agent_type="agent",
                            chunk=f"\n📚 Search Results:\n{response_log}\n",
                            message_id=session_id,
                            content_type="source"
                        )
                        await queue.put(search_output)
                # Handle final response
                if event.is_final_response():
                    if event.content and event.content.parts:
                        final_text = "".join(str(getattr(part, "text", "") or "") for part in event.content.parts)
                        should_emit_final = bool(final_text) and (guarded_output or final_text not in accumulated_response)
                        if guarded_output:
                            accumulated_response = final_text
                        elif final_text and final_text not in accumulated_response:
                            accumulated_response += final_text

                        if should_emit_final:
                            final_output = self.streaming_formatter.format_streaming_event(
                                agent_id=request.agent.id,
                                agent_name=request.agent.name,
                                agent_type="agent",
                                chunk=final_text,
                                message_id=session_id,
                                content_type="chunk"
                            )
                            await queue.put(final_output)

                    # Send completion signal
                    logger.info(f"Agent execution completed for session {session_id}, sending completion signal")
                    await queue.put(None)
                    break

            logger.info(f"Exited agent execution loop for session {session_id}")

        except Exception as e:
            logger.error(f"Error in single agent execution: {str(e)}")
            await self._send_error_message(queue, request.session_id, str(e))

        finally:
            # Cleanup session
            if session_helper:
                try:
                    await session_helper.cleanup()
                except Exception as cleanup_error:
                    logger.error(f"Error during session cleanup: {str(cleanup_error)}")

    async def _create_agent_from_request(self, request: RunSingleAgentRequest):
        """Create agent using AgentFactory based on request configuration."""
        try:
            agent_config = request.agent

            # Extract chatbot_name - handle dict or string format with robustness
            # Support both chatbot_name (standard) and chatbot (NestJS alias)
            chatbot_config = agent_config.chatbot_name or agent_config.chatbot or {}
            
            if isinstance(chatbot_config, dict):
                # This legacy path prefers `name`; retain the full config long enough
                # to register request-local model capabilities before flattening it.
                preferred_model = chatbot_config.get('name') or chatbot_config.get('provider') or agent_config.model or 'gpt-5.4-mini'
                chatbot_name = resolve_model_config({
                    **chatbot_config,
                    'provider': preferred_model,
                })
            else:
                chatbot_name = chatbot_config or agent_config.model or 'gpt-5.4-mini'

            # Determine what tools to enable based on agent configuration
            calculator_tool = False
            search_tool = False
            deep_search = False
            search_tool_config = None
            search_web_tool = False
            preview_tool_config = None
            vectorstore_mcp_tool = MCPHelper.has_requested_mcp_type(
                "vectorstore",
                agent_config.tools,
                agent_config.agent_params,
            )

            if agent_config.tools:
                for tool in agent_config.tools:
                    tool_name = tool.get("name", "").lower()
                    if tool_name == "generate_web_preview" and tool.get("enabled", True):
                        preview_tool_config = tool
                    if "calculator" in tool_name:
                        calculator_tool = True
                    elif tool_name == "deep_search":
                        deep_search = True
                        vectorstore_mcp_tool = True
                    elif "search" in tool_name:
                        if "web" in tool_name:
                            search_web_tool = True
                        else:
                            search_tool = True
                            search_tool_config = tool

            # Build agent tools
            tools = []

            # Add standard search tool if search is enabled
            if search_tool and agent_config.brain_ids:
                search_web = "standard" if search_web_tool else "off"

                # Extract top_k from tool config, default to 3
                top_k = search_tool_config.get("top_k", 3) if search_tool_config else 3

                # Create search toolkit
                toolkit = SearchToolkit(
                    task_order=None,
                    workspace_name=agent_config.brain_ids,
                    top_k=top_k,
                    vectorstore=agent_config.vectorstore_name or "default",
                    search_web=search_web,
                    user_id=request.user_id,
                )

                # Create standard search tool schema
                standard_search_schema = {
                    "name": "perform_standard_search",
                    "strict": True,
                    "description": "Standard Search: Retrieves information from all available documents at once. Use this function to search across all documents.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "The search query string"
                            }
                        },
                        "required": ["query"],
                        "additionalProperties": False
                    }
                }

                standard_search_wrapper, standard_tool_schema = toolkit.generate_function(
                    standard_search_schema, toolkit.perform_standard_search
                )
                standard_search_tool = SearchToolADK(func=standard_search_wrapper, schema=standard_tool_schema)
                tools.append(standard_search_tool)

            # Add calculator tool if requested
            if calculator_tool:
                tools.append(calculator)

            if preview_tool_config:
                self.agent_factory.llm_factory = self.llm_factory
                self.agent_factory.set_web_preview_tool_config(preview_tool_config)
                tools.append(
                    self.agent_factory.create_web_preview_tool(
                        chatbot_name, temperature=0.0
                    )
                )

            tools.extend(resolve_native_tools(
                [
                    tool for tool in (agent_config.tools or [])
                    if tool.get("name") not in {"calculator", "generate_web_preview"}
                ],
                runtime_context=agent_config.agent_params or {},
            ))

            if vectorstore_mcp_tool:
                tools.extend(MCPHelper.create_vectorstore_toolsets_with_deep_search(
                    brain_ids=agent_config.brain_ids,
                    deep_search=deep_search,
                ))

            # Inject skill catalog and deep search prompt
            agent_prompt = inject_skill_catalog(agent_config.prompt, agent_config.skills)
            if preview_tool_config and preview_tool_config.get("prompt"):
                agent_prompt += preview_tool_config["prompt"]
            activate_skill_tool = make_activate_skill_tool(agent_config.skills)
            if activate_skill_tool:
                tools.append(activate_skill_tool)

            if deep_search:
                deep_search_workspaces = ", ".join(
                    str(workspace_id)
                    for workspace_id in (agent_config.brain_ids or [])
                    if workspace_id
                )
                agent_prompt += (
                    "\n\n<deep_search_mode>\n"
                    "You are in DEEP SEARCH mode. You MUST follow this two-phase search strategy:\n\n"
                    "Phase 1 — Find relevant documents:\n"
                    "- Call search_relevant_documents FIRST.\n"
                    "- Pass the latest user message verbatim as the query argument; do not summarize or rewrite it.\n"
                    f"- Set workspace_name to the active workspace identifier: {deep_search_workspaces}\n"
                    "- This returns top candidate documents with: document_id, file_name, hybrid_score, matched concepts\n"
                    "- Use the results to identify the most relevant documents for the user's question\n\n"
                    "Phase 2 — Extract detailed information:\n"
                    "- Using the file_name from Phase 1 results, call search_sections() or read_section()\n"
                    "  to get detailed content from those specific documents\n"
                    "- Cross-reference information across multiple documents when relevant\n"
                    "- Use matched_hl_concepts and matched_ll_concepts to guide follow-up searches\n\n"
                    "IMPORTANT: Always start with search_relevant_documents before using other search tools.\n"
                    "This ensures you find the most semantically relevant documents across the entire workspace first,\n"
                    "then dive deep into those specific documents for detailed answers.\n"
                    "</deep_search_mode>"
                )

            # Create LLM with appropriate configuration
            if tools:
                model = self.llm_factory.create_parallel_tool_calls_llm(chatbot_name, temperature=0.0)
            else:
                model = self.llm_factory.create_no_tool_calls_llm(chatbot_name, temperature=0.0)

            agent_kwargs = {
                "name": agent_config.name,
                "model": model,
                "instruction": agent_prompt,
            }
            if tools:
                agent_kwargs["tools"] = tools
            if preview_tool_config:
                agent_kwargs["before_tool_callback"] = add_diagram_context_before_tool
                agent_kwargs["after_tool_callback"] = prepare_web_preview_after_tool
            agent = build_guarded_adk_agent(Agent, agent_kwargs, {
                "id": str(getattr(agent_config, "id", "") or ""),
                "name": str(getattr(agent_config, "name", "") or ""),
                "agent_type": str(getattr(agent_config, "agent_type", "") or ""),
                "user_id": str(getattr(request, "user_id", "") or ""),
                "agent_params": getattr(agent_config, "agent_params", None) or {},
            })

            logger.info(f"Created agent {agent_config.name} with {len(tools)} tools: {[t.schema.get('name') if hasattr(t, 'schema') else str(t) for t in tools]}")

            agent._mcp_search_state = {
                "_mcp_search_user_id": request.user_id,
            }
            if agent_config.brain_ids:
                agent._mcp_search_state["_mcp_search_workspace_name"] = (
                    agent_config.brain_ids[0] if len(agent_config.brain_ids) == 1 else agent_config.brain_ids
                )

            return agent

        except Exception as e:
            import traceback
            logger.error(f"Failed to create agent {request.agent.name}: {str(e)}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            return None

    async def _handle_ui_tool_response(
        self,
        function_response,
        agent_id: str,
        session_id: str,
        queue: asyncio.Queue[dict],
    ) -> bool:
        tool_name = getattr(function_response, "name", "")
        definition = UI_TOOL_COMPONENT_REGISTRY.get(tool_name)
        if definition is None:
            return False
        response = coerce_to_dict(getattr(function_response, "response", None))
        normalized = definition.normalize_response(response) if response else None
        if normalized is None:
            logger.warning("[UI TOOL] rejected response tool=%s", tool_name)
            return True
        await queue.put(
            self.streaming_formatter.format_component_event(
                agent_id=agent_id,
                component_type=definition.component_type,
                component_data=normalized,
                message_id=session_id,
                component_id=getattr(function_response, "id", None),
                action="add",
            )
        )
        return True

    async def _send_error_message(self, queue: asyncio.Queue[dict], session_id: str, error_message: str):
        """Send error message through the queue."""
        try:
            error_output = self.streaming_formatter.format_streaming_event(
                agent_name="System",
                agent_type="error",
                chunk=f"Error: {error_message}",
                message_id=session_id,
                content_type="error"
            )
            await queue.put(error_output)
            await queue.put(None)  # Signal completion
        except Exception as e:
            logger.error(f"Failed to send error message: {str(e)}")
