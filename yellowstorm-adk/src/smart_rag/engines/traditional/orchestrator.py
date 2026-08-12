"""Smart RAG Orchestrator Module

Main orchestrator for Smart RAG operations, managing agents, prompts, and tracing.

"""
import asyncio
import copy
import json
import logging
import uuid


from google.adk import Runner
from google.adk.agents import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.smart_rag.infrastructure.model_parameters import resolve_model_config
from src.smart_rag.engines.helpers import build_content_with_images
# Import remaining dependencies
from src.schema.chatbot_schema import ChatWithADKRequest
from src.smart_rag.agents.core.runner import AgentRunner
from src.smart_rag.agents.factories.base_factory import AgentFactory
from src.smart_rag.agents.tools.delegation_tools import DelegationTools
from src.smart_rag.engines.traditional.event_processor import EventExtractor
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
# Import modular components
from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory
from src.smart_rag.infrastructure.memory.memory_service import MemoryService
from src.smart_rag.infrastructure.monitoring.trace_recorder import langfuse_client
from src.smart_rag.infrastructure.processing.prompt_processor import PromptProcessor
from src.smart_rag.infrastructure.session.citation_manager import SessionCitationManager
from src.smart_rag.messaging.formatters import StreamingFormatter
from src.smart_rag.messaging.transformers import MessageTransformer
from src.smart_rag.tools.utilities.core_utils import build_tree, construct_json, generate_brain_tree_schema
from google.adk.sessions import DatabaseSessionService
from src.guardrails.adapters.google_adk import agent_tree_has_output_guardrail



# Disable Google ADK debug/info logs to reduce noise
logging.getLogger('google.adk').setLevel(logging.WARNING)
logging.getLogger('google.genai').setLevel(logging.WARNING)
logging.getLogger('google').setLevel(logging.WARNING)

logger = get_logger("api.smart_rag.smart_rag_helper")

app_settings = get_settings()




