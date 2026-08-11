"""gRPC service implementation for chatbot streaming."""

from __future__ import annotations

import grpc
import asyncio
import json
import uuid
import base64
import os
import mimetypes
import tempfile
import shutil
from google.protobuf import json_format, struct_pb2, timestamp_pb2

import litellm
import aiohttp
import aiofiles
from azure.storage.filedatalake.aio import DataLakeServiceClient
from typing import AsyncGenerator, Dict, Any, Optional, List

from google.protobuf.json_format import MessageToDict
from structlog import get_logger
from src.config.settings import get_settings
from src.flow_engine.generation.prompt import build_generate_playbook_prompt

from src.middleware.correlation import UserContext, user_ctx, set_user_context, get_user_label
# Import generated protobuf code (will be generated after running proto generation)
try:
    from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc
except ImportError:
    # Graceful fallback if proto hasn't been generated yet
    chatbot_pb2 = None
    chatbot_pb2_grpc = None

from src.smart_rag.core import AgentTeamService
from src.evaluation.semantic_match import evaluate_semantic_match
from src.schema.chatbot_schema import RunAgentTeamRequest, AgentSuggestion
from src.temporary_child_summary import pop_temporary_child_summary
from src.flow_engine.advisor.playbook_node_advisor import advise_playbook_node
from src.flow_engine.advisor.execution_advisor_service import evaluate_task_execution
from src.grpc_server.conversation_session_seed import (
    ConversationSessionSeedService,
    SessionSeedConflictError,
)

logger = get_logger(__name__)
app_settings = get_settings()

_MESSAGE_TO_DICT_OPTIONS: Dict[str, Any] = {
    "preserving_proto_field_name": True,
    "always_print_fields_with_no_presence": True,
}


def _message_to_dict(message: Any) -> Dict[str, Any]:
    return MessageToDict(message, **_MESSAGE_TO_DICT_OPTIONS)


def _json_log_payload(payload: Dict[str, Any]) -> str:
    """Serialize a protobuf-derived payload as copyable, valid JSON."""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _grpc_in_log_message(label: str, payload: Dict[str, Any]) -> str:
    """Put raw JSON in the message so it can be copied directly from console logs."""
    return f"[gRPC IN] {label} request_json={_json_log_payload(payload)}"


def _grpc_skill_summaries(skills: Any) -> List[Dict[str, Any]]:
    summaries = []
    for skill in skills or []:
        summaries.append(
            {
                "id": getattr(skill, "id", ""),
                "name": getattr(skill, "name", ""),
                "has_description": bool(getattr(skill, "description", "")),
                "has_instructions": bool(getattr(skill, "instructions", "")),
                "allowed_tool_count": len(getattr(skill, "allowed_tools", []) or []),
                "file_count": len(getattr(skill, "files", []) or []),
            }
        )
    return summaries


def _convert_file_chunk_to_artifact(chunk_dict: Dict[str, Any]) -> Dict[str, Any]:
    file_data = json.loads(chunk_dict.get("chunk", "{}"))
    return {
        "action": "add",
        "component": {
            "id": str(uuid.uuid4()),
            "type": "artifact",
            "data": {
                "filename": file_data.get("filename", ""),
                "file_path": file_data.get("object_key")
                or file_data.get("azure_path")
                or file_data.get("file_path")
                or "",
            },
        },
        "metadata": {
            "message_id": chunk_dict.get("message_id", ""),
            "agent_id": chunk_dict.get("agent_id", ""),
        },
    }


