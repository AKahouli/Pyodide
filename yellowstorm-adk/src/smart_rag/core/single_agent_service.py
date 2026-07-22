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
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.infrastructure.model_parameters import resolve_model_config
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.messaging import StreamingFormatter
from src.smart_rag.infrastructure.monitoring import langfuse_client
from src.smart_rag.tools import build_tree, SearchToolkit, SearchToolADK, calculator
from google.adk import Agent
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
        # Create main trace for single agent execution
        main_trace = langfuse_client.trace(
            session_id=request.session_id,
            id=request.session_id,
            name="single_agent_conversation",
            user_id=request.user_id,
            input={
                "user_message": request.message,
                "agent_name": request.agent.name,
                "agent_description": request.agent.description,
                "brain_ids": request.agent.brain_ids
            },
            metadata={
                "session_id": request.session_id,
                "user_id": request.user_id,
                "workflow_type": "single_agent_conversation"
            }
        )

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

            # Create agent execution span
            agent_execution_span = langfuse_client.span(
                trace_id=request.session_id,
                parent_observation_id=main_trace.id,
                name=f"Agent_{request.agent.name}",
                input={
                    "agent_prompt": request.agent.prompt,
                    "user_message": request.message,
                    "agent_tools": request.agent.tools
                },
            )

            # 5. Execute agent using core ADK runner
            accumulated_response = ""
            function_calls_made = []

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

                        # Stream text chunks to client
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
                        func_args = dict(part.function_call.args)
                        function_calls_made.append({"name": func_name, "args": func_args})

                        # Log function call event
                        agent_execution_span.event(
                            name=f"function_{func_name}",
                            input={"function_name": func_name, "arguments": func_args}
                        )

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
                        response_text = part.function_response.response

                        # Log search tool results
                        logger.info(f"Search tool response received: {response_text[:500]}..." if len(response_text) > 500 else f"Search tool response: {response_text}")

                        agent_execution_span.event(
                            name="function_response",
                            output={"response": response_text}
                        )

                        # Stream search results to client
                        search_output = self.streaming_formatter.format_streaming_event(
                            agent_id=request.agent.id,
                            agent_name=request.agent.name,
                            agent_type="agent",
                            chunk=f"\n📚 Search Results:\n{response_text}\n",
                            message_id=session_id,
                            content_type="source"
                        )
                        await queue.put(search_output)
                # Handle final response
                if event.is_final_response():
                    if event.content and event.content.parts:
                        final_text = event.content.parts[0].text if event.content.parts[0].text else ""
                        if final_text and final_text not in accumulated_response:
                            accumulated_response += final_text

                            # Stream final text
                            final_output = self.streaming_formatter.format_streaming_event(
                                agent_id=request.agent.id,
                                agent_name=request.agent.name,
                                agent_type="agent",
                                chunk=final_text,
                                message_id=session_id,
                                content_type="chunk"
                            )
                            await queue.put(final_output)

                    # Update spans with final results
                    agent_execution_span.update(output={
                        "final_response": accumulated_response,
                        "function_calls_made": function_calls_made,
                        "execution_successful": True,
                    })

                    main_trace.update(output={
                        "conversation_completed": True,
                        "final_response": accumulated_response,
                        "execution_successful": True
                    })

                    # Send completion signal
                    logger.info(f"Agent execution completed for session {session_id}, sending completion signal")
                    await queue.put(None)
                    break

            logger.info(f"Exited agent execution loop for session {session_id}")
            # Flush langfuse
            try:
                langfuse_client.flush()
            except Exception as e:
                logger.error(f"Failed to flush Langfuse client: {str(e)}")

        except Exception as e:
            logger.error(f"Error in single agent execution: {str(e)}")
            main_trace.update(output={
                "error": str(e),
                "execution_successful": False
            })
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
            vectorstore_mcp_tool = MCPHelper.has_requested_mcp_type(
                "vectorstore",
                agent_config.tools,
                agent_config.agent_params,
            )

            if agent_config.tools:
                for tool in agent_config.tools:
                    tool_name = tool.get("name", "").lower()
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

            if vectorstore_mcp_tool:
                tools.extend(MCPHelper.create_vectorstore_toolsets_with_deep_search(
                    brain_ids=agent_config.brain_ids,
                    deep_search=deep_search,
                ))

            # Inject skill catalog and deep search prompt
            agent_prompt = inject_skill_catalog(agent_config.prompt, agent_config.skills)
            activate_skill_tool = make_activate_skill_tool(agent_config.skills)
            if activate_skill_tool:
                tools.append(activate_skill_tool)

            if deep_search:
                agent_prompt += (
                    "\n\n<deep_search_mode>\n"
                    "You are in DEEP SEARCH mode. You MUST follow this two-phase search strategy:\n\n"
                    "Phase 1 — Find relevant documents:\n"
                    "- Call search_relevant_documents(query=\"your search query\", workspace_name=\"...\") FIRST\n"
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

            # Create agent directly using ADK Agent constructor
            if tools:
                agent = Agent(
                    name=agent_config.name,
                    model=model,
                    instruction=agent_prompt,
                    tools=tools
                )
            else:
                agent = Agent(
                    name=agent_config.name,
                    model=model,
                    instruction=agent_prompt
                )

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