class SmartRAGOrchestrator:
    """Main orchestrator for Smart RAG operations."""

    def __init__(self):
        self.llm_factory = LLMFactory()
        self.prompt_processor = PromptProcessor()
        self.event_extractor = EventExtractor()
        self.message_transformer = MessageTransformer()
        self.streaming_formatter = StreamingFormatter()
        self.mcp_helper = MCPHelper()
        self.agent_factory = AgentFactory(self.prompt_processor, self.llm_factory)
        self.agent_runner = AgentRunner(
            self.event_extractor, self.message_transformer,
            self.streaming_formatter, self.prompt_processor
        )
        self.memory_service = MemoryService()

    async def chat_smart_rag(self, user_request: ChatWithADKRequest, q: asyncio.Queue[dict]) -> None:
        """Main function to handle Smart RAG chat with hierarchical Langfuse tracing.

        Args:
            user_request (ChatWithADKRequest): The user request containing chat parameters.
            q (asyncio.Queue[dict]): Queue to stream response chunks.
        Returns:
            None
        """
        try:
            logger.info(f"Starting Smart RAG chat for user {user_request.user_id}, session {user_request.session_id}")
            session_id = user_request.session_id
            user_id = user_request.user_id
            brain_ids = user_request.brain_ids
            top_k = user_request.top_k
            message = user_request.message
            image_input = user_request.image_input
            brain_documents = user_request.brain_documents
            brain_relations = user_request.brain_relations
            vectorstore_name = user_request.vectorstore_name
            instructions = user_request.instructions
            chatbot_name = user_request.chatbot_name

            chatbot_name = resolve_model_config(chatbot_name)

        except Exception as e:
            logger.error(f"Failed to extract request parameters: {str(e)}")
            return

        # Create main trace for smart_rag_conversation
        main_trace = langfuse_client.trace(
            session_id=session_id,
            id=session_id,
            name="smart_rag_conversation",
            user_id=user_id,
            input={
                "user_message": message,
                "brain_ids": brain_ids,
                "top_k": top_k,
                "vectorstore_name": vectorstore_name,
                "search_web": user_request.search_web if hasattr(user_request, 'search_web') else False
            },
            metadata={
                "session_id": session_id,
                "user_id": user_id,
                "brain_count": len(brain_ids) if brain_ids else 0,
                "document_count": len(brain_documents) if brain_documents else 0
            }
        )

        # Extract prompts
        (agent_prompt, operator_agent_prompt, report_writer_prompt, visualisation_agent_prompt,
         manager_prompt, _, _, _,_) = self.prompt_processor.extract_prompts(instructions)

        # Build trees
        try:
            documents_tree, brain_tree = build_tree(brain_documents, brain_relations)
        except Exception as e:
            logger.error(f"Failed to build trees: {str(e)}")
            documents_tree, brain_tree = None, None

        # Add tree info to manager prompt
        if documents_tree:
            original_document_tree = copy.deepcopy(documents_tree)
            schema, attribute_mapping, tree = construct_json(original_document_tree)
            manager_prompt += f"\n\n< documents_tree >\n{json.dumps(tree, indent=4)}\n< /documents_tree >"

        if brain_tree:
            brain_tree_copy = copy.deepcopy(brain_tree)
            brain_schema, brain_attribute_mapping, brain_tree = generate_brain_tree_schema(brain_tree_copy)
            manager_prompt += f"\n\n< brain_tree >\n{json.dumps(brain_tree, indent=4)}\n< /brain_tree >"

        web_search_prompt_index = 2 if user_request.search_web else 1
        manager_prompt = manager_prompt + self.prompt_processor.get_web_search_prompt(web_search_prompt_index)

        # Initialize memory service if not already done
        if not self.memory_service.memory:
            await self.memory_service.initialize()

        # Add mem0 memories to manager prompt
        memory_context = await self.memory_service.create_manager_context(message, user_id)
        if memory_context:
            manager_prompt += memory_context

        manager_span = langfuse_client.span(
            trace_id=session_id,
            name="manager_orchestration",
            input={
                "instructions": manager_prompt,
                "user_message": message
            },
            metadata={
                "orchestration_type": "smart_rag_manager"
            }
        )
        self.agent_factory.set_guardrail_config({
            "user_id": user_id,
            "agent_params": user_request.agent_params or {},
        })

        session_helper_agents = InMemorySessionService()
        # Use the global citation manager registry to get or create a cached citation manager
        from src.smart_rag.infrastructure.session.citation_manager import get_citation_manager
        citation_manager = await get_citation_manager(session_id=session_id)
        delegation_tools=DelegationTools(self.streaming_formatter, user_request, self.agent_factory, mcp_helper=self.mcp_helper, manager_span=manager_span, agent_runner=self.agent_runner, session_helper=session_helper_agents,documents_tree=documents_tree,brain_tree=brain_tree, q=q,citation_manager=citation_manager)
        delegate_to_report_writer_agent, delegate_to_operator_agent, delegate_to_html_agent, delegate_to_search_agent = delegation_tools.get_agents(visualisation_agent_prompt=visualisation_agent_prompt,operator_agent_prompt=operator_agent_prompt,report_writer_prompt=report_writer_prompt,search_agent_prompt=agent_prompt)

        manager_agent = self.agent_factory.create_manager_agent(
            manager_prompt, chatbot_name, [
                delegate_to_search_agent,
                delegate_to_operator_agent,
                delegate_to_report_writer_agent,
                delegate_to_html_agent
            ]
        )
        data_base_session = DatabaseSessionService(db_url=app_settings.DATABASE_URL)
        exsiting_session = await data_base_session.get_session(app_name=f"Smart_rag_{user_id}",
                                                               user_id=user_id, session_id=session_id)
        if not exsiting_session:
            await data_base_session.create_session(app_name=f"Smart_rag_{user_id}",
                                                   user_id=user_id,
                                                   session_id=session_id)


        message_id = str(uuid.uuid4())
        if image_input:
            content = build_content_with_images(message, image_input)
        else:
            content = types.Content(role="user", parts=[types.Part(text=message)])
        agent_runner = Runner(
            agent=manager_agent,
            app_name=f"Smart_rag_{user_id}",
            session_service=data_base_session,
        )
        # Run manager agent with tracing

        manager_generation_span = langfuse_client.span(
            trace_id=session_id,
            parent_observation_id=manager_span.id,
            name="manager_generation",
            input={
                "request": message,
            }
        )

        accumulated_manager_text = ""
        delegation_count = 0
        manager_conversation = [{"role": "user", "content": message}]
        chunk_order = 0
        guarded_output = agent_tree_has_output_guardrail(manager_agent)

        try:
            async for event in agent_runner.run_async(
                    user_id=user_id,
                    session_id=session_id,
                    new_message=content,
                    run_config=RunConfig(streaming_mode=StreamingMode.SSE,max_llm_calls=200)
            ):
                if not event.content or not event.content.parts:
                    continue

                # Skip text parts if event has multiple parts (indicates explanation + function call)
                has_multiple_parts = len(event.content.parts) > 1

                for part in event.content.parts:
                    if part.text and not event.is_final_response() and not has_multiple_parts:
                        event_text = part.text
                        accumulated_manager_text += event_text
                        if not guarded_output:
                            output = self.streaming_formatter.format_streaming_event(
                                agent_name="manager",
                                agent_type="manager",
                                chunk=event_text,
                                message_id=message_id,
                                chunk_order=chunk_order
                            )
                            chunk_order += 1
                            logger.info(f"[MANUAL MODE] Sending manager chunk to backend - agent_name: manager, chunk: {event_text}, message_id: {message_id}")
                            await q.put(output)

                    # Track function calls to agents
                    if part.function_call:
                        # Complete current generation span
                        if manager_generation_span:
                            manager_generation_span.update(output=accumulated_manager_text)
                            accumulated_manager_text = ""

                        delegation_count += 1
                        func_name = part.function_call.name

                        # Create manager function delegation span
                        function_delegation_span = langfuse_client.event(
                            name=func_name,
                            input={
                                "function_name": func_name,
                                "arguments": dict(part.function_call.args) if part.function_call.args else {},
                                "delegation_order": delegation_count
                            },
                        )

                    if part.function_response and event.author != manager_agent.name:
                        message_id = str(uuid.uuid4())

                    elif event.is_final_response() and event.content and event.content.parts:
                        if guarded_output:
                            final_text = "".join(str(getattr(item, "text", "") or "") for item in event.content.parts)
                            accumulated_manager_text = final_text
                            if final_text:
                                await q.put(self.streaming_formatter.format_streaming_event(
                                    agent_name="manager",
                                    agent_type="manager",
                                    chunk=final_text,
                                    message_id=message_id,
                                    chunk_order=chunk_order,
                                ))
                                chunk_order += 1
                        # Complete final generation span
                        if manager_generation_span:
                            manager_generation_span.update(output=accumulated_manager_text)

                        # Save manager conversation to mem0 memory
                        """if accumulated_manager_text:
                            manager_conversation.append({"role": "assistant", "content": accumulated_manager_text})
                            await self.memory_service.save_manager_conversation(
                                manager_conversation,
                                user_id
                            )"""

                        # Complete manager orchestration span

                        manager_span.update(output={
                            "final_response": "Smart RAG conversation completed",
                            "total_delegations": delegation_count,
                            "manager_text_length": len(accumulated_manager_text),
                        })

                        # Complete main trace
                        main_trace.update(output={
                            "conversation_completed": True,
                            "total_agent_delegations": delegation_count,
                            "session_id": session_id
                        })

                        output = self.streaming_formatter.format_streaming_event(
                            agent_name="manager",
                            agent_type="manager",
                            chunk="end_of_message",
                            message_id=message_id,
                            content_type="final_response"
                        )
                        logger.info(f"[MANUAL MODE] Sending final_response to backend - agent_name: manager, chunk: end_of_message, content_type: final_response, message_id: {message_id}")
                        try:
                            await q.put(output)
                        except (asyncio.CancelledError, GeneratorExit):
                            logger.info("Client disconnected during final response")
                            break

            logger.info(f"[MANUAL MODE] Sending stream end (None) to backend - session_id: {session_id}")
            await q.put(None)



        except Exception as e:
            # Handle errors in spans
            if manager_generation_span:
                manager_generation_span.update(output={"error": str(e)})
            manager_span.update(output={"error": str(e)})
            main_trace.update(output={"error": str(e)})
            logger.error(f"Error in manager execution: {str(e)}")
            raise