class ChatbotServicer(
    chatbot_pb2_grpc.ChatbotServiceServicer if chatbot_pb2_grpc else object
):
    """gRPC service implementation for V2 chatbot streaming.

    This servicer handles gRPC requests for V2 RunAgentTeam endpoint and streams
    responses using the same business logic as the REST/SSE endpoints.
    """

    def __init__(self, agent_team_service: AgentTeamService):
        """Initialize the gRPC servicer with agent team service.

        Args:
            agent_team_service: Service for multi-agent team orchestration
        """
        self.agent_team_service = agent_team_service
        self.conversation_session_seed = ConversationSessionSeedService()
        self._background_tasks: set[asyncio.Task] = set()
        logger.info("[gRPC] ChatbotServicer initialized (V2 only)")

    async def SeedConversationSession(self, request, context):
        role_names = {
            chatbot_pb2.CONVERSATION_HISTORY_ROLE_USER: "user",
            chatbot_pb2.CONVERSATION_HISTORY_ROLE_ASSISTANT: "assistant",
        }
        try:
            history = []
            for entry in request.history:
                role = role_names.get(entry.role)
                if not role:
                    await context.abort(
                        grpc.StatusCode.INVALID_ARGUMENT,
                        "Conversation history contains an invalid role",
                    )
                history.append((role, entry.text))

            created = await self.conversation_session_seed.seed(
                user_id=request.user_id,
                session_id=request.session_id,
                idempotency_key=request.idempotency_key,
                history=history,
            )
            return chatbot_pb2.SeedConversationSessionResponse(
                session_id=request.session_id,
                created=created,
            )
        except ValueError as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except SessionSeedConflictError as exc:
            await context.abort(grpc.StatusCode.ALREADY_EXISTS, str(exc))
        except Exception:
            logger.exception(
                "[gRPC] Failed to seed conversation session",
                session_id=request.session_id,
            )
            await context.abort(
                grpc.StatusCode.INTERNAL,
                "Failed to seed conversation session",
            )

    async def DeleteConversationSession(self, request, context):
        try:
            deleted = await self.conversation_session_seed.delete(
                user_id=request.user_id,
                session_id=request.session_id,
                idempotency_key=request.idempotency_key,
            )
            return chatbot_pb2.DeleteConversationSessionResponse(deleted=deleted)
        except SessionSeedConflictError as exc:
            await context.abort(grpc.StatusCode.ALREADY_EXISTS, str(exc))
        except Exception:
            logger.exception(
                "[gRPC] Failed to delete conversation session",
                session_id=request.session_id,
            )
            await context.abort(
                grpc.StatusCode.INTERNAL,
                "Failed to delete conversation session",
            )

    async def AdvisePlaybookNode(
        self,
        request: "chatbot_pb2.AdvisePlaybookNodeRequest",
        context: grpc.aio.ServicerContext,
    ) -> "chatbot_pb2.AdvisePlaybookNodeResponse":
        payload = _message_to_dict(request)
        result = advise_playbook_node(payload)

        suggestions = []
        for item in result.get("suggestions", []):
            patch = item.get("patch") or {}
            suggestions.append(
                chatbot_pb2.NodeAdvisorSuggestion(
                    id=str(item.get("id") or ""),
                    type=self._node_advisor_type_to_enum(item.get("type")),
                    title=str(item.get("title") or ""),
                    summary=str(item.get("summary") or ""),
                    rationale=str(item.get("rationale") or ""),
                    confidence=float(item.get("confidence") or 0),
                    patch=chatbot_pb2.NodeAdvisorPatch(
                        task_title=str(patch.get("task_title") or ""),
                        task_description=str(patch.get("task_description") or ""),
                        assigned_agent_id=str(patch.get("assigned_agent_id") or ""),
                        input_ports=[
                            chatbot_pb2.NodeAdvisorPortSuggestion(
                                id=str(port.get("id") or ""),
                                name=str(port.get("name") or ""),
                                artifact_kind=str(port.get("artifact_kind") or ""),
                                description=str(port.get("description") or ""),
                            )
                            for port in patch.get("input_ports", [])
                        ],
                        output_ports=[
                            chatbot_pb2.NodeAdvisorPortSuggestion(
                                id=str(port.get("id") or ""),
                                name=str(port.get("name") or ""),
                                artifact_kind=str(port.get("artifact_kind") or ""),
                                description=str(port.get("description") or ""),
                            )
                            for port in patch.get("output_ports", [])
                        ],
                        datasource_suggestions=[
                            chatbot_pb2.NodeAdvisorDatasourceSuggestion(
                                source_task_id=str(ds.get("source_task_id") or ""),
                                source_output_port_id=str(ds.get("source_output_port_id") or ""),
                                target_input_port_id=str(ds.get("target_input_port_id") or ""),
                                datasource_type=str(ds.get("datasource_type") or ""),
                                datasource_id=str(ds.get("datasource_id") or ""),
                                datasource_name=str(ds.get("datasource_name") or ""),
                                rationale=str(ds.get("rationale") or ""),
                            )
                            for ds in patch.get("datasource_suggestions", [])
                        ],
                    ),
                    warnings=[str(warning) for warning in item.get("warnings", [])],
                )
            )

        return chatbot_pb2.AdvisePlaybookNodeResponse(
            playbook_id=str(result.get("playbook_id") or request.playbook_id),
            task_id=str(result.get("task_id") or request.task_id),
            suggestions=suggestions,
        )

    async def EvaluateTask(
        self,
        request: "chatbot_pb2.TaskAdvisorRequest",
        context: grpc.aio.ServicerContext,
    ) -> "chatbot_pb2.TaskAdvisorResult":
        payload = _message_to_dict(request)
        result = evaluate_task_execution(payload)
        token_reduction = result.get("estimated_token_reduction_pct")
        latency_reduction = result.get("estimated_latency_reduction_pct")
        cost_efficiency_score = result.get("cost_efficiency_score")

        return chatbot_pb2.TaskAdvisorResult(
            accuracy_score=int(result.get("accuracy_score", 0) or 0),
            completeness_score=int(result.get("completeness_score", 0) or 0),
            result_matching_score=int(result.get("result_matching_score", 0) or 0),
            overall_score=int(result.get("overall_score", 0) or 0),
            confidence=float(result.get("confidence", 0) or 0),
            tool_usage_score=int(result.get("tool_usage_score", 0) or 0),
            relevance_score=int(result.get("relevance_score", 0) or 0),
            specificity_score=int(result.get("specificity_score", 0) or 0),
            format_compliance_score=int(result.get("format_compliance_score", 0) or 0),
            evidence_grounding_score=int(result.get("evidence_grounding_score", 0) or 0),
            handoff_readiness_score=int(result.get("handoff_readiness_score", 0) or 0),
            hitl_appropriateness_score=int(result.get("hitl_appropriateness_score", 0) or 0),
            determinism_score=int(result.get("determinism_score", 0) or 0),
            step_optimization_priority=int(result.get("step_optimization_priority", 0) or 0),
            playbook_optimization_priority=int(result.get("playbook_optimization_priority", 0) or 0),
            risk_severity=str(result.get("risk_severity", "low") or "low"),
            blocking_issue_count=int(result.get("blocking_issue_count", 0) or 0),
            downstream_impact_level=str(result.get("downstream_impact_level", "none") or "none"),
            recommended_action=str(result.get("recommended_action", "review_only") or "review_only"),
            cost_efficiency_score=int(round(cost_efficiency_score)) if isinstance(cost_efficiency_score, (int, float)) else 50,
            cost_optimization_priority=int(result.get("cost_optimization_priority", 0) or 0),
            estimated_token_reduction_pct=int(round(token_reduction)) if isinstance(token_reduction, (int, float)) else -1,
            estimated_latency_reduction_pct=int(round(latency_reduction)) if isinstance(latency_reduction, (int, float)) else -1,
            expected_result_source=str(result.get("expected_result_source", "none") or "none"),
            expected_result_type=str(result.get("expected_result_type", "none") or "none"),
            expected_result_matched=bool(result.get("expected_result_matched", False)),
            expected_result_reason=str(result.get("expected_result_reason", "") or ""),
            missing_facts=[str(item) for item in result.get("missing_facts", [])],
            incoherences=[str(item) for item in result.get("incoherences", [])],
            unsupported_claims=[str(item) for item in result.get("unsupported_claims", [])],
            handoff_risks=[str(item) for item in result.get("handoff_risks", [])],
            rewrite_hints=[str(item) for item in result.get("rewrite_hints", [])],
            tool_selection_issues=[str(item) for item in result.get("tool_selection_issues", [])],
            missing_tool_calls=[str(item) for item in result.get("missing_tool_calls", [])],
            redundant_tool_calls=[str(item) for item in result.get("redundant_tool_calls", [])],
            tool_output_use_issues=[str(item) for item in result.get("tool_output_use_issues", [])],
            tool_sequencing_issues=[str(item) for item in result.get("tool_sequencing_issues", [])],
            tool_usage_strengths=[str(item) for item in result.get("tool_usage_strengths", [])],
            tool_usage_recommendation=str(result.get("tool_usage_recommendation", "") or ""),
            cost_optimization_hints=[str(item) for item in result.get("cost_optimization_hints", [])],
            script_replacement_hints=[str(item) for item in result.get("script_replacement_hints", [])],
            llm_still_required_reasons=[str(item) for item in result.get("llm_still_required_reasons", [])],
            safe_auto_fix_type=str(result.get("safe_auto_fix_type", "none") or "none"),
            recommendation=str(result.get("recommendation", "none") or "none"),
            reason=str(result.get("reason", "") or ""),
            model=str(result.get("model", "deterministic-execution-advisor") or "deterministic-execution-advisor"),
        )

    @staticmethod
    def _node_advisor_type_to_enum(value: str) -> int:
        mapping = {
            "task_title": chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_TASK_TITLE,
            "task_description": chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_TASK_DESCRIPTION,
            "agent_selection": chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_AGENT_SELECTION,
            "datasource_connection": chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_DATASOURCE_CONNECTION,
            "input_contract": chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_INPUT_CONTRACT,
            "output_contract": chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_OUTPUT_CONTRACT,
            "general": chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_GENERAL,
        }
        return mapping.get(str(value or ""), chatbot_pb2.NODE_ADVISOR_SUGGESTION_TYPE_GENERAL)

    @staticmethod
    def _serialize_run_agent_team_request(
        request: "chatbot_pb2.RunAgentTeamRequest",
    ) -> Dict[str, Any]:
        """Convert RunAgentTeam protobuf request to a JSON-safe dict for logging."""
        payload = _message_to_dict(request)
        replay_context = payload.get("correction_replay_context")
        if isinstance(replay_context, dict):
            payload["correction_replay_context"] = {
                "present": True,
                "attempt_number": replay_context.get("attempt_number", 0),
                "finding_count": len(replay_context.get("findings", [])),
            }
        return payload

    @staticmethod
    def _log_temporary_child_summary(session_id: str, label: str) -> None:
        summary = pop_temporary_child_summary(session_id)
        if not summary["created_count"]:
            return
        logger.info(
            "[TEMP CHILD] Summary before stream completion",
            label=label,
            session_id=session_id,
            created_count=summary["created_count"],
            execution_modes=summary["execution_modes"],
            children=summary["children"],
        )

    async def RunAgentTeam(
        self,
        request: "chatbot_pb2.RunAgentTeamRequest",
        context: grpc.aio.ServicerContext,
    ) -> AsyncGenerator["chatbot_pb2.StreamChunk", None]:
        """
        Server streaming RPC for multi-agent team orchestration.

        V2 Schema with simplified request:
        - Added username field
        - conversation_id instead of session_id
        - workspace_context instead of brain fields
        - Chatbot  has single model field (full LiteLLM identifier)
        - Removed available_agents, available_tools, brain_relations, search_web

        Args:
            request: Protobuf request with user message and agent config
            context: gRPC context for the request

        Yields:
            StreamChunk: Protobuf messages containing text chunks and metadata
        """
        request_payload = self._serialize_run_agent_team_request(request)
        logger.info(
            _grpc_in_log_message("RunAgentTeam request received", request_payload),
            user_id=request.user_context.user_id,
            username=request.user_context.username,
            conversation_id=request.conversation_id,
            agent_mode=request.agent_mode,
            query_length=len(request.query or ""),
            agent_count=len(request.agents),
            workspace_count=len(request.workspace_context),
            attached_file_count=len(request.attached_files),
            previous_attached_file_count=len(request.previous_attached_files),
        )

        logger.info(f"[gRPC] RunAgentTeam request from user_id: {request.user_context.user_id}, username: {request.user_context.username}, conversation_id: {request.conversation_id}, agent_mode: {request.agent_mode}")
        username = request.user_context.username or 'unknown'
        user_token = set_user_context(request.user_context.user_id, username)
        # Create asyncio queue
        queue: asyncio.Queue[dict] = asyncio.Queue()
        bg_task: Optional[asyncio.Task] = None
        get_task: Optional[asyncio.Task] = None

        try:
            # Convert protobuf request to internal V1 Pydantic model (for backward compatibility)
            internal_request = await self._convert_agent_team_request_v2(request)

            if internal_request.correction_replay_context:
                yield chatbot_pb2.StreamChunk(
                    action="replay_started",
                    metadata=chatbot_pb2.Metadata(message_id=request.conversation_id),
                )

            if internal_request.attached_files:
                index_task = asyncio.create_task(
                    self._index_attached_documents(
                        internal_request.attached_files,
                        request.conversation_id,
                    )
                )
                self._background_tasks.add(index_task)
                index_task.add_done_callback(self._background_tasks.discard)

            # Start background processing task
            bg_task = asyncio.create_task(
                self.agent_team_service.process_team_request(internal_request, queue)
            )

            # Stream chunks from queue
            while True:
                get_task = asyncio.create_task(queue.get())
                done, pending = await asyncio.wait(
                    [get_task, bg_task], return_when=asyncio.FIRST_COMPLETED
                )

                # Check if background task finished first
                if bg_task in done:
                    # Check for exception
                    exception = bg_task.exception()
                    if exception:
                        logger.error(
                            f"[gRPC] Background task crashed - conversation_id: {request.conversation_id}, "
                            f"error: {str(exception)}"
                        )
                        get_task.cancel()  # Cancel the pending queue.get()

                        # Send error component instead of aborting stream
                        error_component = {
                            "action": "add",
                            "component": {
                                "id": str(uuid.uuid4()),
                                "type": "error",
                                "data": {
                                    "title": "Exception",
                                    "content": "The model couldn't finish your answer due to an unexpected error.",
                                },
                            },
                            "metadata": {"message_id": request.conversation_id},
                        }

                        # Convert error component to protobuf and yield it
                        error_chunk_pb = self._dict_to_stream_chunk(error_component)
                        yield error_chunk_pb

                        logger.info(
                            f"[gRPC] Sent error component for exception - conversation_id: {request.conversation_id}"
                        )

                        # End stream gracefully
                        return
                    else:
                        # Background task completed successfully but queue still has items
                        # Let the get_task continue to drain remaining items
                        logger.debug(
                            f"[gRPC] Background task completed, draining remaining queue items"
                        )

                # Get the chunk from the completed get_task
                chunk_dict = await get_task
                get_task = None

                if chunk_dict is None:  # End of stream
                    logger.info(
                        f"[gRPC] Stream ending naturally - conversation_id: {request.conversation_id}, "
                        f"user_id: {request.user_context.user_id}"
                    )
                    # Wait for background task to complete
                    await bg_task
                    break

                # Convert old File chunks to artifact components
                if chunk_dict.get("content_type") == "File":
                    try:
                        chunk_dict = _convert_file_chunk_to_artifact(chunk_dict)
                        logger.info(
                            "[gRPC] Converted old File chunk to artifact component"
                        )
                    except Exception as e:
                        logger.error(
                            f"[gRPC] Failed to convert File chunk to artifact: {e}"
                        )

                # Convert dict to protobuf
                chunk_pb = self._dict_to_stream_chunk(chunk_dict)

                logger.debug(
                    "[gRPC OUT] Yielding stream chunk",
                    conversation_id=request.conversation_id,
                    action=chunk_dict.get("action"),
                    component_type=chunk_dict.get("component", {}).get("type"),
                    message_id=chunk_dict.get("metadata", {}).get("message_id"),
                    agent_id=chunk_dict.get("metadata", {}).get("agent_id"),
                )

                # Yield protobuf message
                yield chunk_pb

            # Explicitly return after breaking to ensure stream ends
            self._log_temporary_child_summary(
                request.conversation_id,
                "RunAgentTeam",
            )
            logger.info(
                f"[gRPC] RunAgentTeam stream completed successfully - "
                f"conversation_id: {request.conversation_id}, user_id: {request.user_context.user_id}"
            )
            return

        except (asyncio.CancelledError, GeneratorExit):
            # Client cancelled the stream (e.g., call.cancel() was called, or client disconnected)
            logger.info(
                f"[gRPC] Client cancelled stream - conversation_id: {request.conversation_id}, "
                f"user_id: {request.user_context.user_id}"
            )

            if get_task is not None and not get_task.done():
                get_task.cancel()
                try:
                    await get_task
                except asyncio.CancelledError:
                    logger.debug("[gRPC] Queue get task cancelled successfully")
                    current = asyncio.current_task()
                    if current is not None and current.cancelling() > 0:
                        raise
                except Exception as cleanup_error:
                    logger.warning(
                        f"[gRPC] Error during queue get task cleanup: {cleanup_error}"
                    )

            # Cancel the background task gracefully
            if bg_task is not None and not bg_task.done():
                bg_task.cancel()
                try:
                    await bg_task
                except asyncio.CancelledError:
                    logger.debug("[gRPC] Background task cancelled successfully")
                    current = asyncio.current_task()
                    if current is not None and current.cancelling() > 0:
                        raise
                except Exception as cleanup_error:
                    logger.warning(
                        f"[gRPC] Error during background task cleanup: {cleanup_error}"
                    )

            # Drain the queue to prevent memory leaks
            drained = 0
            try:
                while not queue.empty():
                    queue.get_nowait()
                    drained += 1
            except Exception as queue_error:
                logger.debug(
                    f"[gRPC] Queue cleanup completed, drained {drained} items: {queue_error}"
                )

            logger.info(
                f"[gRPC] Stream cancellation cleanup complete - drained {drained} queued chunks"
            )

            # Return normally - gRPC will handle setting CANCELLED status
            return

        except Exception as e:
            logger.error(f"[gRPC] Error in RunAgentTeam: {str(e)}", exc_info=True)

            # Send error component to client instead of aborting stream
            error_component = {
                "action": "add",
                "component": {
                    "id": str(uuid.uuid4()),
                    "type": "error",
                    "data": {
                        "title": "Validation Error"
                        if isinstance(e, ValueError)
                        else "Error",
                        "content": str(e),
                    },
                },
                "metadata": {"message_id": request.conversation_id},
            }

            # Convert error component to protobuf and yield it
            error_chunk_pb = self._dict_to_stream_chunk(error_component)
            yield error_chunk_pb

            logger.info(
                f"[gRPC] Sent error component for validation error - conversation_id: {request.conversation_id}"
            )

            # End stream gracefully
            return
        finally:
            # Clear user context after processing
            try:
                user_ctx.reset(user_token)
            except Exception:
                pass  # Token may already be reset or invalid
    async def RunSingleAgent(
        self,
        request: "chatbot_pb2.RunSingleAgentRequest",
        context: grpc.aio.ServicerContext,
    ) -> AsyncGenerator["chatbot_pb2.StreamChunk", None]:
        """Server streaming RPC for a single agent (no manager / no delegation).

        Runs exactly one specialized agent that owns its real tools directly.
        Shares the same internal service/orchestrator stack as RunAgentTeam by
        converting to an internal RunAgentTeamRequest with ``agent_mode='mono'``.
        """
        request_payload = _message_to_dict(request)
        replay_context = request_payload.get("correction_replay_context")
        if isinstance(replay_context, dict):
            request_payload["correction_replay_context"] = {
                "present": True,
                "attempt_number": replay_context.get("attempt_number", 0),
                "finding_count": len(replay_context.get("findings", [])),
            }
        logger.info(
            _grpc_in_log_message("RunSingleAgent request received", request_payload),
            user_id=request.user_context.user_id,
            username=request.user_context.username,
            conversation_id=request.conversation_id,
            query_length=len(request.query or ""),
            agent_name=request.agent.name,
            workspace_count=len(request.workspace_context),
            attached_file_count=len(request.attached_files),
            previous_attached_file_count=len(request.previous_attached_files),
        )

        username = request.user_context.username or "unknown"
        user_token = set_user_context(request.user_context.user_id, username)
        queue: asyncio.Queue[dict] = asyncio.Queue()
        bg_task: Optional[asyncio.Task] = None
        get_task: Optional[asyncio.Task] = None

        try:
            internal_request = await self._convert_single_agent_request(request)

            if internal_request.correction_replay_context:
                yield chatbot_pb2.StreamChunk(
                    action="replay_started",
                    metadata=chatbot_pb2.Metadata(message_id=request.conversation_id),
                )

            if internal_request.attached_files:
                index_task = asyncio.create_task(
                    self._index_attached_documents(
                        internal_request.attached_files,
                        request.conversation_id,
                    )
                )
                self._background_tasks.add(index_task)
                index_task.add_done_callback(self._background_tasks.discard)

            bg_task = asyncio.create_task(
                self.agent_team_service.process_team_request(internal_request, queue)
            )

            while True:
                get_task = asyncio.create_task(queue.get())
                done, pending = await asyncio.wait(
                    [get_task, bg_task], return_when=asyncio.FIRST_COMPLETED
                )

                if bg_task in done:
                    exception = bg_task.exception()
                    if exception:
                        logger.error(
                            f"[gRPC] Background task crashed - conversation_id: {request.conversation_id}, "
                            f"error: {str(exception)}"
                        )
                        get_task.cancel()
                        error_component = {
                            "action": "add",
                            "component": {
                                "id": str(uuid.uuid4()),
                                "type": "error",
                                "data": {
                                    "title": "Exception",
                                    "content": "The model couldn't finish your answer due to an unexpected error.",
                                },
                            },
                            "metadata": {"message_id": request.conversation_id},
                        }
                        yield self._dict_to_stream_chunk(error_component)
                        return

                chunk_dict = await get_task
                get_task = None

                if chunk_dict is None:
                    logger.info(
                        f"[gRPC] RunSingleAgent stream ending naturally - conversation_id: {request.conversation_id}"
                    )
                    await bg_task
                    break

                if chunk_dict.get("content_type") == "File":
                    try:
                        chunk_dict = _convert_file_chunk_to_artifact(chunk_dict)
                    except Exception as e:
                        logger.error(
                            f"[gRPC] Failed to convert File chunk to artifact: {e}"
                        )

                yield self._dict_to_stream_chunk(chunk_dict)

            self._log_temporary_child_summary(
                request.conversation_id,
                "RunSingleAgent",
            )
            logger.info(
                f"[gRPC] RunSingleAgent stream completed successfully - "
                f"conversation_id: {request.conversation_id}, user_id: {request.user_context.user_id}"
            )
            return

        except (asyncio.CancelledError, GeneratorExit):
            logger.info(
                f"[gRPC] Client cancelled single-agent stream - conversation_id: {request.conversation_id}"
            )
            if get_task is not None and not get_task.done():
                get_task.cancel()
                try:
                    await get_task
                except asyncio.CancelledError:
                    current = asyncio.current_task()
                    if current is not None and current.cancelling() > 0:
                        raise
                except Exception as cleanup_error:
                    logger.warning(f"[gRPC] Error during queue get task cleanup: {cleanup_error}")
            if bg_task is not None and not bg_task.done():
                bg_task.cancel()
                try:
                    await bg_task
                except asyncio.CancelledError:
                    current = asyncio.current_task()
                    if current is not None and current.cancelling() > 0:
                        raise
                except Exception as cleanup_error:
                    logger.warning(f"[gRPC] Error during background task cleanup: {cleanup_error}")
            return

        except Exception as e:
            logger.error(f"[gRPC] Error in RunSingleAgent: {str(e)}", exc_info=True)
            error_component = {
                "action": "add",
                "component": {
                    "id": str(uuid.uuid4()),
                    "type": "error",
                    "data": {
                        "title": "Validation Error" if isinstance(e, ValueError) else "Error",
                        "content": str(e),
                    },
                },
                "metadata": {"message_id": request.conversation_id},
            }
            yield self._dict_to_stream_chunk(error_component)
            return
        finally:
            try:
                user_ctx.reset(user_token)
            except Exception:
                pass

    # ========== CONVERSION HELPERS ==========

    def _convert_agent(self, pb_agent: "chatbot_pb2.Agent") -> AgentSuggestion:
        """Convert protobuf Agent (V2) to internal V1 AgentSuggestion Pydantic model.

        V2 changes:
        - Renamed AgentSuggestion → Agent
        - Removed html field
        - Removed vectorstore_name field
        - brain_context is now repeated WorkspaceContext (extract all workspace_names and documents)
        - Removed brain_relations field
        - chatbot_name renamed to chatbot (with single model field containing full identifier)

        Args:
            pb_agent: Protobuf V2 Agent message

        Returns:
            AgentSuggestion: Internal V1 Pydantic model (for backward compatibility)
        """
        skill_summaries = _grpc_skill_summaries(getattr(pb_agent, "skills", []))
        logger.info(
            "gRPC agent skills received",
            agent_id=pb_agent.id if pb_agent.id else "no_id",
            agent_name=pb_agent.name,
            skill_count=len(skill_summaries),
            skills=skill_summaries,
        )

        # Extract workspace_names and brain_documents from repeated WorkspaceContext
        workspace_names = []
        workspace_ids = []
        brain_documents = []
        if pb_agent.brain_context:
            for workspace in pb_agent.brain_context:
                workspace_id = getattr(workspace, "workspace_id", "") or ""
                if workspace_id:
                    workspace_ids.append(workspace_id)
                workspace_name = (
                    getattr(workspace, "workspace_name", "") or workspace_id
                )
                if workspace_name:
                    workspace_names.append(workspace_name)
                for doc in workspace.workspace_documents:
                    doc_file_name = getattr(doc, "file_name", "") or doc.filename or ""
                    doc_workspace_name = (
                        getattr(doc, "workspace_name", "")
                        or workspace_name
                        or doc.workspace_id
                        or ""
                    )
                    brain_documents.append(
                        {
                            "_id": doc._id,
                            "filename": doc.filename if doc.filename else "",
                            "file_name": doc_file_name,
                            "filepath": doc.filepath if doc.filepath else "",
                            "in_memory": doc.in_memory if doc.in_memory else False,
                            "language": doc.language if doc.language else "",
                            "indexing_token": doc.indexing_token
                            if doc.indexing_token
                            else 0,
                            "workspace_id": doc.workspace_id
                            if doc.workspace_id
                            else "",
                            "workspace_name": doc_workspace_name,
                        }
                    )

        raw_agent_params = (
            dict(pb_agent.agent_params.params) if pb_agent.HasField("agent_params") else {}
        )
        has_connector_bindings = bool(raw_agent_params.get("connector_bindings_json"))
        enable_temporary_child_agents = raw_agent_params.get(
            "enable_temporary_child_agents"
        )
        temporary_child_agents_enabled = (
            str(enable_temporary_child_agents or "false").lower() == "true"
        )
        logger.info(
            "[gRPC IN] Agent params received agent_id=%s agent_name=%s "
            "has_connector_bindings_json=%s enable_temporary_child_agents=%s "
            "max_temporary_child_agents=%s enabled=%s agent_param_keys=%s",
            pb_agent.id if pb_agent.id else "no_id",
            pb_agent.name,
            has_connector_bindings,
            enable_temporary_child_agents,
            raw_agent_params.get("max_temporary_child_agents"),
            temporary_child_agents_enabled,
            sorted(raw_agent_params.keys()),
        )
        logger.info(
            "[TEMP CHILD] gRPC config agent=%s enabled=%s max_temporary_child_agents=%s",
            pb_agent.id if pb_agent.id else "no_id",
            temporary_child_agents_enabled,
            raw_agent_params.get("max_temporary_child_agents"),
        )
        return AgentSuggestion(
            id=pb_agent.id if pb_agent.id else "no_id",
            name=pb_agent.name,
            description=pb_agent.description,
            prompt=pb_agent.prompt,
            tools=[
                {
                    "name": tool.name,
                    "prompt": tool.prompt,
                    "description": tool.description,
                    "top_k": tool.top_k,
                }
                for tool in pb_agent.tools
            ]
            if pb_agent.tools
            else None,
            skills=[
                {
                    "id": skill.id,
                    "name": skill.name,
                    "description": skill.description,
                    "instructions": skill.instructions,
                    "license": skill.license,
                    "compatibility": skill.compatibility,
                    "metadata": dict(skill.metadata) if skill.metadata else {},
                    "allowed_tools": list(skill.allowed_tools)
                    if skill.allowed_tools
                    else [],
                    "files": [
                        {
                            "path": file.path,
                            "kind": file.kind,
                            "mime_type": file.mime_type,
                            "content": file.content,
                        }
                        for file in skill.files
                    ]
                    if skill.files
                    else [],
                }
                for skill in pb_agent.skills
            ]
            if pb_agent.skills
            else None,
            html=False,
            vectorstore_name=app_settings.QDRANT_COLLECTION_NAME,
            workspace_names=workspace_names,
            brain_ids=workspace_ids or workspace_names,
            brain_documents=brain_documents,
            brain_relations={"nodes": [], "relationships": []},
            chatbot_name={
                "provider": pb_agent.chatbot.model,
                "input_modalities": list(pb_agent.chatbot.input_modalities) or ["text"],
            }
            if pb_agent.HasField("chatbot")
            else None,
            agent_params=raw_agent_params if raw_agent_params else None,
            agent_type=pb_agent.agent_type if pb_agent.agent_type else None,
            save_memory=pb_agent.save_memory,
            mcp=None,
        )

    async def _build_brain_and_file_context(self, pb_request: Any) -> Dict[str, Any]:
        """Build workspace/document/attachment context shared by V2 converters.

        Both RunAgentTeamRequest and RunSingleAgentRequest expose the same
        ``workspace_context``, ``attached_files`` and ``previous_attached_files``
        fields, so this single helper feeds both the multi-agent and mono-agent
        conversion paths. Returns image inputs, attached/previous documents, and
        the merged ``brain_documents`` / ``workspace_names`` / ``workspace_ids``.
        """
        # Extract workspace names and documents from multiple workspace contexts
        workspace_names = []
        workspace_ids = []
        brain_documents = []

        for workspace_ctx in pb_request.workspace_context:
            workspace_id = getattr(workspace_ctx, "workspace_id", "") or ""
            if workspace_id:
                workspace_ids.append(workspace_id)
            workspace_name = (
                getattr(workspace_ctx, "workspace_name", "")
                or workspace_id
            )
            if workspace_name:
                workspace_names.append(workspace_name)

            for doc in workspace_ctx.workspace_documents:
                doc_file_name = getattr(doc, "file_name", "") or doc.filename or ""
                doc_workspace_name = (
                    getattr(doc, "workspace_name", "")
                    or workspace_name
                    or doc.workspace_id
                    or ""
                )
                brain_documents.append(
                    {
                        "_id": doc._id,
                        "filename": doc.filename if doc.filename else "",
                        "file_name": doc_file_name,
                        "filepath": doc.filepath if doc.filepath else "",
                        "in_memory": doc.in_memory if doc.in_memory else False,
                        "language": doc.language if doc.language else "",
                        "indexing_token": doc.indexing_token if doc.indexing_token else 0,
                        "workspace_id": doc.workspace_id if doc.workspace_id else "",
                        "workspace_name": doc_workspace_name,
                    }
                )

        workspace_names = workspace_names if workspace_names else None
        brain_documents = brain_documents if brain_documents else None

        # ── Process attached_files: separate images from documents ──
        image_filepaths = []
        attached_documents = []

        for file in pb_request.attached_files:
            data_type = file.WhichOneof("data")
            if data_type == "image":
                image_filepaths.append(file.image.filepath)
            elif data_type == "document":
                doc = file.document
                attached_documents.append(
                    {
                        "filepath": doc.filepath,
                        "filename": doc.filename,
                        "workspace_name": doc.workspace_name,
                        "workspace_id": doc.workspace_id,
                        "source": doc.source or doc.filepath,
                        "createdAt": getattr(doc, "createdAt", None) or None,
                        "brain_type": doc.brain_type,
                        "lang_code": doc.lang_code,
                        "chunk_size": doc.chunk_size if doc.chunk_size else 4000,
                        "chunk_overlap": doc.chunk_overlap if doc.chunk_overlap else 100,
                        "enable_smart_chunk": doc.enable_smart_chunk,
                        "enable_extract_images": doc.enable_extract_images,
                        "sheet_name": doc.sheet_name if doc.sheet_name else None,
                        "in_memory": doc.in_memory,
                    }
                )

        image_input = (
            await self._download_and_encode_images(image_filepaths)
            if image_filepaths
            else []
        )

        attached_images_metadata = []
        for filepath in image_filepaths:
            filename = filepath.rsplit("/", 1)[-1] if "/" in filepath else filepath
            attached_images_metadata.append({"filename": filename})

        logger.info(
            f"[gRPC] Processed attached_files: {len(image_input)} images, "
            f"{len(attached_documents)} documents"
        )

        # ── Process previous_attached_files (repeated Document) ──
        previous_attached = []
        for prev_doc in pb_request.previous_attached_files:
            prev_file_name = (
                getattr(prev_doc, "file_name", "") or prev_doc.filename or ""
            )
            prev_workspace_name = (
                getattr(prev_doc, "workspace_name", "") or prev_doc.workspace_id
            )
            previous_attached.append(
                {
                    "_id": prev_doc._id,
                    "filename": prev_doc.filename,
                    "file_name": prev_file_name,
                    "filepath": prev_doc.filepath,
                    "in_memory": prev_doc.in_memory,
                    "language": prev_doc.language if prev_doc.language else None,
                    "workspace_id": prev_doc.workspace_id,
                    "workspace_name": prev_workspace_name,
                    "createdAt": getattr(prev_doc, "createdAt", None) or None,
                }
            )

        if previous_attached:
            logger.info(
                f"[gRPC] {len(previous_attached)} previous attached files for context"
            )

        # ── Merge attached + previous attached into brain_documents for document tree ──
        if brain_documents is None:
            brain_documents = []
        existing_ids = {doc.get("_id") for doc in brain_documents if doc.get("_id")}

        for doc in attached_documents:
            doc_name = doc.get("workspace_name")
            if doc_name and doc_name not in existing_ids:
                brain_documents.append(
                    {
                        "_id": doc_name,
                        "filename": doc.get("filename", ""),
                        "file_name": doc.get("filename", ""),
                        "filepath": doc.get("filepath", ""),
                        "in_memory": doc.get("in_memory", False),
                        "language": doc.get("lang_code", ""),
                        "workspace_id": doc.get("workspace_id", ""),
                        "workspace_name": doc.get("workspace_name", ""),
                    }
                )
                existing_ids.add(doc_name)

        for doc in previous_attached:
            doc_id = doc.get("_id")
            if doc_id and doc_id not in existing_ids:
                brain_documents.append(doc)
                existing_ids.add(doc_id)

        brain_documents = brain_documents if brain_documents else None

        # Documents are indexed with workspace_name, so the search filter must
        # include these names or Qdrant won't find them.
        if workspace_names is None:
            workspace_names = []

        for doc in attached_documents:
            workspace_name = doc.get("workspace_name")
            if workspace_name and workspace_name not in workspace_names:
                workspace_names.append(workspace_name)

        for doc in previous_attached:
            workspace_name = doc.get("workspace_name") or doc.get("workspace_id")
            if workspace_name and workspace_name not in workspace_names:
                workspace_names.append(workspace_name)

        workspace_names = workspace_names if workspace_names else None
        workspace_ids = workspace_ids if workspace_ids else workspace_names

        return {
            "image_input": image_input,
            "attached_documents": attached_documents,
            "attached_images_metadata": attached_images_metadata,
            "previous_attached": previous_attached,
            "brain_documents": brain_documents,
            "workspace_names": workspace_names,
            "workspace_ids": workspace_ids,
        }

    @staticmethod
    def _build_connector_repo(pb_request: Any) -> Optional[Dict[str, str]]:
        """Extract the conversation-level connector repository binding, if any."""
        if not getattr(pb_request, "connector_repo", None):
            return None
        repo_name = str(getattr(pb_request.connector_repo, "repo_name", "") or "").strip()
        if not repo_name:
            return None
        return {
            "connector_id": str(getattr(pb_request.connector_repo, "connector_id", "") or "").strip(),
            "connector_name": str(getattr(pb_request.connector_repo, "connector_name", "") or "").strip(),
            "repo_id": str(getattr(pb_request.connector_repo, "repo_id", "") or "").strip(),
            "repo_name": repo_name,
            "repo_url": str(getattr(pb_request.connector_repo, "repo_url", "") or "").strip(),
        }

    @staticmethod
    def _build_skills(pb_request: Any) -> Optional[List[Dict[str, Any]]]:
        """Extract conversation-level skills selected by the user in the composer."""
        skill_summaries = _grpc_skill_summaries(getattr(pb_request, "skills", []))
        logger.info(
            "gRPC conversation skills received",
            request_type=type(pb_request).__name__,
            conversation_id=getattr(pb_request, "conversation_id", ""),
            skill_count=len(skill_summaries),
            skills=skill_summaries,
        )
        if not skill_summaries:
            return None
        return [
            {
                "id": skill.id,
                "name": skill.name,
                "description": skill.description,
                "instructions": skill.instructions,
                "license": skill.license,
                "compatibility": skill.compatibility,
                "metadata": dict(skill.metadata) if skill.metadata else {},
                "allowed_tools": list(skill.allowed_tools) if skill.allowed_tools else [],
                "files": [
                    {
                        "path": file.path,
                        "kind": file.kind,
                        "mime_type": file.mime_type,
                        "content": file.content,
                    }
                    for file in skill.files
                ]
                if skill.files
                else [],
            }
            for skill in pb_request.skills
        ]

    async def _convert_single_agent_request(
        self, pb_request: "chatbot_pb2.RunSingleAgentRequest"
    ) -> RunAgentTeamRequest:
        """Convert a RunSingleAgentRequest (mono-agent) to the internal model.

        Reuses the same internal ``RunAgentTeamRequest`` as the team path so the
        whole service/orchestrator stack is shared. The difference: exactly one
        agent, ``agent_mode='mono'`` (routes to the no-manager workflow), and the
        LLM/prompt are taken from the single agent itself instead of a manager.
        """
        ctx = await self._build_brain_and_file_context(pb_request)

        # Chatbot config + base prompt come from the single agent (no manager).
        agent_chatbot_name = None
        if pb_request.agent.HasField("chatbot"):
            agent_chatbot_name = {
                "provider": pb_request.agent.chatbot.model,
                "input_modalities": list(pb_request.agent.chatbot.input_modalities) or ["text"],
            }
        if not agent_chatbot_name:
            logger.error(
                f"No chatbot model provided for single agent in conversation {pb_request.conversation_id}"
            )
            raise ValueError("No chatbot model was provided for the single agent")

        return RunAgentTeamRequest(
            user_id=pb_request.user_context.user_id,
            session_id=pb_request.conversation_id,
            message=pb_request.query,
            task_summary=getattr(pb_request, "task_summary", "") or None,
            image_input=ctx["image_input"] or None,
            attached_files=ctx["attached_documents"] or None,
            attached_images=ctx["attached_images_metadata"] or None,
            previous_attached_files=ctx["previous_attached"] or None,
            manager_prompt=pb_request.agent.prompt or "You are a helpful assistant.",
            chatbot_name=agent_chatbot_name,
            agents=[self._convert_agent(pb_request.agent)],
            available_agents=[],
            available_tools=[],
            vectorstore_name=app_settings.QDRANT_COLLECTION_NAME,
            workspace_names=ctx["workspace_names"],
            brain_ids=ctx["workspace_ids"],
            brain_documents=ctx["brain_documents"],
            brain_relations=None,
            search_web=getattr(pb_request, "web_search_enabled", False),
            agent_mode="mono",
            connector_repo=self._build_connector_repo(pb_request),
            skills=self._build_skills(pb_request),
            deep_search_enabled=getattr(pb_request, "deep_search_enabled", False),
            correction_replay_context=self._build_correction_replay_context(pb_request),
        )

    async def _convert_agent_team_request_v2(
        self, pb_request: "chatbot_pb2.RunAgentTeamRequest"
    ) -> RunAgentTeamRequest:
        """Convert protobuf RunAgentTeamRequest (V2 schema) to internal V1 Pydantic model.

        This converts the V2 request format to V1 format for backward compatibility
        with the existing service layer.

        V2 changes:
        - Removed chatbot_prompt (use default)
        - Removed vectorstore_name (use default)
        - workspace_context is repeated (supports multiple workspaces)
        - Agent instead of AgentSuggestion
        - attached_files replaces file_input (oneof: ImageData or DocumentData)
        - previous_attached_files for already-indexed documents

        Args:
            pb_request: Protobuf V2 request message

        Returns:
            RunAgentTeamRequest: Internal V1 Pydantic model
        """
        # Extract workspace names and documents from multiple workspace contexts
        workspace_names = []
        workspace_ids = []
        brain_documents = []

        # Iterate through all workspace contexts (now a repeated field)
        for workspace_ctx in pb_request.workspace_context:
            workspace_id = getattr(workspace_ctx, "workspace_id", "") or ""
            if workspace_id:
                workspace_ids.append(workspace_id)
            workspace_name = (
                getattr(workspace_ctx, "workspace_name", "")
                or workspace_id
            )
            if workspace_name:
                workspace_names.append(workspace_name)

            # Convert V2 Document objects to V1 brain_documents format
            for doc in workspace_ctx.workspace_documents:
                doc_file_name = getattr(doc, "file_name", "") or doc.filename or ""
                doc_workspace_name = (
                    getattr(doc, "workspace_name", "")
                    or workspace_name
                    or doc.workspace_id
                    or ""
                )
                brain_doc = {
                    "_id": doc._id,
                    "filename": doc.filename if doc.filename else "",
                    "file_name": doc_file_name,
                    "filepath": doc.filepath if doc.filepath else "",
                    "in_memory": doc.in_memory if doc.in_memory else False,
                    "language": doc.language if doc.language else "",
                    "indexing_token": doc.indexing_token if doc.indexing_token else 0,
                    "workspace_id": doc.workspace_id if doc.workspace_id else "",
                    "workspace_name": doc_workspace_name,
                }
                brain_documents.append(brain_doc)

        # Convert to None if empty (to match expected schema)
        workspace_names = workspace_names if workspace_names else None
        brain_documents = brain_documents if brain_documents else None
        ################
        # ── Process attached_files: separate images from documents ──
        image_filepaths = []
        attached_documents = []

        for file in pb_request.attached_files:
            data_type = file.WhichOneof("data")

            if data_type == "image":
                # Image → collect filepath for async download from Datalake
                image_filepaths.append(file.image.filepath)
            elif data_type == "document":
                # Document → will be sent to vectorstores-api for indexing
                doc = file.document
                attached_documents.append(
                    {
                        "filepath": doc.filepath,
                        "filename": doc.filename,
                        "workspace_name": doc.workspace_name,
                        "workspace_id": doc.workspace_id,
                        "source": doc.source or doc.filepath,
                        "createdAt": getattr(doc, "createdAt", None) or None,
                        "brain_type": doc.brain_type,
                        "lang_code": doc.lang_code,
                        "chunk_size": doc.chunk_size if doc.chunk_size else 4000,
                        "chunk_overlap": doc.chunk_overlap
                        if doc.chunk_overlap
                        else 100,
                        "enable_smart_chunk": doc.enable_smart_chunk,
                        "enable_extract_images": doc.enable_extract_images,
                        "sheet_name": doc.sheet_name if doc.sheet_name else None,
                        "in_memory": doc.in_memory,
                    }
                )

        # Download images from Datalake and convert to base64
        image_input = (
            await self._download_and_encode_images(image_filepaths)
            if image_filepaths
            else []
        )

        # Build image metadata for prompt context
        attached_images_metadata = []
        for filepath in image_filepaths:
            filename = filepath.rsplit("/", 1)[-1] if "/" in filepath else filepath
            attached_images_metadata.append({"filename": filename})

        logger.info(
            f"[gRPC] Processed attached_files: {len(image_input)} images, "
            f"{len(attached_documents)} documents"
        )

        # ── Process previous_attached_files (repeated Document) ──
        previous_attached = []
        for prev_doc in pb_request.previous_attached_files:
            prev_file_name = (
                getattr(prev_doc, "file_name", "") or prev_doc.filename or ""
            )
            prev_workspace_name = (
                getattr(prev_doc, "workspace_name", "") or prev_doc.workspace_id
            )
            previous_attached.append(
                {
                    "_id": prev_doc._id,
                    "filename": prev_doc.filename,
                    "file_name": prev_file_name,
                    "filepath": prev_doc.filepath,
                    "in_memory": prev_doc.in_memory,
                    "language": prev_doc.language if prev_doc.language else None,
                    "workspace_id": prev_doc.workspace_id,
                    "workspace_name": prev_workspace_name,
                    "createdAt": getattr(prev_doc, "createdAt", None) or None,
                }
            )

        if previous_attached:
            logger.info(
                f"[gRPC] {len(previous_attached)} previous attached files for context"
            )

        # ── Merge attached + previous attached into brain_documents for document tree ──
        if brain_documents is None:
            brain_documents = []
        existing_ids = {doc.get("_id") for doc in brain_documents if doc.get("_id")}

        for doc in attached_documents:
            doc_name = doc.get("workspace_name")
            if doc_name and doc_name not in existing_ids:
                brain_documents.append(
                    {
                        "_id": doc_name,
                        "filename": doc.get("filename", ""),
                        "file_name": doc.get("filename", ""),
                        "filepath": doc.get("filepath", ""),
                        "in_memory": doc.get("in_memory", False),
                        "language": doc.get("lang_code", ""),
                        "workspace_id": doc.get("workspace_id", ""),
                        "workspace_name": doc.get("workspace_name", ""),
                    }
                )
                existing_ids.add(doc_name)

        for doc in previous_attached:
            doc_id = doc.get("_id")
            if doc_id and doc_id not in existing_ids:
                brain_documents.append(doc)
                existing_ids.add(doc_id)

        brain_documents = brain_documents if brain_documents else None

        # Documents are indexed with workspace_name, so the search filter must
        # include these names or Qdrant won't find them.
        if workspace_names is None:
            workspace_names = []

        for doc in attached_documents:
            workspace_name = doc.get("workspace_name")
            if workspace_name and workspace_name not in workspace_names:
                workspace_names.append(workspace_name)

        for doc in previous_attached:
            workspace_name = doc.get("workspace_name") or doc.get("workspace_id")
            if workspace_name and workspace_name not in workspace_names:
                workspace_names.append(workspace_name)

        workspace_names = workspace_names if workspace_names else None
        workspace_ids = workspace_ids if workspace_ids else workspace_names
        ################
        # Extract chatbot_name from manager agent (agent_type="manager")
        # Manager agent is required - client must always provide one
        manager_chatbot_name = None
        manager_prompt = (
            "You are a manager agent that coordinates tasks between specialized agents."
        )

        for agent in pb_request.agents:
            if agent.agent_type == "manager":
                # Found the manager agent - use its chatbot configuration and prompt
                if agent.HasField("chatbot"):
                    manager_chatbot_name = {
                        "provider": agent.chatbot.model,
                        "input_modalities": list(agent.chatbot.input_modalities) or ["text"],
                    }
                if agent.prompt:
                    manager_prompt = agent.prompt
                break

        # Manager agent is required
        if not manager_chatbot_name:
            logger.error(
                f"No manager agent found in agents list for conversation {pb_request.conversation_id}"
            )
            raise ValueError("No Manager agent was found")

        connector_repo = None
        if getattr(pb_request, "connector_repo", None):
            repo_name = str(getattr(pb_request.connector_repo, "repo_name", "") or "").strip()
            if repo_name:
                connector_repo = {
                    "connector_id": str(getattr(pb_request.connector_repo, "connector_id", "") or "").strip(),
                    "connector_name": str(getattr(pb_request.connector_repo, "connector_name", "") or "").strip(),
                    "repo_id": str(getattr(pb_request.connector_repo, "repo_id", "") or "").strip(),
                    "repo_name": repo_name,
                    "repo_url": str(getattr(pb_request.connector_repo, "repo_url", "") or "").strip(),
                }

        # Conversation-level skills selected by the user in the composer.
        skills = (
            [
                {
                    "id": skill.id,
                    "name": skill.name,
                    "description": skill.description,
                    "instructions": skill.instructions,
                    "license": skill.license,
                    "compatibility": skill.compatibility,
                    "metadata": dict(skill.metadata) if skill.metadata else {},
                    "allowed_tools": list(skill.allowed_tools) if skill.allowed_tools else [],
                    "files": [
                        {
                            "path": file.path,
                            "kind": file.kind,
                            "mime_type": file.mime_type,
                            "content": file.content,
                        }
                        for file in skill.files
                    ]
                    if skill.files
                    else [],
                }
                for skill in pb_request.skills
            ]
            if getattr(pb_request, "skills", None)
            else None
        )

        return RunAgentTeamRequest(
            user_id=pb_request.user_context.user_id,  # V2: user_context.user_id → V1: user_id
            session_id=pb_request.conversation_id,  # V2: conversation_id → V1: session_id
            message=pb_request.query,  # V2: query → V1: message
            task_summary=getattr(pb_request, "task_summary", "") or None,
            image_input=image_input if image_input else None,
            attached_files=attached_documents if attached_documents else None,
            attached_images=attached_images_metadata
            if attached_images_metadata
            else None,
            previous_attached_files=previous_attached if previous_attached else None,
            manager_prompt=manager_prompt,  # Use manager agent's prompt if available
            chatbot_name=manager_chatbot_name,  # Use manager agent's chatbot or fallback
            agents=[
                self._convert_agent(agent)  # Use renamed method
                for agent in pb_request.agents
            ]
            if pb_request.agents
            else [],
            available_agents=[],  # V2 removed this field
            available_tools=[],  # V2 removed this field
            vectorstore_name=app_settings.QDRANT_COLLECTION_NAME,  # Use environment variable
            workspace_names=workspace_names,  # V2: workspace_context.workspace_id (singular) → V1: workspace_names (plural)
            brain_ids=workspace_ids,
            brain_documents=brain_documents,
            brain_relations=None,  # V2 removed this field
            search_web=getattr(pb_request, "web_search_enabled", False),
            agent_mode=pb_request.agent_mode,
            connector_repo=connector_repo,
            skills=skills,
            deep_search_enabled=getattr(pb_request, 'deep_search_enabled', False),
            correction_replay_context=self._build_correction_replay_context(pb_request),
        )

    def _build_correction_replay_context(self, pb_request):
        if not pb_request.HasField("correction_replay_context"):
            return None
        context = pb_request.correction_replay_context
        return {
            "original_answer": context.original_answer,
            "findings": [
                {
                    "claim": finding.claim,
                    "status": finding.status,
                    "importance": finding.importance,
                    "explanation": finding.explanation,
                }
                for finding in context.findings
            ],
            "attempt_number": context.attempt_number,
            "instructions": context.instructions,
        }

    async def _download_and_encode_images(
        self, filepaths: List[str]
    ) -> List[Dict[str, str]]:
        """Download images from Azure Datalake to temp files, then base64 encode.

        Uses tempfile.mkdtemp() for per-request isolation. Images are written
        to disk first so that raw bytes are never held in memory alongside
        the base64 string, reducing peak memory under concurrency.

        Args:
            filepaths: List of Datalake file paths (e.g., "workspaceId/image.png").

        Returns:
            List of dicts like [{"image 1": "data:image/png;base64,..."}, ...].
        """
        if not filepaths:
            return []

        if len(filepaths) > app_settings.MAX_IMAGES:
            logger.warning(
                f"[gRPC] Too many images ({len(filepaths)}), limiting to {app_settings.MAX_IMAGES}"
            )
            filepaths = filepaths[: app_settings.MAX_IMAGES]

        image_input = []
        tmp_dir = tempfile.mkdtemp()

        try:
            async with DataLakeServiceClient.from_connection_string(
                app_settings.AZURE_DATALAKE_CONNECTION_STRING
            ) as service_client:
                fs_client = service_client.get_file_system_client(
                    app_settings.AZURE_DATALAKE_FILE_SYSTEM_NAME
                )

                for idx, filepath in enumerate(filepaths, start=1):
                    try:
                        file_client = fs_client.get_file_client(filepath)
                        download = await file_client.download_file()
                        raw_bytes = await download.readall()

                        if len(raw_bytes) > app_settings.MAX_IMAGE_SIZE:
                            logger.warning(
                                f"[gRPC] Image {filepath} too large ({len(raw_bytes)} bytes), skipping (max {app_settings.MAX_IMAGE_SIZE})"
                            )
                            continue

                        # Write to temp file and release raw_bytes from memory
                        tmp_path = os.path.join(
                            tmp_dir, f"image_{idx}{os.path.splitext(filepath)[1]}"
                        )
                        async with aiofiles.open(tmp_path, "wb") as f:
                            await f.write(raw_bytes)
                        file_size = len(raw_bytes)
                        del raw_bytes  # free memory before encoding

                        # Read back from disk and encode to base64
                        async with aiofiles.open(tmp_path, "rb") as f:
                            file_bytes = await f.read()
                        b64_data = base64.b64encode(file_bytes).decode("utf-8")
                        del file_bytes  # free raw bytes immediately

                        # Detect MIME type from extension
                        ext = os.path.splitext(filepath)[1].lower()
                        mime_type = mimetypes.types_map.get(ext, "image/jpeg")

                        data_uri = f"data:{mime_type};base64,{b64_data}"
                        del b64_data  # only keep the final data_uri string

                        image_input.append({f"image {idx}": data_uri})
                        logger.info(
                            f"[gRPC] Downloaded and encoded image {idx}: {filepath} ({file_size} bytes)"
                        )

                    except Exception as e:
                        logger.error(f"[gRPC] Failed to download image {filepath}: {e}")

        except Exception as e:
            logger.error(
                f"[gRPC] Failed to connect to Azure Datalake for image download: {e}"
            )

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        return image_input

    async def _index_attached_documents(
        self, documents: List[Dict[str, Any]], conversation_id: str
    ) -> None:
        """Send document indexing requests to vectorstores-api (fire-and-forget).

        For each document, sends a POST to /vectorstores/indexDocumentFromAzureDatalake.
        This triggers the async Celery pipeline (download → chunk → Redis index → Azure index).
        Documents become immediately searchable via Redis BM25 (PENDING status),
        then via Azure vector search once indexing completes (COMPLETED status).

        Args:
            documents: List of document dicts extracted from attached_files
            conversation_id: Conversation ID for logging/correlation
        """
        vectorstores_url = app_settings.VECTORSTORES_API_URL
        if not vectorstores_url:
            logger.error(
                "[gRPC] VECTORSTORES_API_URL not configured - skipping document indexing"
            )
            return

        vectorstore_api_key = getattr(app_settings, "VECTORSTORE_API_KEY", "") or ""
        if not vectorstore_api_key:
            logger.error(
                "[gRPC] VECTORSTORE_API_KEY not configured - skipping document indexing"
            )
            return

        index_url = f"{vectorstores_url.rstrip('/')}/vectorstores/indexDocumentFromAzureDatalake"
        headers = {
            "x-api-key": vectorstore_api_key,
            "Content-Type": "application/json",
            "correlation-id": conversation_id,
        }

        logger.info(
            f"[gRPC] Indexing {len(documents)} attached documents for conversation {conversation_id}"
        )

        timeout = aiohttp.ClientTimeout(total=30)

        async def _index_single(
            session: aiohttp.ClientSession, doc: Dict[str, Any]
        ) -> bool:
            """Index a single document. Returns True on success, False on failure."""
            payload = {
                "filepath": doc["filepath"],
                "brain_id": doc["workspace_id"],
                "external_id": doc.get("workspace_name") or doc["filepath"],
                "source": doc.get("source") or doc["filepath"],
                "brain_type": doc.get("brain_type", "doc"),
                "lang_code": doc.get("lang_code", "auto"),
                "chunk_size": doc.get("chunk_size", 4000),
                "chunk_overlap": doc.get("chunk_overlap", 100),
                "enable_smart_chunk": doc.get("enable_smart_chunk", True),
                "enable_extract_images": doc.get("enable_extract_images", False),
                "sheet_name": doc.get("sheet_name"),
                "in_memory": doc.get("in_memory", False),
                "webhook_url": "https://example.com/webhook/indexing",
                "brain_tag": [""],
            }

            try:
                async with session.post(
                    index_url, json=payload, headers=headers
                ) as resp:
                    if resp.status in (200, 201):
                        return True
                    else:
                        body = await resp.text()
                        logger.error(
                            f"[gRPC] Document indexing failed: filepath={doc['filepath']}, "
                            f"status={resp.status}, response={body}"
                        )
                        return False
            except Exception as e:
                logger.error(
                    f"[gRPC] Error indexing document: filepath={doc['filepath']}, error={e}"
                )
                return False

        async with aiohttp.ClientSession(timeout=timeout) as session:
            results = await asyncio.gather(
                *[_index_single(session, doc) for doc in documents],
                return_exceptions=True,
            )

        succeeded = sum(1 for r in results if r is True)
        failed = len(results) - succeeded
        logger.info(
            f"[gRPC] Indexing complete: {succeeded}/{len(documents)} succeeded, {failed} failed"
        )

    @staticmethod
    def _status_to_enum(status_str: str) -> int:
        """Convert status string to TaskStatus enum value.

        Args:
            status_str: Status as string ("pending", "in_progress", "completed", "error")

        Returns:
            TaskStatus enum value
        """
        status_map = {
            "pending": chatbot_pb2.PENDING,
            "in_progress": chatbot_pb2.IN_PROGRESS,
            "completed": chatbot_pb2.COMPLETED,
            "error": chatbot_pb2.ERROR,
        }
        return status_map.get(status_str.lower(), chatbot_pb2.PENDING)

    @staticmethod
    def _chart_kind_to_enum(kind_str: str) -> int:
        kind_map = {
            "bar": chatbot_pb2.CHART_KIND_BAR,
            "line": chatbot_pb2.CHART_KIND_LINE,
            "area": chatbot_pb2.CHART_KIND_AREA,
            "pie": chatbot_pb2.CHART_KIND_PIE,
            "scatter": chatbot_pb2.CHART_KIND_SCATTER,
            "composed": chatbot_pb2.CHART_KIND_COMPOSED,
        }
        return kind_map.get((kind_str or "").lower(), chatbot_pb2.CHART_KIND_UNSPECIFIED)

    @staticmethod
    def _chart_layout_to_enum(layout_str: str) -> int:
        layout_map = {
            "horizontal": chatbot_pb2.CHART_LAYOUT_HORIZONTAL,
            "vertical": chatbot_pb2.CHART_LAYOUT_VERTICAL,
        }
        return layout_map.get((layout_str or "").lower(), chatbot_pb2.CHART_LAYOUT_UNSPECIFIED)

    @staticmethod
    def _citation_bbox(value: Any) -> List[float]:
        if not isinstance(value, list) or len(value) != 4:
            return []
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return []

    def _dict_to_stream_chunk(
        self, chunk_dict: Dict[str, Any]
    ) -> "chatbot_pb2.StreamChunk":
        """Convert internal chunk dictionary to protobuf StreamChunk.

        Supports both old format (for backward compatibility) and new component-based format.

        Args:
            chunk_dict: Dictionary with chunk data (from StreamingFormatter)

        Returns:
            StreamChunk: Protobuf message
        """
        # Check if this is a usage-only chunk (no component)
        if "usage" in chunk_dict and "component" not in chunk_dict:
            usage_data = chunk_dict["usage"]
            metadata = chunk_dict.get("metadata", {})

            return chatbot_pb2.StreamChunk(
                metadata=chatbot_pb2.Metadata(
                    message_id=metadata.get("message_id", ""),
                    agent_id=metadata.get("agent_id", ""),
                    guardrail_decision_json=self._guardrail_decision_json(metadata),
                ),
                usage=chatbot_pb2.Usage(
                    input_tokens=usage_data.get("input_tokens", 0),
                    output_tokens=usage_data.get("output_tokens", 0),
                    total_tokens=usage_data.get("total_tokens", 0),
                    model=usage_data.get("model", ""),
                ),
            )

        # Check if this is the new component-based format
        if (
            "action" in chunk_dict
            and "component" in chunk_dict
            and "metadata" in chunk_dict
        ):
            # New format
            component_dict = chunk_dict["component"]
            metadata = chunk_dict["metadata"]

            # Build the component with the appropriate oneof field
            component = self._build_component(
                component_id=component_dict.get("id", ""),
                component_type=component_dict.get("type", "text"),
                component_data=component_dict.get("data", {}),
            )

            return chatbot_pb2.StreamChunk(
                action=chunk_dict["action"],
                component=component,
                metadata=chatbot_pb2.Metadata(
                    message_id=metadata.get("message_id", ""),
                    agent_id=metadata.get("agent_id", ""),
                    guardrail_decision_json=self._guardrail_decision_json(metadata),
                ),
            )
        else:
            # Old format (backward compatibility) - convert to new format
            component_type = self._map_content_type_to_component_type(
                chunk_dict.get("content_type", "chunk")
            )
            component_data = {"content": chunk_dict.get("chunk", "")}

            component = self._build_component(
                component_id=chunk_dict.get("chunk_id", ""),
                component_type=component_type,
                component_data=component_data,
            )

            return chatbot_pb2.StreamChunk(
                action="add",  # Default to add for old format
                component=component,
                metadata=chatbot_pb2.Metadata(
                    message_id=chunk_dict.get("message_id", ""),
                    agent_id=chunk_dict.get("agent_id", ""),
                    guardrail_decision_json=self._guardrail_decision_json(chunk_dict),
                ),
            )

    @staticmethod
    def _guardrail_decision_json(payload: Dict[str, Any]) -> str:
        decision = payload.get("guardrail_decision")
        if not decision:
            return ""
        try:
            return json.dumps(decision, ensure_ascii=False, default=str)
        except (TypeError, ValueError) as exc:
            logger.warning(f"[GUARDRAIL] Failed to serialize guardrail decision metadata: {exc}")
            return ""

    def _build_component(
        self, component_id: str, component_type: str, component_data: Dict[str, Any]
    ) -> "chatbot_pb2.Component":
        """Build a Component protobuf message with the appropriate oneof field set.

        Args:
            component_id: Unique component identifier
            component_type: Type of component (text, plan, code, etc.)
            component_data: Dictionary with component-specific data

        Returns:
            Component protobuf message
        """
        component_kwargs = {"id": component_id}

        if component_type == "text":
            component_kwargs["text"] = chatbot_pb2.TextComponent(
                content=component_data.get("content", ""),
                output_port_id=component_data.get("output_port_id")
                or component_data.get("outputPortId", ""),
            )
        elif component_type == "code":
            component_kwargs["code"] = chatbot_pb2.CodeComponent(
                content=component_data.get("content", ""),
                language=component_data.get("language", ""),
                filename=component_data.get("filename", ""),
                output_port_id=component_data.get("output_port_id")
                or component_data.get("outputPortId", ""),
            )
        elif component_type == "reasoning":
            component_kwargs["reasoning"] = chatbot_pb2.ReasoningComponent(
                content=component_data.get("content", "")
            )
        elif component_type == "chain_of_thought":
            component_kwargs["chain_of_thought"] = chatbot_pb2.ChainOfThoughtComponent(
                steps=[str(step) for step in component_data.get("steps", [])],
            )
        elif component_type == "plan":
            # Build PlanComponent with PlanStep objects
            steps = []
            for step_data in component_data.get("steps", []):
                steps.append(
                    chatbot_pb2.PlanStep(
                        task=step_data.get("task", ""),
                        agent=step_data.get("agent", ""),
                        status=self._status_to_enum(step_data.get("status", "pending")),
                    )
                )
            component_kwargs["plan"] = chatbot_pb2.PlanComponent(
                title=component_data.get("title", ""),
                steps=steps,
                status=self._status_to_enum(component_data.get("status", "pending")),
            )
        elif component_type == "queue":
            items = []
            for item_data in component_data.get("items", []):
                items.append(
                    chatbot_pb2.QueueItem(
                        id=item_data.get("id", ""),
                        title=item_data.get("title", ""),
                        status=item_data.get("status", "pending"),
                    )
                )
            component_kwargs["queue"] = chatbot_pb2.QueueComponent(
                title=component_data.get("title", ""), items=items
            )
        elif component_type == "chart":
            chart_data = component_data.get("chartData", component_data.get("data", []))
            chart_config = component_data.get("config", {})
            chart_series = component_data.get("series", [])
            component_kwargs["chart"] = chatbot_pb2.ChartComponent(
                title=component_data.get("title", ""),
                data=chart_data if isinstance(chart_data, str) else json.dumps(chart_data, ensure_ascii=False),
                config=chart_config if isinstance(chart_config, str) else json.dumps(chart_config, ensure_ascii=False),
                xAxisKey=component_data.get("xAxisKey", ""),
                series=chart_series if isinstance(chart_series, str) else json.dumps(chart_series, ensure_ascii=False),
                kind=self._chart_kind_to_enum(component_data.get("kind", "bar")),
                yAxisKey=component_data.get("yAxisKey", ""),
                stacked=component_data.get("stacked", False),
                layout=self._chart_layout_to_enum(component_data.get("layout", "horizontal")),
                inner_radius=component_data.get("innerRadius", 0),
                show_legend=component_data.get("showLegend", True),
                show_grid=component_data.get("showGrid", True),
                nameKey=component_data.get("nameKey", ""),
                zAxisKey=component_data.get("zAxisKey", ""),
            )
        elif component_type == "choice":
            options = [
                chatbot_pb2.ChoiceOption(
                    id=item.get("id", ""),
                    label=item.get("label", ""),
                    submit_text=item.get("submitText", ""),
                    value=item.get("value", ""),
                    description=item.get("description", ""),
                    disabled=bool(item.get("disabled", False)),
                    url=item.get("url", ""),
                )
                for item in component_data.get("options", [])
                if isinstance(item, dict)
            ]
            choice = chatbot_pb2.ChoiceComponent(
                schema_version=component_data.get("schemaVersion", 1),
                question_id=component_data.get("questionId", ""),
                prompt=component_data.get("prompt", ""),
                description=component_data.get("description", ""),
                presentation=component_data.get("presentation", "quick_replies"),
                selection_mode=component_data.get("selectionMode", "single"),
                submit_behavior=component_data.get("submitBehavior", "immediate"),
                options=options,
                dismissible=bool(component_data.get("dismissible", False)),
                fallback_text=component_data.get("fallbackText", ""),
                status=component_data.get("status", "ready"),
            )
            other = component_data.get("otherOption")
            if isinstance(other, dict):
                choice.other_option.CopyFrom(chatbot_pb2.ChoiceOtherOption(
                    enabled=bool(other.get("enabled", False)), label=other.get("label", ""),
                    placeholder=other.get("placeholder", ""), max_length=other.get("maxLength", 500),
                ))
            labels = component_data.get("labels")
            if isinstance(labels, dict):
                choice.labels.CopyFrom(chatbot_pb2.ChoiceLabels(
                    submit=labels.get("submit", ""), dismiss=labels.get("dismiss", ""), other=labels.get("other", ""),
                ))
            progress = component_data.get("progress")
            if isinstance(progress, dict):
                choice.progress.CopyFrom(chatbot_pb2.ChoiceProgress(
                    current=progress.get("current", 0), total=progress.get("total", 0), label=progress.get("label", ""),
                ))
            component_kwargs["choice"] = choice
        elif component_type == "task":
            # Build TaskComponent with items array
            items = []
            for item_data in component_data.get("items", []):
                items.append(chatbot_pb2.TaskItem(text=item_data.get("text", "")))
            component_kwargs["task"] = chatbot_pb2.TaskComponent(
                title=component_data.get("title", ""),
                items=items,
                status=component_data.get("status", "in_progress"),
            )
        elif component_type == "error":
            component_kwargs["error"] = chatbot_pb2.ErrorComponent(
                title=component_data.get("title", "Error"),
                content=component_data.get("content", ""),
            )
        elif component_type == "sources":
            # Build SourcesComponent with sources array
            source_items = []
            for source_data in component_data.get("sources", []):
                source_items.append(
                    chatbot_pb2.SourceItem(
                        title=source_data.get("title", ""),
                        url=source_data.get("url", ""),
                    )
                )
            component_kwargs["sources"] = chatbot_pb2.SourcesComponent(
                sources=source_items
            )
        elif component_type == "sandbox":
            component_kwargs["sandbox"] = chatbot_pb2.SandboxComponent(
                code=component_data.get("code", ""),
                output=component_data.get("output", ""),
                error=component_data.get("error", ""),
                output_available=component_data.get("output_available", False),
            )
        elif component_type == "tool_info":
            tool_info = chatbot_pb2.ToolInfoComponent(
                title=component_data.get("title", ""),
                status=component_data.get("status", ""),
            )
            params = component_data.get("params")
            if params:
                tool_info.params = params
            result_json = component_data.get("result_json")
            if result_json:
                tool_info.result_json = result_json
            started_at = component_data.get("started_at")
            if started_at:
                tool_info.started_at = started_at
            component_kwargs["tool_info"] = tool_info
        elif component_type == "web_preview":
            component_kwargs["web_preview"] = chatbot_pb2.WebPreviewComponent(
                content=component_data.get("content", "")
            )
        elif component_type == "artifact":
            component_kwargs["artifact"] = chatbot_pb2.ArtifactComponent(
                file_path=component_data.get("object_key")
                or component_data.get("file_path")
                or component_data.get("azure_path")
                or "",
                filename=component_data.get("filename", ""),
                output_port_id=component_data.get("output_port_id")
                or component_data.get("outputPortId", ""),
                artifact_kind=component_data.get("artifact_kind")
                or component_data.get("artifactKind", ""),
                mime_type=component_data.get("mime_type")
                or component_data.get("mimeType", ""),
            )
        elif component_type == "citation":
            # Build CitationComponent with TextSourceData or ImageSourceData
            parent_id = component_data.get("parent_id", "")

            if "text_source" in component_data:
                # Build TextSourceData
                text_source_data = component_data.get("text_source", {})

                # Ensure all values are strings (protobuf requires string type)
                component_kwargs["citation"] = chatbot_pb2.CitationComponent(
                    parent_id=str(parent_id) if parent_id else "",
                    text_source=chatbot_pb2.TextSourceData(
                        type=str(text_source_data.get("type", "text")),
                        source=str(text_source_data.get("source", "")),
                        file_name=str(
                            text_source_data.get("external_id")
                            or text_source_data.get("file_name", "")
                        ),
                        page=str(text_source_data.get("page", "")),
                        page_content=str(text_source_data.get("page_content", "")),
                        workspace_id=str(text_source_data.get("workspace_id", "")),
                        reference=str(text_source_data.get("reference", "")),
                        highlight_text=str(
                            text_source_data.get("highlight_text", "")
                        ),
                        highlight_bbox=self._citation_bbox(
                            text_source_data.get("highlight_bbox")
                        ),
                        block_bbox=self._citation_bbox(
                            text_source_data.get("block_bbox")
                        ),
                    ),
                )

            elif "image_source" in component_data:
                # Build ImageSourceData
                image_source_data = component_data.get("image_source", {})

                # Ensure all values are strings (protobuf requires string type)
                component_kwargs["citation"] = chatbot_pb2.CitationComponent(
                    parent_id=str(parent_id) if parent_id else "",
                    image_source=chatbot_pb2.ImageSourceData(
                        type=str(image_source_data.get("type", "image")),
                        path=str(image_source_data.get("path", "")),
                        page=str(image_source_data.get("page", "")),
                        file_name=str(image_source_data.get("file_name", "")),
                        workspace_name=str(
                            image_source_data.get("external_id")
                            or image_source_data.get("workspace_name")
                            or image_source_data.get("file_name", "")
                        ),
                        workspace_id=str(image_source_data.get("workspace_id", "")),
                        height=str(image_source_data.get("height", "")),
                        width=str(image_source_data.get("width", "")),
                        reference=str(image_source_data.get("reference", "")),
                        highlight_text=str(
                            image_source_data.get("highlight_text", "")
                        ),
                        highlight_bbox=self._citation_bbox(
                            image_source_data.get("highlight_bbox")
                        ),
                        block_bbox=self._citation_bbox(
                            image_source_data.get("block_bbox")
                        ),
                    ),
                )

            else:
                # Fallback to empty citation if no source data
                component_kwargs["citation"] = chatbot_pb2.CitationComponent(
                    parent_id=str(parent_id) if parent_id else ""
                )
                logger.warning(
                    f"[gRPC] Sending CITATION component to client: EMPTY (no source data)"
                )
        else:
            # Default to text for unknown types
            component_kwargs["text"] = chatbot_pb2.TextComponent(
                content=str(component_data)
            )

        return chatbot_pb2.Component(**component_kwargs)

    def _map_content_type_to_component_type(self, content_type: str) -> str:
        """Map old content_type to new component type.

        Args:
            content_type: Old content type (chunk, description, source, etc.)

        Returns:
            New component type (text, plan, etc.)
        """
        mapping = {
            "chunk": "text",
            "description": "plan",
            "source": "text",
            "final_response": "text",
            "ui": "chart",
            "File": "text",
            "error": "text",
            "suggestions": "text",
        }
        return mapping.get(content_type, "text")

    async def GenerateConversationName(
        self,
        request: "chatbot_pb2.GenerateConversationNameRequest",
        context: grpc.aio.ServicerContext,
    ) -> "chatbot_pb2.GenerateConversationNameResponse":
        """
        Generate a conversation name from a user query.

        Args:
            request: Protobuf request with query and model
            context: gRPC context for the request

        Returns:
            GenerateConversationNameResponse with generated conversation name
        """
        try:
            logger.info(
                f"[gRPC] Generate conversation name request - model: {request.model}"
            )

            # Create a prompt to generate conversation name
            prompt = f"""Based on the following user query, generate a short, descriptive conversation name (3-6 words maximum).
            The name should capture the main topic or intent of the query.
            Do not use quotes, just return the plain text name.
            
            User query: {request.query}
            
            Conversation name:"""

            # Use litellm to generate the name
            response = await litellm.acompletion(
                model=request.model,
                messages=[{"role": "user", "content": prompt}],
                api_base=app_settings.LITELLM_API_BASE_URL,
                api_key=app_settings.LITELLM_API_SECRET_KEY,
                temperature=1,
                max_tokens=50,
            )

            # Extract the generated name
            conversation_name = (
                response.choices[0].message.content.strip().strip('"').strip("'")
            )

            logger.info(
                f"[gRPC] Generated conversation name: '{conversation_name}' for query: '{request.query[:100]}...'"
            )

            # Return response
            return chatbot_pb2.GenerateConversationNameResponse(
                conversation_name=conversation_name
            )

        except Exception as exc:
            logger.error(f"[gRPC] Error in GenerateConversationName: {str(exc)}")
            await context.abort(
                grpc.StatusCode.INTERNAL,
                f"Failed to generate conversation name: {str(exc)}",
            )

    # ========== GENERATE PLAYBOOK (unary) ==========

    async def GeneratePlaybook(
        self,
        request: "chatbot_pb2.GeneratePlaybookRequest",
        context: grpc.aio.ServicerContext,
    ) -> "chatbot_pb2.GeneratePlaybookResponse":
        """Generate or modify a playbook via LLM.

        Receives user query, available agents, workspace context, and optionally
        an existing playbook (for modification). Returns a complete playbook with
        positioned nodes and edges.
        """
        username = request.user_context.username or request.user_context.user_id or "unknown"
        user_token = set_user_context(request.user_context.user_id, username)
        try:
            logger.info(
                "[GeneratePlaybook] Request received",
                model=request.model,
                username=username,
                agent_count=len(request.available_agents),
                has_existing=request.HasField("existing_playbook"),
            )

            # 1. Extract agent info
            agents_info = []
            for agent in request.available_agents:
                tool_names = [t.name for t in agent.tools] if agent.tools else []
                agents_info.append(
                    {
                        "id": agent.id,
                        "name": agent.name,
                        "description": agent.description,
                        "agent_type": agent.agent_type,
                        "tools": tool_names,
                    }
                )

            # 2. Extract workspace context
            workspace_info = []
            for wc in request.workspace_context:
                doc_names = [d.filename for d in wc.workspace_documents]
                workspace_info.append(
                    {
                        "workspace_id": wc.workspace_id,
                        "documents": doc_names,
                    }
                )

            # 3. Extract existing playbook (if present)
            existing_playbook_json = None
            if request.HasField("existing_playbook"):
                ep = request.existing_playbook
                existing_nodes = [
                    {
                        "id": n.id,
                        "title": n.title,
                        "description": n.description,
                        "assigned_agent_id": n.assigned_agent_id,
                        "execution_order": n.execution_order,
                        "x": n.x,
                        "y": n.y,
                        "interrupt_before": n.interrupt_before,
                        "interrupt_after": n.interrupt_after,
                    }
                    for n in ep.nodes
                ]
                existing_edges = [
                    {"source_id": e.source_id, "target_id": e.target_id}
                    for e in ep.edges
                ]
                existing_playbook_json = json.dumps(
                    {"nodes": existing_nodes, "edges": existing_edges}, indent=2
                )

            # 4. Build system prompt
            system_prompt = self._build_generate_playbook_prompt(
                agents_info,
                workspace_info,
                existing_playbook_json,
                dict(getattr(request, "prompt_overrides", {}) or {}),
            )

            # 5. Call LLM
            response = await litellm.acompletion(
                model=request.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": request.query},
                ],
                api_base=app_settings.LITELLM_API_BASE_URL,
                api_key=app_settings.LITELLM_API_SECRET_KEY,
                max_tokens=32000,
                response_format={"type": "json_object"},
                user=get_user_label(),
            )

            raw = response.choices[0].message.content.strip()

            # Extract usage from litellm response
            usage_proto = None
            if hasattr(response, "usage") and response.usage:
                usage_proto = chatbot_pb2.Usage(
                    input_tokens=getattr(response.usage, "prompt_tokens", 0) or 0,
                    output_tokens=getattr(response.usage, "completion_tokens", 0) or 0,
                    total_tokens=getattr(response.usage, "total_tokens", 0) or 0,
                    model=request.model or "",
                )

            logger.info("[GeneratePlaybook] LLM response received", length=len(raw))

            # 6. Parse JSON
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                logger.error(
                    "[GeneratePlaybook] JSON parse error", error=str(exc), raw=raw[:500]
                )
                await context.abort(
                    grpc.StatusCode.INTERNAL,
                    f"LLM returned invalid JSON: {exc}",
                )

            # 7. Convert to proto response
            DEFAULT_INPUT_PORT = chatbot_pb2.TaskInputPort(
                id="default",
                name="Input",
                artifact_kind="text",
                required=False,
            )
            DEFAULT_OUTPUT_PORT = chatbot_pb2.TaskOutputPort(
                id="default",
                name="Output",
                artifact_kind="text",
            )

            nodes = []
            for n in data.get("nodes", []):
                raw_input_ports = n.get("inputPorts") or n.get("input_ports") or []
                raw_output_ports = n.get("outputPorts") or n.get("output_ports") or []

                input_ports = [
                    chatbot_pb2.TaskInputPort(
                        id=str(p.get("id", "")),
                        name=p.get("name", "Input"),
                        artifact_kind=p.get("artifactKind")
                        or p.get("artifact_kind", "text"),
                        required=bool(p.get("required", False)),
                        description=p.get("description", ""),
                    )
                    for p in raw_input_ports
                ] or [DEFAULT_INPUT_PORT]

                output_ports = [
                    chatbot_pb2.TaskOutputPort(
                        id=str(p.get("id", "")),
                        name=p.get("name", "Output"),
                        artifact_kind=p.get("artifactKind")
                        or p.get("artifact_kind", "text"),
                        description=p.get("description", ""),
                    )
                    for p in raw_output_ports
                ] or [DEFAULT_OUTPUT_PORT]

                nodes.append(
                    chatbot_pb2.PlaybookNodeConfig(
                        id=str(n.get("id", "")),
                        title=n.get("title", ""),
                        description=n.get("description", ""),
                        assigned_agent_id=str(n.get("assigned_agent_id", "")),
                        execution_order=int(n.get("execution_order", 0)),
                        x=float(n.get("x", 0)),
                        y=float(n.get("y", 0)),
                        interrupt_before=bool(n.get("interrupt_before", False)),
                        interrupt_after=bool(n.get("interrupt_after", False)),
                        allow_clarification=bool(n.get("allow_clarification", False)),
                        clarification_prompt=n.get("clarification_prompt", ""),
                        max_clarifications=int(n.get("max_clarifications", 0)),
                        input_keys=list(n.get("input_keys", [])),
                        output_key=n.get("output_key", ""),
                        input_ports=input_ports,
                        output_ports=output_ports,
                        task_type=n.get("task_type") or n.get("taskType") or "generic",
                    )
                )

            edges = []
            for e in data.get("edges", []):
                edges.append(
                    chatbot_pb2.PlaybookEdgeConfig(
                        source_id=str(e.get("source_id", "")),
                        target_id=str(e.get("target_id", "")),
                    )
                )

            logger.info(
                "[GeneratePlaybook] Playbook generated",
                node_count=len(nodes),
                edge_count=len(edges),
            )

            resp = chatbot_pb2.GeneratePlaybookResponse(nodes=nodes, edges=edges)
            if usage_proto:
                resp.usage.CopyFrom(usage_proto)
            return resp

        except Exception as exc:
            logger.error(
                "[GeneratePlaybook] Unhandled error", error=str(exc), exc_info=True
            )
            await context.abort(
                grpc.StatusCode.INTERNAL,
                f"Failed to generate playbook: {exc}",
            )
        finally:
            user_ctx.reset(user_token)

    @staticmethod
    def _build_generate_playbook_prompt(
        agents_info: list,
        workspace_info: list,
        existing_playbook_json: str | None,
        prompt_overrides: dict | None = None,
    ) -> str:
        """Build the system prompt for playbook generation."""
        return build_generate_playbook_prompt(
            agents_info, workspace_info, existing_playbook_json, prompt_overrides
        )

    # ========== PLAYBOOK / LANGGRAPH RPCs ==========

    async def RunPlaybookWorkflow(self, request, context):
        """Execute a playbook workflow with server-streaming step updates."""
        from src.flow_engine.legacy_runtime import (
            run_playbook, register_task, remove_task,
        )

        username = request.user_context.username or request.user_context.user_id or "unknown"
        user_token = set_user_context(request.user_context.user_id, username)
        logger.info(
            "[RunPlaybookWorkflow] Request received",
            playbook_id=request.playbook_id,
            username=username,
            task_count=len(request.tasks),
            agent_count=len(request.agents),
            edge_count=len(request.edges),
            execution_mode=request.execution_mode or "live",
            validated_replay_count=len(request.validated_replays),
            validated_replay_task_ids=[
                replay.task_id for replay in request.validated_replays
            ],
        )
        resolved_trigger_context = _parse_trigger_context_fallback(request)
        logger.info(
            "*************** [RunPlaybookWorkflow] triggerContext received",
            triggerContext=resolved_trigger_context,
        )
        logger.info(
            "[RunPlaybookWorkflow] Request payload",
            request_payload=MessageToDict(
                request,
                preserving_proto_field_name=True,
                always_print_fields_with_no_presence=True,
            ),
        )

        queue: asyncio.Queue = asyncio.Queue(
            maxsize=app_settings.PLAYBOOK_STREAM_QUEUE_MAXSIZE
        )
        thread_id = f"{request.playbook_id}_{uuid.uuid4().hex[:8]}"
        bg_task: Optional[asyncio.Task] = None

        try:
            tasks = [_proto_task_to_dict(t) for t in request.tasks]
            agents = {a.id: _proto_agent_to_dict(a) for a in request.agents}
            edges = [_proto_edge_to_dict(e) for e in request.edges]
            logger.info(
                "[ITERATOR_DEBUG RunPlaybookWorkflow] tasks after deserialization",
                task_count=len(tasks),
                tasks=[
                    {
                        "id": t.get("id"),
                        "title": t.get("title"),
                        "task_type": t.get("task_type"),
                        "has_task_metadata": t.get("task_metadata") is not None,
                        "task_metadata_keys": list(t["task_metadata"].keys()) if isinstance(t.get("task_metadata"), dict) else None,
                        "task_metadata_iterator": (t.get("task_metadata") or {}).get("iterator") if isinstance(t.get("task_metadata"), dict) else None,
                    }
                    for t in tasks
                ],
            )

            bg_task = asyncio.create_task(
                run_playbook(
                    playbook_id=request.playbook_id,
                    tasks=tasks,
                    agents=agents,
                    edges=edges,
                    query=request.query,
                    workspace_context=_proto_workspace_context(
                        request.workspace_context
                    ),
                    trigger_context=resolved_trigger_context,
                    queue=queue,
                    thread_id=thread_id,
                    execution_mode=request.execution_mode or "live",
                    validated_replays_by_task={
                        replay.task_id: _proto_validated_replay_to_dict(replay)
                        for replay in request.validated_replays
                    } if request.validated_replays else {},
                    evaluation_user_id=username,
                    step_execution_modes=dict(request.step_execution_modes) if request.step_execution_modes else {},
                    prompt_overrides=dict(request.prompt_overrides)
                    if getattr(request, "prompt_overrides", None)
                    else {},
                    deep_search=getattr(request, "deep_search", False),
                )
            )
            register_task(thread_id, bg_task)

            async for chunk in self._stream_playbook_queue(queue, bg_task, thread_id):
                yield chunk

        except asyncio.CancelledError:
            logger.info("[RunPlaybookWorkflow] Client cancelled stream")
            if not bg_task.done():
                bg_task.cancel()
                try:
                    await bg_task
                except (asyncio.CancelledError, Exception):
                    pass
            return

        except Exception as e:
            logger.error(
                "[RunPlaybookWorkflow] Unhandled error", error=str(e), exc_info=True
            )
            await context.abort(
                grpc.StatusCode.INTERNAL,
                f"Playbook workflow failed: {str(e)}",
            )

        finally:
            remove_task(thread_id)
            user_ctx.reset(user_token)

    async def ResumePlaybookWorkflow(self, request, context):
        """Resume an interrupted playbook with server-streaming step updates."""
        from src.flow_engine.legacy_runtime import (
            resume_playbook, register_task, remove_task,
        )

        username = request.user_context.username or request.user_context.user_id or "unknown"
        user_token = set_user_context(request.user_context.user_id, username)
        logger.info(
            "[ResumePlaybookWorkflow] Request received",
            playbook_id=request.playbook_id,
            thread_id=request.thread_id,
            task_id=request.task_id,
            username=username,
        )

        queue: asyncio.Queue = asyncio.Queue(
            maxsize=app_settings.PLAYBOOK_STREAM_QUEUE_MAXSIZE
        )
        bg_task: Optional[asyncio.Task] = None

        try:
            human_response = {
                "action": request.human_response.action,
                "message": request.human_response.message,
                "approved": request.human_response.approved,
                "reason": request.human_response.reason,
                "feedback": request.human_response.feedback,
            }
            bg_task = asyncio.create_task(
                resume_playbook(
                    playbook_id=request.playbook_id,
                    thread_id=request.thread_id,
                    human_response=human_response,
                    task_id=request.task_id,
                    queue=queue,
                    tasks=[_proto_task_to_dict(t) for t in request.tasks],
                    edges=[_proto_edge_to_dict(e) for e in request.edges],
                    interrupt_id=getattr(request, "interrupt_id", "") or "",
                )
            )
            register_task(request.thread_id, bg_task)

            async for chunk in self._stream_playbook_queue(
                queue, bg_task, request.thread_id
            ):
                yield chunk

        except asyncio.CancelledError:
            logger.info("[ResumePlaybookWorkflow] Client cancelled stream")
            if not bg_task.done():
                bg_task.cancel()
                try:
                    await bg_task
                except (asyncio.CancelledError, Exception):
                    pass
            return

        except Exception as e:
            logger.error(
                "[ResumePlaybookWorkflow] Unhandled error", error=str(e), exc_info=True
            )
            await context.abort(
                grpc.StatusCode.INTERNAL,
                f"Playbook workflow resume failed: {str(e)}",
            )

        finally:
            remove_task(request.thread_id)
            user_ctx.reset(user_token)

    async def StopPlaybookWorkflow(self, request, context):
        """Stop a running playbook workflow by thread_id."""
        from src.flow_engine.legacy_runtime import cancel_task

        thread_id = request.thread_id
        logger.info("[StopPlaybookWorkflow] Request received", thread_id=thread_id)

        try:
            cancelled = await cancel_task(thread_id)

            if cancelled:
                logger.info(
                    "[StopPlaybookWorkflow] Workflow stopped", thread_id=thread_id
                )
                return chatbot_pb2.StopPlaybookWorkflowResponse(
                    success=True,
                    message=f"Workflow {thread_id} stopped successfully.",
                )
            else:
                logger.warning(
                    "[StopPlaybookWorkflow] No active workflow found",
                    thread_id=thread_id,
                )
                return chatbot_pb2.StopPlaybookWorkflowResponse(
                    success=False,
                    message=f"No active workflow found for thread_id {thread_id}.",
                )

        except Exception as e:
            logger.error("[StopPlaybookWorkflow] Error", error=str(e))
            return chatbot_pb2.StopPlaybookWorkflowResponse(
                success=False,
                message=f"Error stopping workflow: {str(e)}",
            )

    async def _stream_playbook_queue(
        self,
        queue: asyncio.Queue,
        bg_task: asyncio.Task,
        thread_id: str = "",
    ) -> AsyncGenerator["chatbot_pb2.PlaybookStreamChunk", None]:
        """Drain *queue* and yield PlaybookStreamChunk messages.

        Follows the same asyncio.wait(FIRST_COMPLETED) pattern used by
        RunAgentTeam. Terminates when the sentinel ``None`` is received
        from the queue (put by workflow_service after completion).

        The *thread_id* is included in every yielded chunk so that the
        client can use it to call StopPlaybookWorkflow while the stream
        is still active.
        """
        while True:
            get_task = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait(
                [get_task, bg_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            if bg_task in done:
                if bg_task.cancelled():
                    logger.info(
                        "[_stream_playbook_queue] Background task was cancelled"
                    )
                    get_task.cancel()
                    raise asyncio.CancelledError()
                exc = bg_task.exception()
                if exc:
                    logger.error(
                        "[_stream_playbook_queue] Background task crashed",
                        error=str(exc),
                    )
                    get_task.cancel()
                    raise exc

            item = await get_task

            if item is None:
                # Sentinel: stream finished.
                yield chatbot_pb2.PlaybookStreamChunk(thread_id=thread_id)
                return

            if "step_update" in item:
                chunk = _safe_build_step_update_chunk(
                    item["step_update"],
                    stream_name="_stream_playbook_queue",
                    thread_id=thread_id,
                )
                if item["step_update"].get("interrupt"):
                    logger.debug(
                        "[servicer] yielding SUSPENDED chunk via gRPC",
                        task=item["step_update"].get("task_id"),
                        interrupt_type=item["step_update"]
                        .get("interrupt", {})
                        .get("type"),
                    )
                yield chunk
            else:
                logger.warning("[_stream_playbook_queue] Unknown queue item", item=item)

    async def RunStep(self, request, context):
        """Execute a single task with an agent."""
        from src.flow_engine.legacy_runtime import execute_step, execute_action_task
        import time
        from datetime import datetime

        task_id = request.task.id if request.task else "unknown"
        agent_name = request.agent.name if request.agent else "unknown"
        has_trigger_context = _has_struct_payload(getattr(request, "trigger_context", None))
        trigger_edge_count = sum(
            1 for edge in request.edges if (edge.source_id or "") == "__trigger__"
        )
        logger.info(
            "[RunStep] Request received",
            task_id=task_id,
            agent=agent_name,
            has_trigger_context=has_trigger_context,
            trigger_edge_count=trigger_edge_count,
        )
        username = request.user_context.username or request.user_context.user_id or "unknown"
        user_token = set_user_context(request.user_context.user_id, username)
        logger.info("[RunStep] Request received", task_id=task_id, agent=agent_name, username=username)

        try:
            task = _proto_task_to_dict(request.task)
            task["declared_output_ports"] = [
                str(p).strip()
                for p in getattr(request, "declared_output_ports", [])
                if str(p).strip()
            ]
            agent = _proto_agent_to_dict(request.agent)
            validated_replay = (
                _proto_validated_replay_to_dict(request.validated_replay)
                if getattr(request, "validated_replay", None)
                and request.validated_replay.task_id
                else None
            )
            logger.info(
                "[RunStep] Execution mode resolved",
                task_id=task_id,
                execution_mode=request.execution_mode or "live",
                has_validated_replay=bool(validated_replay),
                replay_id=(validated_replay or {}).get("replay_id"),
                replay_tool_calls=len(
                    (validated_replay or {}).get("tool_calls", []) or []
                ),
            )
            resolved_trigger_context = _struct_to_dict(request.trigger_context)
            if not resolved_trigger_context:
                resolved_trigger_context = _parse_trigger_context_fallback(request)
            logger.info(
                "*************** [RunStep] triggerContext received",
                triggerContext=resolved_trigger_context,
            )

            workspace_context = _proto_workspace_context(request.workspace_context)
            trigger_context = (
                _struct_to_dict(request.trigger_context)
                if _has_struct_payload(getattr(request, "trigger_context", None))
                else None
            )
            edges = [_proto_edge_to_dict(edge) for edge in request.edges] if request.edges else []
            upstream_results = [
                _proto_task_result_to_dict(item)
                for item in request.upstream_results
            ] if request.upstream_results else []
            node_inputs = [
                _proto_port_payload_to_dict(item)
                for item in getattr(request, "node_inputs", [])
            ]
            node_inputs_by_port = _build_node_inputs_by_port(node_inputs)
            artifacts_by_port = _merge_artifacts_by_port(
                _build_artifacts_by_port_from_results(upstream_results),
                _build_artifacts_by_port_from_payloads(node_inputs),
            )

            if str(task.get("execution_mode") or "agent").strip().lower() == "action":
                result = await execute_action_task(
                    task,
                    task_id=task_id,
                    start_time=time.time(),
                    started_at=datetime.utcnow().isoformat() + "Z",
                    workspace_context=workspace_context,
                    trigger_context=trigger_context,
                    edges=edges,
                    upstream_results=upstream_results,
                    artifacts_by_port=artifacts_by_port,
                    node_inputs_by_port=node_inputs_by_port,
                )
            else:
                result = await execute_step(
                    task=task,
                    agent=agent,
                    context_from_dependencies=request.context_from_dependencies,
                    workspace_context=workspace_context,
                    trigger_context=trigger_context,
                    edges=edges,
                    upstream_results=upstream_results,
                    artifacts_by_port=artifacts_by_port,
                    node_inputs_by_port=node_inputs_by_port,
                    execution_mode=request.execution_mode or "live",
                    validated_replay=validated_replay,
                    evaluation_user_id=request.user_context.username
                    or request.user_context.user_id
                    or "unknown",
                    prompt_overrides=dict(request.prompt_overrides)
                    if getattr(request, "prompt_overrides", None)
                    else {},
                    user_language=getattr(request, "user_language", None) or "en",
                )

            return _build_step_response(result)

        except Exception as e:
            logger.error("[RunStep] Unhandled error", error=str(e), exc_info=True)
            return chatbot_pb2.StepResponse(
                status="failed",
                result=chatbot_pb2.PlaybookTaskResult(
                    task_id=task_id,
                    status="failed",
                    error=str(e),
                ),
            )
        finally:
            user_ctx.reset(user_token)

    async def RunStepStream(self, request, context):
        """Execute a single task and stream step updates in realtime."""
        from src.flow_engine.legacy_runtime import execute_step, execute_action_task
        import time
        from datetime import datetime

        task_id = request.task.id if request.task else "unknown"
        agent_name = request.agent.name if request.agent else "unknown"
        username = request.user_context.username or request.user_context.user_id or "unknown"
        user_token = set_user_context(request.user_context.user_id, username)
        has_trigger_context = _has_struct_payload(getattr(request, "trigger_context", None))
        trigger_edge_count = sum(
            1 for edge in request.edges if (edge.source_id or "") == "__trigger__"
        )
        logger.info(
            "[RunStepStream] Request received",
            task_id=task_id,
            agent=agent_name,
            username=username,
            has_trigger_context=has_trigger_context,
            trigger_edge_count=trigger_edge_count,
        )

        queue: asyncio.Queue[dict] = asyncio.Queue(
            maxsize=app_settings.STEP_STREAM_QUEUE_MAXSIZE
        )

        async def on_progress(progress: Dict[str, Any]) -> None:
            await _put_progress_event(queue, progress)

        try:
            task = _proto_task_to_dict(request.task)
            task["declared_output_ports"] = [
                str(p).strip()
                for p in getattr(request, "declared_output_ports", [])
                if str(p).strip()
            ]
            agent = _proto_agent_to_dict(request.agent)
            validated_replay = (
                _proto_validated_replay_to_dict(request.validated_replay)
                if getattr(request, "validated_replay", None)
                and request.validated_replay.task_id
                else None
            )

            workspace_context = _proto_workspace_context(request.workspace_context)
            trigger_context = (
                _struct_to_dict(request.trigger_context)
                if _has_struct_payload(getattr(request, "trigger_context", None))
                else None
            )
            edges = [_proto_edge_to_dict(edge) for edge in request.edges] if request.edges else []
            upstream_results = [
                _proto_task_result_to_dict(item)
                for item in request.upstream_results
            ] if request.upstream_results else []
            node_inputs = [
                _proto_port_payload_to_dict(item)
                for item in getattr(request, "node_inputs", [])
            ]
            node_inputs_by_port = _build_node_inputs_by_port(node_inputs)
            artifacts_by_port = _merge_artifacts_by_port(
                _build_artifacts_by_port_from_results(upstream_results),
                _build_artifacts_by_port_from_payloads(node_inputs),
            )

            if str(task.get("execution_mode") or "agent").strip().lower() == "action":
                bg_task = asyncio.create_task(
                    execute_action_task(
                        task,
                        task_id=task_id,
                        start_time=time.time(),
                        started_at=datetime.utcnow().isoformat() + "Z",
                        workspace_context=workspace_context,
                        trigger_context=trigger_context,
                        edges=edges,
                        upstream_results=upstream_results,
                        artifacts_by_port=artifacts_by_port,
                        node_inputs_by_port=node_inputs_by_port,
                        on_progress=on_progress,
                    )
                )
            else:
                bg_task = asyncio.create_task(
                    execute_step(
                        task=task,
                        agent=agent,
                        context_from_dependencies=request.context_from_dependencies,
                        workspace_context=workspace_context,
                        trigger_context=trigger_context,
                        edges=edges,
                        upstream_results=upstream_results,
                        artifacts_by_port=artifacts_by_port,
                        node_inputs_by_port=node_inputs_by_port,
                        execution_mode=request.execution_mode or "live",
                        validated_replay=validated_replay,
                        evaluation_user_id=username,
                        on_progress=on_progress,
                    prompt_overrides=dict(request.prompt_overrides)
                    if getattr(request, "prompt_overrides", None)
                    else {},
                    user_language=getattr(request, "user_language", None) or "en",
                )
                )

            while True:
                if bg_task.done():
                    exception = bg_task.exception()
                    if exception:
                        raise exception
                    break

                try:
                    progress = await asyncio.wait_for(queue.get(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue

                if not progress:
                    continue

                step_update = {
                    "task_id": task_id,
                    "task_title": task.get("title", ""),
                    "status": progress.get("status", "in_progress"),
                }
                progress_result = _build_in_progress_result(task_id, progress)
                if progress_result is not None:
                    step_update["result"] = progress_result

                yield _safe_build_step_update_chunk(
                    step_update,
                    stream_name="RunStepStream",
                )

            result = await bg_task
            while not queue.empty():
                progress = await queue.get()
                if not progress:
                    continue
                drained_step_update = {
                    "task_id": task_id,
                    "task_title": task.get("title", ""),
                    "status": progress.get("status", "in_progress"),
                }
                progress_result = _build_in_progress_result(task_id, progress)
                if progress_result is not None:
                    drained_step_update["result"] = progress_result

                yield _safe_build_step_update_chunk(
                    drained_step_update,
                    stream_name="RunStepStream",
                )

            if result.get("status") == "suspended" and result.get("interrupt"):
                yield _safe_build_step_update_chunk(
                    {
                        "task_id": task_id,
                        "task_title": task.get("title", ""),
                        "status": "suspended",
                        "interrupt": result.get("interrupt"),
                    },
                    stream_name="RunStepStream",
                )
            else:
                step_result = result.get("result") or next(
                    iter((result.get("results") or {}).values()), None
                )
                yield _safe_build_step_update_chunk(
                    {
                        "task_id": task_id,
                        "task_title": task.get("title", ""),
                        "status": result.get("status", "completed"),
                        "result": step_result,
                    },
                    stream_name="RunStepStream",
                )

        except asyncio.CancelledError:
            logger.info("[RunStepStream] Client cancelled stream")
            if "bg_task" in locals() and not bg_task.done():
                bg_task.cancel()
                try:
                    await bg_task
                except Exception:
                    pass
            return

        except Exception as e:
            logger.error("[RunStepStream] Unhandled error", error=str(e), exc_info=True)
            yield _build_failed_step_update_chunk(
                task_id=task_id,
                task_title=task.get("title", "") if "task" in locals() else "",
                error=str(e),
            )
        finally:
            user_ctx.reset(user_token)

    async def ResumeStep(self, request, context):
        """Resume an interrupted step with human response."""
        from src.flow_engine.legacy_runtime import resume_step

        username = request.user_context.username or request.user_context.user_id or "unknown"
        user_token = set_user_context(request.user_context.user_id, username)
        logger.info(
            "[ResumeStep] Request received",
            thread_id=request.thread_id,
            task_id=request.task_id,
            username=username,
        )

        try:
            human_response = {
                "action": request.human_response.action,
                "message": request.human_response.message,
                "approved": request.human_response.approved,
                "reason": request.human_response.reason,
                "feedback": request.human_response.feedback,
            }
            result = await resume_step(
                thread_id=request.thread_id,
                human_response=human_response,
                task_id=request.task_id,
            )

            return _build_step_response(result)

        except Exception as e:
            logger.error("[ResumeStep] Unhandled error", error=str(e), exc_info=True)
            return chatbot_pb2.StepResponse(
                status="failed",
                result=chatbot_pb2.PlaybookTaskResult(
                    task_id=request.task_id,
                    status="failed",
                    error=str(e),
                ),
            )
        finally:
            user_ctx.reset(user_token)

    async def EvaluateSemanticMatch(self, request, context):
        """Evaluate semantic similarity for a playbook step over the gRPC channel."""
        logger.info(
            "[EvaluateSemanticMatch] Request received",
            task_title=request.task_title,
            baseline_length=len(request.baseline_output or ""),
            current_length=len(request.current_output or ""),
        )

        try:
            result = await evaluate_semantic_match(
                baseline_output=request.baseline_output,
                current_output=request.current_output,
                user_id=request.user_context.username
                or request.user_context.user_id
                or "unknown",
                task_title=request.task_title or "",
                task_description=request.task_description or "",
                baseline_tool_summaries=list(request.baseline_tool_summaries or []),
                current_tool_summaries=list(request.current_tool_summaries or []),
            )

            if result is None:
                return chatbot_pb2.EvaluateSemanticMatchResponse(has_match=False)

            return chatbot_pb2.EvaluateSemanticMatchResponse(
                has_match=True,
                semantic_match=chatbot_pb2.SemanticMatch(
                    match_score=int(result.get("match_score", 0) or 0),
                    semantic_similarity_score=int(
                        result.get("semantic_similarity_score", 0) or 0
                    ),
                    judge_score=int(result.get("judge_score", 0) or 0),
                    reason=str(result.get("reason", "") or ""),
                    missing_points=[
                        str(item) for item in (result.get("missing_points") or [])
                    ],
                    changed_points=[
                        str(item) for item in (result.get("changed_points") or [])
                    ],
                    model=str(result.get("model", "") or ""),
                    judge_used=bool(result.get("judge_used", False)),
                    evidence_consistency_score=int(
                        result.get("evidence_consistency_score", 0) or 0
                    ),
                ),
            )
        except Exception as e:
            logger.error(
                "[EvaluateSemanticMatch] Unhandled error", error=str(e), exc_info=True
            )
            await context.abort(
                grpc.StatusCode.INTERNAL, f"Semantic evaluation failed: {str(e)}"
            )


