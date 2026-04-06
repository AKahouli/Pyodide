"""gRPC service implementation for chatbot streaming."""

from __future__ import annotations

import grpc
import asyncio
import uuid
import json
import base64
import os
import mimetypes
import time
import tempfile
import shutil
from datetime import timedelta
from google.protobuf import json_format, struct_pb2

import litellm
import aiohttp
import aiofiles
from azure.storage.filedatalake.aio import DataLakeServiceClient
from typing import AsyncGenerator, Dict, Any, Optional, List
from structlog import get_logger
from src.config.settings import get_settings
from src.routers.authentification import create_access_token

# Import generated protobuf code (will be generated after running proto generation)
try:
    from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc
except ImportError:
    # Graceful fallback if proto hasn't been generated yet
    chatbot_pb2 = None
    chatbot_pb2_grpc = None

from src.smart_rag.core import AgentTeamService
from src.evaluation.semantic_match import evaluate_semantic_match
from src.schema.chatbot_schema import (
    RunAgentTeamRequest,
    AgentSuggestion
)

logger = get_logger(__name__)
app_settings = get_settings()


class ChatbotServicer(chatbot_pb2_grpc.ChatbotServiceServicer if chatbot_pb2_grpc else object):
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
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0
        logger.info("[gRPC] ChatbotServicer initialized (V2 only)")

    async def RunAgentTeam(
        self,
        request: "chatbot_pb2.RunAgentTeamRequest",
        context: grpc.aio.ServicerContext
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
        logger.info(f"[gRPC] RunAgentTeam request from user_id: {request.user_context.user_id}, username: {request.user_context.username}, conversation_id: {request.conversation_id}, agent_mode: {request.agent_mode}")

        # Create asyncio queue
        queue: asyncio.Queue[dict] = asyncio.Queue()

        try:
            # Convert protobuf request to internal V1 Pydantic model (for backward compatibility)
            internal_request = await self._convert_agent_team_request_v2(request)

            if internal_request.attached_files:
                asyncio.create_task(
                    self._index_attached_documents(
                        internal_request.attached_files,
                        request.conversation_id,
                    )
                )

            # Start background processing task
            bg_task = asyncio.create_task(
                self.agent_team_service.process_team_request(internal_request, queue)
            )

            # Stream chunks from queue
            while True:

                get_task = asyncio.create_task(queue.get())
                done, pending = await asyncio.wait(
                    [get_task, bg_task],
                    return_when=asyncio.FIRST_COMPLETED
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
                                    "content": "The model couldn't finish your answer due to an unexpected error."
                                }
                            },
                            "metadata": {
                                "message_id": request.conversation_id
                            }
                        }

                        # Convert error component to protobuf and yield it
                        error_chunk_pb = self._dict_to_stream_chunk(error_component)
                        yield error_chunk_pb

                        logger.info(f"[gRPC] Sent error component for exception - conversation_id: {request.conversation_id}")

                        # End stream gracefully
                        return
                    else:
                        # Background task completed successfully but queue still has items
                        # Let the get_task continue to drain remaining items
                        logger.debug(f"[gRPC] Background task completed, draining remaining queue items")

                # Get the chunk from the completed get_task
                chunk_dict = await get_task

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
                        file_json = chunk_dict.get("chunk", "{}")
                        file_data = json.loads(file_json)

                        # Convert to artifact component format
                        chunk_dict = {
                            "action": "add",
                            "component": {
                                "id": str(uuid.uuid4()),
                                "type": "artifact",
                                "data": {
                                    "filename": file_data.get("filename", ""),
                                    "file_path": file_data.get("azure_path", "")
                                }
                            },
                            "metadata": {
                                "message_id": chunk_dict.get("message_id", ""),
                                "agent_id": chunk_dict.get("agent_id", "")
                            }
                        }
                        logger.info(f"[gRPC] Converted old File chunk to artifact component - filename: {file_data.get('filename', 'unknown')}")
                    except Exception as e:
                        logger.error(f"[gRPC] Failed to convert File chunk to artifact: {e}")

                # Convert dict to protobuf
                chunk_pb = self._dict_to_stream_chunk(chunk_dict)

                # Yield protobuf message
                yield chunk_pb



            # Explicitly return after breaking to ensure stream ends
            logger.info(
                f"[gRPC] RunAgentTeam stream completed successfully - "
                f"conversation_id: {request.conversation_id}, user_id: {request.user_context.user_id}"
            )
            return

        except asyncio.CancelledError:
            # Client cancelled the stream (e.g., call.cancel() was called, or client disconnected)
            logger.info(
                f"[gRPC] Client cancelled stream - conversation_id: {request.conversation_id}, "
                f"user_id: {request.user_context.user_id}"
            )

            # Cancel the background task gracefully
            if not bg_task.done():
                bg_task.cancel()
                try:
                    await bg_task
                except asyncio.CancelledError:
                    logger.debug("[gRPC] Background task cancelled successfully")
                except Exception as cleanup_error:
                    logger.warning(f"[gRPC] Error during background task cleanup: {cleanup_error}")

            # Drain the queue to prevent memory leaks
            drained = 0
            try:
                while not queue.empty():
                    queue.get_nowait()
                    drained += 1
            except Exception as queue_error:
                logger.debug(f"[gRPC] Queue cleanup completed, drained {drained} items: {queue_error}")

            logger.info(f"[gRPC] Stream cancellation cleanup complete - drained {drained} queued chunks")

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
                        "title": "Validation Error" if isinstance(e, ValueError) else "Error",
                        "content": str(e)
                    }
                },
                "metadata": {
                    "message_id": request.conversation_id
                }
            }

            # Convert error component to protobuf and yield it
            error_chunk_pb = self._dict_to_stream_chunk(error_component)
            yield error_chunk_pb

            logger.info(f"[gRPC] Sent error component for validation error - conversation_id: {request.conversation_id}")

            # End stream gracefully
            return

    # ========== CONVERSION HELPERS ==========

    def _convert_agent(self, pb_agent: "chatbot_pb2.Agent") -> AgentSuggestion:
        """Convert protobuf Agent (V2) to internal V1 AgentSuggestion Pydantic model.

        V2 changes:
        - Renamed AgentSuggestion → Agent
        - Removed html field
        - Removed vectorstore_name field
        - brain_context is now repeated WorkspaceContext (extract all brain_ids and documents)
        - Removed brain_relations field
        - chatbot_name renamed to chatbot (with single model field containing full identifier)

        Args:
            pb_agent: Protobuf V2 Agent message

        Returns:
            AgentSuggestion: Internal V1 Pydantic model (for backward compatibility)
        """
        # Extract brain_ids and brain_documents from repeated WorkspaceContext
        brain_ids = []
        brain_documents = []
        if pb_agent.brain_context:
            for workspace in pb_agent.brain_context:
                if workspace.workspace_id:
                    brain_ids.append(workspace.workspace_id)
                for doc in workspace.workspace_documents:
                    brain_documents.append({
                        "_id": doc._id,
                        "filename": doc.filename if doc.filename else "",
                        "filepath": doc.filepath if doc.filepath else "",
                        "in_memory": doc.in_memory if doc.in_memory else False,
                        "language": doc.language if doc.language else "",
                        "indexing_token": doc.indexing_token if doc.indexing_token else 0,
                        "workspace_id": doc.workspace_id if doc.workspace_id else "",
                    })

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
                    "top_k": tool.top_k
                }
                for tool in pb_agent.tools
            ] if pb_agent.tools else None,
            html=False,  # V2 removed this, default to False
            vectorstore_name=app_settings.QDRANT_COLLECTION_NAME,  # Use environment variable
            brain_ids=brain_ids,
            brain_documents=brain_documents,
            brain_relations={"nodes": [], "relationships": []},  # V2 removed this, use empty
            chatbot_name={
                "provider": pb_agent.chatbot.model  # Full model identifier
            } if pb_agent.HasField("chatbot") else None,
            agent_params=dict(pb_agent.agent_params.params) if pb_agent.HasField("agent_params") else None,
            agent_type=pb_agent.agent_type if pb_agent.agent_type else None,
            save_memory=pb_agent.save_memory
        )

    async def _convert_agent_team_request_v2(self, pb_request: "chatbot_pb2.RunAgentTeamRequest") -> RunAgentTeamRequest:
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
        # Extract workspace IDs and documents from multiple workspace contexts
        brain_ids = []
        brain_documents = []

        # Iterate through all workspace contexts (now a repeated field)
        for workspace_ctx in pb_request.workspace_context:
            # Collect workspace IDs
            if workspace_ctx.workspace_id:
                brain_ids.append(workspace_ctx.workspace_id)

            # Convert V2 Document objects to V1 brain_documents format
            for doc in workspace_ctx.workspace_documents:
                brain_doc = {
                    "_id": doc._id,
                    "filename": doc.filename if doc.filename else "",
                    "filepath": doc.filepath if doc.filepath else "",
                    "in_memory": doc.in_memory if doc.in_memory else False,
                    "language": doc.language if doc.language else "",
                    "indexing_token": doc.indexing_token if doc.indexing_token else 0,
                    "workspace_id": doc.workspace_id if doc.workspace_id else ""
                }
                brain_documents.append(brain_doc)

        # Convert to None if empty (to match expected schema)
        brain_ids = brain_ids if brain_ids else None
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
                attached_documents.append({
                    "filepath": doc.filepath,
                    "filename": doc.filename,
                    "external_id": doc.external_id,
                    "workspace_id": doc.workspace_id,
                    "source": doc.source or doc.filepath,
                    "createdAt": getattr(doc, 'createdAt', None) or None,
                    "brain_type": doc.brain_type,
                    "lang_code": doc.lang_code,
                    "chunk_size": doc.chunk_size if doc.chunk_size else 4000,
                    "chunk_overlap": doc.chunk_overlap if doc.chunk_overlap else 100,
                    "enable_smart_chunk": doc.enable_smart_chunk,
                    "enable_extract_images": doc.enable_extract_images,
                    "sheet_name": doc.sheet_name if doc.sheet_name else None,
                    "in_memory": doc.in_memory,
                })

        # Download images from Datalake and convert to base64
        image_input = await self._download_and_encode_images(image_filepaths) if image_filepaths else []

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
            previous_attached.append({
                "_id": prev_doc._id,
                "filename": prev_doc.filename,
                "filepath": prev_doc.filepath,
                "in_memory": prev_doc.in_memory,
                "language": prev_doc.language if prev_doc.language else None,
                "workspace_id": prev_doc.workspace_id,
                "createdAt": getattr(prev_doc, 'createdAt', None) or None,
            })

        if previous_attached:
            logger.info(f"[gRPC] {len(previous_attached)} previous attached files for context")

        # ── Merge attached + previous attached into brain_documents for document tree ──
        if brain_documents is None:
            brain_documents = []
        existing_ids = {doc.get("_id") for doc in brain_documents if doc.get("_id")}

        for doc in attached_documents:
            doc_id = doc.get("external_id")
            if doc_id and doc_id not in existing_ids:
                brain_documents.append({
                    "_id": doc_id,
                    "filename": doc.get("filename", ""),
                    "filepath": doc.get("filepath", ""),
                    "in_memory": doc.get("in_memory", False),
                    "language": doc.get("lang_code", ""),
                    "workspace_id": doc.get("workspace_id", ""),
                })
                existing_ids.add(doc_id)

        for doc in previous_attached:
            doc_id = doc.get("_id")
            if doc_id and doc_id not in existing_ids:
                brain_documents.append(doc)
                existing_ids.add(doc_id)

        brain_documents = brain_documents if brain_documents else None

        # ── Ensure attached files' workspace_ids are in brain_ids for search filtering ──
        # Documents are indexed with brain_id = workspace_id, so the search filter
        # must include these IDs or Qdrant won't find them.
        if brain_ids is None:
            brain_ids = []

        for doc in attached_documents:
            ws_id = doc.get("workspace_id")
            if ws_id and ws_id not in brain_ids:
                brain_ids.append(ws_id)

        for doc in previous_attached:
            ws_id = doc.get("workspace_id")
            if ws_id and ws_id not in brain_ids:
                brain_ids.append(ws_id)

        brain_ids = brain_ids if brain_ids else None
        ################
        # Extract chatbot_name from manager agent (agent_type="manager")
        # Manager agent is required - client must always provide one
        manager_chatbot_name = None
        manager_prompt = "You are a manager agent that coordinates tasks between specialized agents."

        for agent in pb_request.agents:
            if agent.agent_type == "manager":
                # Found the manager agent - use its chatbot configuration and prompt
                if agent.HasField("chatbot"):
                    manager_chatbot_name = {
                        "provider": agent.chatbot.model  # Full model identifier
                    }
                if agent.prompt:
                    manager_prompt = agent.prompt
                break

        # Manager agent is required
        if not manager_chatbot_name:
            logger.error(f"No manager agent found in agents list for conversation {pb_request.conversation_id}")
            raise ValueError("No Manager agent was found")

        return RunAgentTeamRequest(
            user_id=pb_request.user_context.user_id,  # V2: user_context.user_id → V1: user_id
            session_id=pb_request.conversation_id,  # V2: conversation_id → V1: session_id
            message=pb_request.query,  # V2: query → V1: message
            image_input=image_input if image_input else None,
            attached_files=attached_documents if attached_documents else None,
            attached_images=attached_images_metadata if attached_images_metadata else None,
            previous_attached_files=previous_attached if previous_attached else None,
            manager_prompt=manager_prompt,  # Use manager agent's prompt if available
            chatbot_name=manager_chatbot_name,  # Use manager agent's chatbot or fallback
            agents=[
                self._convert_agent(agent)  # Use renamed method
                for agent in pb_request.agents
            ] if pb_request.agents else [],
            available_agents=[],  # V2 removed this field
            available_tools=[],   # V2 removed this field
            vectorstore_name=app_settings.QDRANT_COLLECTION_NAME,  # Use environment variable
            brain_ids=brain_ids,  # V2: workspace_context.workspace_id (singular) → V1: brain_ids (plural)
            brain_documents=brain_documents,
            brain_relations=None,  # V2 removed this field
            search_web=False,      # V2 removed this field, default to False
            agent_mode=pb_request.agent_mode
        )

    def _get_vectorstores_token(self) -> str:
        """Generate an access token using create_access_token directly.

        Uses a locally generated JWT (no network call), cached with 60s safety margin.
        Thread-safe for concurrent requests since token generation is atomic.

        Returns:
            Access token string.
        """
        if self._access_token and time.time() < self._token_expires_at - 60:
            return self._access_token

        expire_minutes = app_settings.ACCESS_TOKEN_EXPIRE_MINUTES
        self._access_token = create_access_token(
            data={"sub": app_settings.AUTH_USERNAME},
            expires_delta=timedelta(minutes=expire_minutes),
        )
        self._token_expires_at = time.time() + (expire_minutes * 60)
        return self._access_token

    async def _download_and_encode_images(self, filepaths: List[str]) -> List[Dict[str, str]]:
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
            logger.warning(f"[gRPC] Too many images ({len(filepaths)}), limiting to {app_settings.MAX_IMAGES}")
            filepaths = filepaths[:app_settings.MAX_IMAGES]

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
                            logger.warning(f"[gRPC] Image {filepath} too large ({len(raw_bytes)} bytes), skipping (max {app_settings.MAX_IMAGE_SIZE})")
                            continue

                        # Write to temp file and release raw_bytes from memory
                        tmp_path = os.path.join(tmp_dir, f"image_{idx}{os.path.splitext(filepath)[1]}")
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
                        logger.info(f"[gRPC] Downloaded and encoded image {idx}: {filepath} ({file_size} bytes)")

                    except Exception as e:
                        logger.error(f"[gRPC] Failed to download image {filepath}: {e}")

        except Exception as e:
            logger.error(f"[gRPC] Failed to connect to Azure Datalake for image download: {e}")

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        return image_input

    async def _index_attached_documents(self, documents: List[Dict[str, Any]], conversation_id: str) -> None:
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
            logger.error("[gRPC] VECTORSTORES_API_URL not configured - skipping document indexing")
            return

        token = self._get_vectorstores_token()

        index_url = f"{vectorstores_url.rstrip('/')}/vectorstores/indexDocumentFromAzureDatalake"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "correlation-id": conversation_id,
        }

        logger.info(f"[gRPC] Indexing {len(documents)} attached documents for conversation {conversation_id}")

        timeout = aiohttp.ClientTimeout(total=30)

        async def _index_single(session: aiohttp.ClientSession, doc: Dict[str, Any]) -> bool:
            """Index a single document. Returns True on success, False on failure."""
            payload = {
                "filepath": doc["filepath"],
                "brain_id": doc["workspace_id"],
                "external_id": doc.get("external_id") or doc["filepath"],
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
                async with session.post(index_url, json=payload, headers=headers) as resp:
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
                logger.error(f"[gRPC] Error indexing document: filepath={doc['filepath']}, error={e}")
                return False

        async with aiohttp.ClientSession(timeout=timeout) as session:
            results = await asyncio.gather(
                *[_index_single(session, doc) for doc in documents],
                return_exceptions=True,
            )

        succeeded = sum(1 for r in results if r is True)
        failed = len(results) - succeeded
        logger.info(f"[gRPC] Indexing complete: {succeeded}/{len(documents)} succeeded, {failed} failed")

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
            "error": chatbot_pb2.ERROR
        }
        return status_map.get(status_str.lower(), chatbot_pb2.PENDING)

    def _dict_to_stream_chunk(self, chunk_dict: Dict[str, Any]) -> "chatbot_pb2.StreamChunk":
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
                    agent_id=metadata.get("agent_id", "")
                ),
                usage=chatbot_pb2.Usage(
                    input_tokens=usage_data.get("input_tokens", 0),
                    output_tokens=usage_data.get("output_tokens", 0),
                    total_tokens=usage_data.get("total_tokens", 0),
                    model=usage_data.get("model", "")
                )
            )

        # Check if this is the new component-based format
        if "action" in chunk_dict and "component" in chunk_dict and "metadata" in chunk_dict:
            # New format
            component_dict = chunk_dict["component"]
            metadata = chunk_dict["metadata"]

            # Build the component with the appropriate oneof field
            component = self._build_component(
                component_id=component_dict.get("id", ""),
                component_type=component_dict.get("type", "text"),
                component_data=component_dict.get("data", {})
            )

            return chatbot_pb2.StreamChunk(
                action=chunk_dict["action"],
                component=component,
                metadata=chatbot_pb2.Metadata(
                    message_id=metadata.get("message_id", ""),
                    agent_id=metadata.get("agent_id", "")
                )
            )
        else:
            # Old format (backward compatibility) - convert to new format
            component_type = self._map_content_type_to_component_type(chunk_dict.get("content_type", "chunk"))
            component_data = {"content": chunk_dict.get("chunk", "")}

            component = self._build_component(
                component_id=chunk_dict.get("chunk_id", ""),
                component_type=component_type,
                component_data=component_data
            )

            return chatbot_pb2.StreamChunk(
                action="add",  # Default to add for old format
                component=component,
                metadata=chatbot_pb2.Metadata(
                    message_id=chunk_dict.get("message_id", ""),
                    agent_id=chunk_dict.get("agent_id", "")
                )
            )

    def _build_component(self, component_id: str, component_type: str, component_data: Dict[str, Any]) -> "chatbot_pb2.Component":
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
                output_port_id=component_data.get("output_port_id") or component_data.get("outputPortId", ""),
            )
        elif component_type == "code":
            component_kwargs["code"] = chatbot_pb2.CodeComponent(
                content=component_data.get("content", ""),
                language=component_data.get("language", ""),
                filename=component_data.get("filename", ""),
                output_port_id=component_data.get("output_port_id") or component_data.get("outputPortId", ""),
            )
        elif component_type == "reasoning":
            component_kwargs["reasoning"] = chatbot_pb2.ReasoningComponent(
                content=component_data.get("content", "")
            )
        elif component_type == "plan":
            # Build PlanComponent with PlanStep objects
            steps = []
            for step_data in component_data.get("steps", []):
                steps.append(chatbot_pb2.PlanStep(
                    task=step_data.get("task", ""),
                    agent=step_data.get("agent", ""),
                    status=self._status_to_enum(step_data.get("status", "pending"))
                ))
            component_kwargs["plan"] = chatbot_pb2.PlanComponent(
                title=component_data.get("title", ""),
                steps=steps,
                status=self._status_to_enum(component_data.get("status", "pending"))
            )
        elif component_type == "queue":
            items = []
            for item_data in component_data.get("items", []):
                items.append(chatbot_pb2.QueueItem(
                    id=item_data.get("id", ""),
                    title=item_data.get("title", ""),
                    status=item_data.get("status", "pending")
                ))
            component_kwargs["queue"] = chatbot_pb2.QueueComponent(
                title=component_data.get("title", ""),
                items=items
            )
        elif component_type == "chart":
            component_kwargs["chart"] = chatbot_pb2.ChartComponent(
                title=component_data.get("title", ""),
                data=component_data.get("data", ""),
                config=component_data.get("config", ""),
                xAxisKey=component_data.get("xAxisKey", ""),
                series=component_data.get("series", "")
            )
        elif component_type == "task":
            # Build TaskComponent with items array
            items = []
            for item_data in component_data.get("items", []):
                items.append(chatbot_pb2.TaskItem(
                    text=item_data.get("text", "")
                ))
            component_kwargs["task"] = chatbot_pb2.TaskComponent(
                title=component_data.get("title", ""),
                items=items,
                status=component_data.get("status", "in_progress")
            )
        elif component_type == "error":
            component_kwargs["error"] = chatbot_pb2.ErrorComponent(
                title=component_data.get("title", "Error"),
                content=component_data.get("content", "")
            )
        elif component_type == "sources":
            # Build SourcesComponent with sources array
            source_items = []
            for source_data in component_data.get("sources", []):
                source_items.append(chatbot_pb2.SourceItem(
                    title=source_data.get("title", ""),
                    url=source_data.get("url", "")
                ))
            component_kwargs["sources"] = chatbot_pb2.SourcesComponent(
                sources=source_items
            )
        elif component_type == "sandbox":
            component_kwargs["sandbox"] = chatbot_pb2.SandboxComponent(
                code=component_data.get("code", ""),
                output=component_data.get("output", ""),
                error=component_data.get("error", ""),
                output_available=component_data.get("output_available", False)
            )
        elif component_type == "web_preview":
            component_kwargs["web_preview"] = chatbot_pb2.WebPreviewComponent(
                content=component_data.get("content", "")
            )
        elif component_type == "artifact":
            component_kwargs["artifact"] = chatbot_pb2.ArtifactComponent(
                file_path=component_data.get("file_path", ""),
                filename=component_data.get("filename", ""),
                output_port_id=component_data.get("output_port_id") or component_data.get("outputPortId", ""),
                artifact_kind=component_data.get("artifact_kind") or component_data.get("artifactKind", ""),
                mime_type=component_data.get("mime_type") or component_data.get("mimeType", ""),
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
                        external_id=str(text_source_data.get("external_id", "")),
                        page=str(text_source_data.get("page", "")),
                        page_content=str(text_source_data.get("page_content", "")),
                        workspace_id=str(text_source_data.get("workspace_id", "")),
                        reference=str(text_source_data.get("reference", ""))
                    )
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
                        external_id=str(image_source_data.get("external_id", "")),
                        workspace_id=str(image_source_data.get("workspace_id", "")),
                        height=str(image_source_data.get("height", "")),
                        width=str(image_source_data.get("width", "")),
                        reference=str(image_source_data.get("reference", ""))
                    )
                )

            else:
                # Fallback to empty citation if no source data
                component_kwargs["citation"] = chatbot_pb2.CitationComponent(
                    parent_id=str(parent_id) if parent_id else ""
                )
                logger.warning(f"[gRPC] Sending CITATION component to client: EMPTY (no source data)")
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
            "suggestions": "text"
        }
        return mapping.get(content_type, "text")

    async def GenerateConversationName(
        self,
        request: "chatbot_pb2.GenerateConversationNameRequest",
        context: grpc.aio.ServicerContext
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
            logger.info(f"[gRPC] Generate conversation name request - model: {request.model}")

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
                temperature=0.7,
                max_tokens=50
            )

            # Extract the generated name
            conversation_name = response.choices[0].message.content.strip().strip('"').strip("'")

            logger.info(f"[gRPC] Generated conversation name: '{conversation_name}' for query: '{request.query[:100]}...'")

            # Return response
            return chatbot_pb2.GenerateConversationNameResponse(
                conversation_name=conversation_name
            )

        except Exception as exc:
            logger.error(f"[gRPC] Error in GenerateConversationName: {str(exc)}")
            await context.abort(
                grpc.StatusCode.INTERNAL,
                f"Failed to generate conversation name: {str(exc)}"
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
        try:
            logger.info(
                "[GeneratePlaybook] Request received",
                model=request.model,
                agent_count=len(request.available_agents),
                has_existing=request.HasField("existing_playbook"),
            )

            # 1. Extract agent info
            agents_info = []
            for agent in request.available_agents:
                tool_names = [t.name for t in agent.tools] if agent.tools else []
                agents_info.append({
                    "id": agent.id,
                    "name": agent.name,
                    "description": agent.description,
                    "agent_type": agent.agent_type,
                    "tools": tool_names,
                })

            # 2. Extract workspace context
            workspace_info = []
            for wc in request.workspace_context:
                doc_names = [d.filename for d in wc.workspace_documents]
                workspace_info.append({
                    "workspace_id": wc.workspace_id,
                    "documents": doc_names,
                })

            # 3. Extract existing playbook (if present)
            existing_playbook_json = None
            if request.HasField("existing_playbook"):
                ep = request.existing_playbook
                existing_nodes = [
                    {
                        "id": n.id, "title": n.title, "description": n.description,
                        "assigned_agent_id": n.assigned_agent_id,
                        "execution_order": n.execution_order,
                        "x": n.x, "y": n.y,
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
                agents_info, workspace_info, existing_playbook_json
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
                max_tokens=4096,
                response_format={"type": "json_object"},
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
                logger.error("[GeneratePlaybook] JSON parse error", error=str(exc), raw=raw[:500])
                await context.abort(
                    grpc.StatusCode.INTERNAL,
                    f"LLM returned invalid JSON: {exc}",
                )

            # 7. Convert to proto response
            nodes = []
            for n in data.get("nodes", []):
                nodes.append(chatbot_pb2.PlaybookNodeConfig(
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
                ))

            edges = []
            for e in data.get("edges", []):
                edges.append(chatbot_pb2.PlaybookEdgeConfig(
                    source_id=str(e.get("source_id", "")),
                    target_id=str(e.get("target_id", "")),
                ))

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
            logger.error("[GeneratePlaybook] Unhandled error", error=str(exc), exc_info=True)
            await context.abort(
                grpc.StatusCode.INTERNAL,
                f"Failed to generate playbook: {exc}",
            )

    @staticmethod
    def _build_generate_playbook_prompt(
        agents_info: list,
        workspace_info: list,
        existing_playbook_json: str | None,
    ) -> str:
        """Build the system prompt for playbook generation."""

        agents_block = json.dumps(agents_info, indent=2)
        workspace_block = json.dumps(workspace_info, indent=2)

        prompt = f"""Tu es un architecte de workflows. Ton role est de generer un playbook sous forme de DAG (Directed Acyclic Graph).

## Format de sortie attendu (JSON strict)
{{
  "nodes": [
    {{
      "id": "step_1",
      "title": "Titre court de l'etape",
      "description": "Description detaillee de ce que l'agent doit faire",
      "assigned_agent_id": "agent_id_here",
      "execution_order": 1,
      "x": 0,
      "y": 0,
      "interrupt_before": false,
      "interrupt_after": false,
      "allow_clarification": false,
      "clarification_prompt": "",
      "max_clarifications": 0,
      "input_keys": [],
      "output_key": "step_1_output"
    }}
  ],
  "edges": [
    {{
      "source_id": "step_1",
      "target_id": "step_2"
    }}
  ]
}}

## Regles de layout (positions x, y) — TRES IMPORTANT
Les coordonnees x et y determinent la position visuelle de chaque node dans l'interface graphique.
Tu DOIS calculer x et y pour CHAQUE node selon la structure du DAG.

### Principe
- x = position horizontale (colonnes). Chaque colonne parallele est espacee de 300.
- y = position verticale (lignes). Chaque ligne successive est espacee de 200.
- Le premier node commence toujours a x=0, y=0.

### Cas 1 : Workflow sequentiel (A -> B -> C)
Tous les nodes sont sur la meme colonne (x=0), avec y qui augmente :
  A: x=0, y=0
  B: x=0, y=200
  C: x=0, y=400

### Cas 2 : Branches paralleles (A -> B, A -> C, puis B -> D, C -> D)
Le node source est seul, puis les branches paralleles se repartissent sur des colonnes :
  A: x=0,   y=0       (source unique)
  B: x=0,   y=200     (branche gauche)
  C: x=300, y=200     (branche droite, decalee en x)
  D: x=0,   y=400     (convergence, retour a x=0)

### Cas 3 : 3 branches paralleles (A -> B, A -> C, A -> D, puis B/C/D -> E)
  A: x=0,   y=0
  B: x=0,   y=200
  C: x=300, y=200
  D: x=600, y=200
  E: x=0,   y=400     (convergence)

### Regle de centrage
Pour N branches paralleles, les positions x sont : 0, 300, 600, 900, ...
Le node de convergence revient a x=0.

## Regles d'assignation d'agents
- Chaque node DOIT avoir un assigned_agent_id correspondant a un agent disponible
- Choisis l'agent le plus pertinent en fonction de sa description et de ses tools
- Si un seul agent est disponible, assigne-le a tous les nodes

## Regles generales
- Les ids des nodes doivent etre uniques (ex: "step_1", "step_2", ...)
- Les edges doivent former un DAG valide (pas de cycles)
- output_key de chaque node = "<node_id>_output"
- input_keys d'un node = les output_keys des nodes dont il depend
- Le premier node n'a pas d'input_keys

## Agents disponibles
{agents_block}

## Workspace context
{workspace_block}"""

        if existing_playbook_json:
            prompt += f"""

## Mode modification — IMPORTANT
Tu dois modifier le playbook existant ci-dessous en fonction de la demande de l'utilisateur.

### Regles de modification des coordonnees
- Les nodes existants qui ne sont PAS modifies gardent leurs coordonnees x, y actuelles.
- Si tu ajoutes un nouveau node entre deux nodes existants, tu dois recalculer les coordonnees y de tous les nodes en dessous pour faire de la place (+200 en y).
- Si tu supprimes un node, tu dois recalculer les coordonnees y des nodes en dessous pour combler le trou (-200 en y).
- Si tu ajoutes une branche parallele, decale les nouveaux nodes en x (+300 par branche).
- Retourne TOUJOURS le playbook complet (nodes modifies + non modifies) avec les coordonnees mises a jour.

### Playbook existant
{existing_playbook_json}"""

        return prompt

    # ========== PLAYBOOK / LANGGRAPH RPCs ==========

    async def RunPlaybookWorkflow(self, request, context):
        """Execute a playbook workflow with server-streaming step updates."""
        from src.langgraph_engine.workflow_service import run_playbook
        from src.langgraph_engine.playbook_queue import register_task, remove_task

        logger.info(
            "[RunPlaybookWorkflow] Request received",
            playbook_id=request.playbook_id,
            task_count=len(request.tasks),
            agent_count=len(request.agents),
            edge_count=len(request.edges),
            execution_mode=request.execution_mode or "live",
            validated_replay_count=len(request.validated_replays),
            validated_replay_task_ids=[replay.task_id for replay in request.validated_replays],
        )

        queue: asyncio.Queue = asyncio.Queue()
        thread_id = f"{request.playbook_id}_{uuid.uuid4().hex[:8]}"

        try:
            tasks = [_proto_task_to_dict(t) for t in request.tasks]
            agents = {a.id: _proto_agent_to_dict(a) for a in request.agents}
            edges = [_proto_edge_to_dict(e) for e in request.edges]

            bg_task = asyncio.create_task(
                run_playbook(
                    playbook_id=request.playbook_id,
                    tasks=tasks,
                    agents=agents,
                    edges=edges,
                    query=request.query,
                    workspace_context=_proto_workspace_context(request.workspace_context),
                    queue=queue,
                    thread_id=thread_id,
                    execution_mode=request.execution_mode or "live",
                    validated_replays_by_task={
                        replay.task_id: _proto_validated_replay_to_dict(replay)
                        for replay in request.validated_replays
                    } if request.validated_replays else {},
                    evaluation_user_id=request.user_context.username or request.user_context.user_id or "unknown",
                    step_execution_modes=dict(request.step_execution_modes) if request.step_execution_modes else {},
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
            logger.error("[RunPlaybookWorkflow] Unhandled error", error=str(e), exc_info=True)
            yield chatbot_pb2.PlaybookStreamChunk(
                thread_id="",
            )

        finally:
            remove_task(thread_id)

    async def ResumePlaybookWorkflow(self, request, context):
        """Resume an interrupted playbook with server-streaming step updates."""
        from src.langgraph_engine.workflow_service import resume_playbook
        from src.langgraph_engine.playbook_queue import register_task, remove_task

        logger.info(
            "[ResumePlaybookWorkflow] Request received",
            playbook_id=request.playbook_id,
            thread_id=request.thread_id,
            task_id=request.task_id,
        )

        queue: asyncio.Queue = asyncio.Queue()

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
                )
            )
            register_task(request.thread_id, bg_task)

            async for chunk in self._stream_playbook_queue(queue, bg_task, request.thread_id):
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
            logger.error("[ResumePlaybookWorkflow] Unhandled error", error=str(e), exc_info=True)
            yield chatbot_pb2.PlaybookStreamChunk(
                thread_id=request.thread_id,
            )

        finally:
            remove_task(request.thread_id)

    async def StopPlaybookWorkflow(self, request, context):
        """Stop a running playbook workflow by thread_id."""
        from src.langgraph_engine.playbook_queue import cancel_task

        thread_id = request.thread_id
        logger.info("[StopPlaybookWorkflow] Request received", thread_id=thread_id)

        try:
            cancelled = await cancel_task(thread_id)

            if cancelled:
                logger.info("[StopPlaybookWorkflow] Workflow stopped", thread_id=thread_id)
                return chatbot_pb2.StopPlaybookWorkflowResponse(
                    success=True,
                    message=f"Workflow {thread_id} stopped successfully.",
                )
            else:
                logger.warning("[StopPlaybookWorkflow] No active workflow found", thread_id=thread_id)
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
                    logger.info("[_stream_playbook_queue] Background task was cancelled")
                    get_task.cancel()
                    yield chatbot_pb2.PlaybookStreamChunk(thread_id=thread_id)
                    return
                exc = bg_task.exception()
                if exc:
                    logger.error("[_stream_playbook_queue] Background task crashed", error=str(exc))
                    get_task.cancel()
                    yield chatbot_pb2.PlaybookStreamChunk(thread_id=thread_id)
                    return

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
                    logger.debug("[servicer] yielding SUSPENDED chunk via gRPC", task=item["step_update"].get("task_id"), interrupt_type=item["step_update"].get("interrupt", {}).get("type"))
                yield chunk
            else:
                logger.warning("[_stream_playbook_queue] Unknown queue item", item=item)

    async def RunStep(self, request, context):
        """Execute a single task with an agent."""
        from src.langgraph_engine.step_executor import execute_step

        task_id = request.task.id if request.task else "unknown"
        agent_name = request.agent.name if request.agent else "unknown"
        logger.info("[RunStep] Request received", task_id=task_id, agent=agent_name)

        try:
            task = _proto_task_to_dict(request.task)
            agent = _proto_agent_to_dict(request.agent)
            validated_replay = _proto_validated_replay_to_dict(request.validated_replay) \
                if getattr(request, "validated_replay", None) and request.validated_replay.task_id \
                else None
            logger.info(
                "[RunStep] Execution mode resolved",
                task_id=task_id,
                execution_mode=request.execution_mode or "live",
                has_validated_replay=bool(validated_replay),
                replay_id=(validated_replay or {}).get("replay_id"),
                replay_tool_calls=len((validated_replay or {}).get("tool_calls", []) or []),
            )

            result = await execute_step(
                task=task,
                agent=agent,
                context_from_dependencies=request.context_from_dependencies,
                workspace_context=_proto_workspace_context(request.workspace_context),
                edges=[_proto_edge_to_dict(edge) for edge in request.edges] if request.edges else [],
                upstream_results=[_proto_task_result_to_dict(item) for item in request.upstream_results] if request.upstream_results else [],
                execution_mode=request.execution_mode or "live",
                validated_replay=validated_replay,
                evaluation_user_id=request.user_context.username or request.user_context.user_id or "unknown",
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

    async def RunStepStream(self, request, context):
        """Execute a single task and stream step updates in realtime."""
        from src.langgraph_engine.step_executor import execute_step

        task_id = request.task.id if request.task else "unknown"
        agent_name = request.agent.name if request.agent else "unknown"
        logger.info("[RunStepStream] Request received", task_id=task_id, agent=agent_name)

        queue: asyncio.Queue[dict] = asyncio.Queue()

        async def on_progress(progress: Dict[str, Any]) -> None:
            await queue.put(progress)

        try:
            task = _proto_task_to_dict(request.task)
            agent = _proto_agent_to_dict(request.agent)
            validated_replay = _proto_validated_replay_to_dict(request.validated_replay) \
                if getattr(request, "validated_replay", None) and request.validated_replay.task_id \
                else None

            bg_task = asyncio.create_task(
                execute_step(
                    task=task,
                    agent=agent,
                    context_from_dependencies=request.context_from_dependencies,
                    workspace_context=_proto_workspace_context(request.workspace_context),
                    edges=[_proto_edge_to_dict(edge) for edge in request.edges] if request.edges else [],
                    upstream_results=[_proto_task_result_to_dict(item) for item in request.upstream_results] if request.upstream_results else [],
                    execution_mode=request.execution_mode or "live",
                    validated_replay=validated_replay,
                    evaluation_user_id=request.user_context.username or request.user_context.user_id or "unknown",
                    on_progress=on_progress,
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
                yield _safe_build_step_update_chunk({
                    "task_id": task_id,
                    "task_title": task.get("title", ""),
                    "status": "suspended",
                    "interrupt": result.get("interrupt"),
                }, stream_name="RunStepStream")
            else:
                yield _safe_build_step_update_chunk({
                    "task_id": task_id,
                    "task_title": task.get("title", ""),
                    "status": result.get("status", "completed"),
                    "result": result.get("result"),
                }, stream_name="RunStepStream")

        except asyncio.CancelledError:
            logger.info("[RunStepStream] Client cancelled stream")
            if 'bg_task' in locals() and not bg_task.done():
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
                task_title=task.get("title", "") if 'task' in locals() else "",
                error=str(e),
            )

    async def ResumeStep(self, request, context):
        """Resume an interrupted step with human response."""
        from src.langgraph_engine.step_executor import resume_step

        logger.info(
            "[ResumeStep] Request received",
            thread_id=request.thread_id,
            task_id=request.task_id,
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
                user_id=request.user_context.username or request.user_context.user_id or "unknown",
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
                    semantic_similarity_score=int(result.get("semantic_similarity_score", 0) or 0),
                    judge_score=int(result.get("judge_score", 0) or 0),
                    reason=str(result.get("reason", "") or ""),
                    missing_points=[str(item) for item in (result.get("missing_points") or [])],
                    changed_points=[str(item) for item in (result.get("changed_points") or [])],
                    model=str(result.get("model", "") or ""),
                    judge_used=bool(result.get("judge_used", False)),
                    evidence_consistency_score=int(result.get("evidence_consistency_score", 0) or 0),
                ),
            )
        except Exception as e:
            logger.error("[EvaluateSemanticMatch] Unhandled error", error=str(e), exc_info=True)
            await context.abort(grpc.StatusCode.INTERNAL, f"Semantic evaluation failed: {str(e)}")


# === Proto conversion helpers (playbook/langgraph) ===

def _proto_task_to_dict(proto_task) -> dict:
    """Convert a PlaybookTaskConfig proto message to a TaskConfig dict."""
    result = {
        "id": proto_task.id,
        "title": proto_task.title,
        "description": proto_task.description,
        "assigned_agent_id": proto_task.assigned_agent_id,
        "execution_order": proto_task.execution_order,
        "interrupt_before": proto_task.interrupt_before,
        "interrupt_after": proto_task.interrupt_after,
        "allow_clarification": proto_task.allow_clarification,
        "clarification_prompt": proto_task.clarification_prompt or None,
        "max_clarifications": proto_task.max_clarifications or 3,
        "input_keys": list(proto_task.input_keys) if proto_task.input_keys else None,
        "output_key": proto_task.output_key or None,
        "input_files": list(proto_task.input_files) if proto_task.input_files else None,
        "input_files_by_port": [
            {"port_id": b.port_id, "document_ids": list(b.document_ids) if b.document_ids else []}
            for b in proto_task.input_files_by_port
        ] if proto_task.input_files_by_port else None,
        "task_type": proto_task.task_type or None,
        "input_ports": [
            {"id": p.id, "name": p.name, "artifact_kind": p.artifact_kind, "required": p.required, "description": p.description or None}
            for p in proto_task.input_ports
        ] if proto_task.input_ports else [],
        "output_ports": [
            {"id": p.id, "name": p.name, "artifact_kind": p.artifact_kind, "description": p.description or None}
            for p in proto_task.output_ports
        ] if proto_task.output_ports else [],
    }
    return result


def _proto_agent_to_dict(proto_agent) -> dict:
    """Convert a LangGraphAgent proto message to an AgentConfig dict."""
    tools = [
        {
            "name": tool.name,
            "description": tool.description,
            "prompt": tool.prompt,
            "top_k": tool.top_k,
        }
        for tool in proto_agent.tools
    ] if proto_agent.tools else []

    # Extract brain_context (brain_ids + brain_documents)
    brain_ids = []
    brain_documents = []
    if proto_agent.brain_context:
        for workspace in proto_agent.brain_context:
            if workspace.workspace_id:
                brain_ids.append(workspace.workspace_id)
            for doc in workspace.workspace_documents:
                brain_documents.append({
                    "_id": doc._id,
                    "filename": doc.filename or "",
                    "filepath": doc.filepath or "",
                    "workspace_id": doc.workspace_id or "",
                })

    # Extract agent_params
    agent_params = dict(proto_agent.agent_params.params) if proto_agent.agent_params.params else {}

    return {
        "id": proto_agent.id,
        "name": proto_agent.name,
        "description": proto_agent.description,
        "prompt": proto_agent.prompt,
        "instructions": proto_agent.prompt,
        "tools": tools,
        "model": proto_agent.chatbot.model if proto_agent.HasField("chatbot") else None,
        "brain_ids": brain_ids or None,
        "brain_documents": brain_documents or None,
        "agent_params": agent_params,
        "agent_type": proto_agent.agent_type or None,
    }


def _proto_edge_to_dict(proto_edge) -> dict:
    """Convert a PlaybookEdgeConfig proto message to an EdgeConfig dict."""
    return {
        "source_id": proto_edge.source_id,
        "target_id": proto_edge.target_id,
        "source_output_port_id": proto_edge.source_output_port_id or "default",
        "target_input_port_id": proto_edge.target_input_port_id or "default",
    }


def _proto_task_result_to_dict(proto_result) -> dict:
    return {
        "task_id": proto_result.task_id,
        "status": proto_result.status,
        "error": proto_result.error,
        "duration_ms": proto_result.duration_ms,
        "artifacts": [
            {
                "port_id": artifact.port_id,
                "artifact_kind": artifact.artifact_kind,
                "content": artifact.content,
                "url": artifact.url,
                "filename": artifact.filename,
                "mime_type": artifact.mime_type,
                "size": artifact.size,
            }
            for artifact in proto_result.artifacts
        ] if proto_result.artifacts else [],
    }


def _proto_workspace_context(proto_wc_list) -> list:
    """Convert repeated WorkspaceContext proto messages to a list of dicts."""
    if not proto_wc_list:
        return []
    result = []
    for wc in proto_wc_list:
        result.append({
            "workspace_id": wc.workspace_id,
            "documents": [
                {
                    "id": d._id,
                    "filename": d.filename,
                    "filepath": d.filepath,
                    "workspace_id": d.workspace_id,
                }
                for d in wc.workspace_documents
            ],
        })
    return result


def _proto_validated_replay_to_dict(proto_replay) -> dict:
    """Convert a ValidatedTaskReplay proto message to a replay dict."""
    def _normalize_struct_like(value):
        if isinstance(value, list):
            return [_normalize_struct_like(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "stringValue" in value:
            return value["stringValue"]
        if "numberValue" in value:
            return value["numberValue"]
        if "boolValue" in value:
            return value["boolValue"]
        if "nullValue" in value:
            return None
        if "listValue" in value:
            list_value = value.get("listValue", {})
            values = list_value.get("values", []) if isinstance(list_value, dict) else []
            return [_normalize_struct_like(item) for item in values]
        if "structValue" in value:
            return _normalize_struct_like(value.get("structValue", {}))
        if set(value.keys()) == {"fields"}:
            return {
                key: _normalize_struct_like(field_value)
                for key, field_value in value.get("fields", {}).items()
            }
        return {key: _normalize_struct_like(item) for key, item in value.items()}

    return {
        "replay_id": proto_replay.replay_id,
        "task_id": proto_replay.task_id,
        "validation_version": proto_replay.validation_version,
        "mode": proto_replay.mode,
        "reference_output": proto_replay.reference_output or "",
        "preserve_output_format": bool(getattr(proto_replay, "preserve_output_format", False)),
        "output_format_guide": getattr(proto_replay, "output_format_guide", "") or "",
        "tool_calls": [
            {
                "call_index": tc.call_index,
                "tool_name": tc.tool_name,
                "args": _normalize_struct_like(json_format.MessageToDict(tc.args)) if tc.args else {},
                "output_summary": tc.output_summary or "",
            }
            for tc in proto_replay.tool_calls
        ],
    }


def _dict_to_proto_component(comp_dict: dict) -> chatbot_pb2.Component:
    """Convert a component dict to a proto Component message.

    Args:
        comp_dict: Dict with 'type' and 'data' keys.

    Returns:
        Component protobuf message.
    """
    comp_type = comp_dict.get("type")
    data = comp_dict.get("data", {})
    comp_id = comp_dict.get("id", str(uuid.uuid4()))

    component = chatbot_pb2.Component(id=comp_id)

    if comp_type == "citation":
        citation_kwargs = {"parent_id": str(data.get("parent_id", ""))}

        if "text_source" in data:
            ts = data["text_source"]
            citation_kwargs["text_source"] = chatbot_pb2.TextSourceData(
                type=str(ts.get("type", "text")),
                source=str(ts.get("source", "")),
                external_id=str(ts.get("external_id", "")),
                page=str(ts.get("page", "")),
                page_content=str(ts.get("page_content", "")),
                workspace_id=str(ts.get("workspace_id", "")),
                reference=str(ts.get("reference", "")),
            )
        elif "image_source" in data:
            img = data["image_source"]
            citation_kwargs["image_source"] = chatbot_pb2.ImageSourceData(
                type=str(img.get("type", "image")),
                path=str(img.get("path", "")),
                page=str(img.get("page", "")),
                file_name=str(img.get("file_name", "")),
                external_id=str(img.get("external_id", "")),
                workspace_id=str(img.get("workspace_id", "")),
                height=str(img.get("height", "")),
                width=str(img.get("width", "")),
                reference=str(img.get("reference", "")),
            )

        component.citation.CopyFrom(chatbot_pb2.CitationComponent(**citation_kwargs))

    elif comp_type == "sources":
        source_items = [
            chatbot_pb2.SourceItem(
                title=s.get("title", ""),
                url=s.get("url", ""),
            )
            for s in data.get("sources", [])
        ]
        component.sources.CopyFrom(chatbot_pb2.SourcesComponent(sources=source_items))

    elif comp_type == "sandbox":
        component.sandbox.CopyFrom(chatbot_pb2.SandboxComponent(
            code=data.get("code", ""),
            output=data.get("output", ""),
            error=data.get("error", ""),
            output_available=data.get("output_available", True),
        ))

    elif comp_type == "artifact":
        component.artifact.CopyFrom(chatbot_pb2.ArtifactComponent(
            file_path=data.get("file_path", ""),
            filename=data.get("filename", ""),
            output_port_id=data.get("output_port_id") or data.get("outputPortId", ""),
            artifact_kind=data.get("artifact_kind") or data.get("artifactKind", ""),
            mime_type=data.get("mime_type") or data.get("mimeType", ""),
        ))

    elif comp_type == "web_preview":
        component.web_preview.CopyFrom(chatbot_pb2.WebPreviewComponent(
            content=data.get("content", ""),
        ))

    elif comp_type == "text":
        component.text.CopyFrom(chatbot_pb2.TextComponent(
            content=data.get("content", ""),
            output_port_id=data.get("output_port_id") or data.get("outputPortId", ""),
        ))

    elif comp_type == "code":
        component.code.CopyFrom(chatbot_pb2.CodeComponent(
            content=data.get("content", ""),
            language=data.get("language", ""),
            filename=data.get("filename", ""),
            output_port_id=data.get("output_port_id") or data.get("outputPortId", ""),
        ))

    return component


def _build_task_result_proto(tr: Dict[str, Any]) -> chatbot_pb2.PlaybookTaskResult:
    """Build a PlaybookTaskResult proto from a task result dict, including components.

    The agent text output is wrapped in a TextComponent and placed first
    in the components list, followed by tool-generated components (citations,
    artifacts, etc.), matching the display order used by RunAgentTeam.
    """
    output = tr.get("output", "")
    task_result_proto = chatbot_pb2.PlaybookTaskResult(
        task_id=tr.get("task_id", ""),
        status=tr.get("status", ""),
        error=tr.get("error", ""),
        duration_ms=tr.get("duration_ms", 0),
    )

    # 1. Text component from agent output (first in display order)
    if output:
        text_component = chatbot_pb2.Component(
            id=str(uuid.uuid4()),
            text=chatbot_pb2.TextComponent(content=output),
        )
        task_result_proto.components.append(text_component)

    # 2. Tool-generated components (citations, artifacts, sources, etc.)
    for comp in tr.get("components", []):
        proto_comp = _dict_to_proto_component(comp)
        task_result_proto.components.append(proto_comp)

    # 3. Token usage
    usage_data = tr.get("usage")
    if usage_data and isinstance(usage_data, dict):
        task_result_proto.usage.CopyFrom(chatbot_pb2.Usage(
            input_tokens=usage_data.get("input_tokens", 0),
            output_tokens=usage_data.get("output_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0),
            model=usage_data.get("model", ""),
        ))

    for trace_item in tr.get("tool_trace", []) or []:
        args_struct = struct_pb2.Struct()
        args = trace_item.get("args") or {}
        if isinstance(args, dict):
            args_struct.update(args)
        task_result_proto.tool_trace.append(chatbot_pb2.ToolTraceItem(
            call_index=int(trace_item.get("call_index", 0)),
            tool_name=str(trace_item.get("tool_name", "")),
            args=args_struct,
            output_summary=str(trace_item.get("output_summary", "")),
        ))

    semantic_match = tr.get("semantic_match")
    if isinstance(semantic_match, dict):
        task_result_proto.semantic_match.CopyFrom(chatbot_pb2.SemanticMatch(
            match_score=int(semantic_match.get("match_score", 0) or 0),
            semantic_similarity_score=int(semantic_match.get("semantic_similarity_score", 0) or 0),
            evidence_consistency_score=int(semantic_match.get("evidence_consistency_score", 0) or 0),
            judge_score=int(semantic_match.get("judge_score", 0) or 0),
            reason=str(semantic_match.get("reason", "") or ""),
            missing_points=[str(item) for item in (semantic_match.get("missing_points", []) or [])],
            changed_points=[str(item) for item in (semantic_match.get("changed_points", []) or [])],
            model=str(semantic_match.get("model", "") or ""),
            judge_used=bool(semantic_match.get("judge_used", False)),
        ))

    for prompt_item in tr.get("llm_prompt_trace", []) or []:
        task_result_proto.llm_prompt_trace.append(chatbot_pb2.LLMPromptTraceItem(
            stage=str(prompt_item.get("stage", "") or ""),
            model=str(prompt_item.get("model", "") or ""),
            prompt=str(prompt_item.get("prompt", "") or ""),
        ))

    for artifact in tr.get("artifacts", []) or []:
        task_result_proto.artifacts.append(chatbot_pb2.TaskArtifact(
            port_id=str(artifact.get("port_id") or artifact.get("portId") or "default"),
            artifact_kind=str(artifact.get("artifact_kind") or artifact.get("artifactKind") or "text"),
            content=str(artifact.get("content", "") or ""),
            url=str(artifact.get("url", "") or ""),
            filename=str(artifact.get("filename", "") or ""),
            mime_type=str(artifact.get("mime_type") or artifact.get("mimeType") or ""),
            size=int(artifact.get("size", 0) or 0),
        ))

    return task_result_proto


def _build_step_update_chunk(update: Dict[str, Any]) -> chatbot_pb2.PlaybookStreamChunk:
    """Convert a step-update dict to a PlaybookStreamChunk with PlaybookStepUpdate."""
    step_update = chatbot_pb2.PlaybookStepUpdate(
        task_id=update.get("task_id", ""),
        task_title=update.get("task_title", ""),
        status=update.get("status", ""),
    )

    result_data = update.get("result")
    if result_data:
        step_update.result.CopyFrom(_build_task_result_proto(result_data))

    interrupt_data = update.get("interrupt")
    if interrupt_data:
        logger.debug("[servicer] _build_step_update_chunk SUSPENDED", task=interrupt_data.get("task_id"), interrupt_type=interrupt_data.get("type"))
        step_update.interrupt.CopyFrom(chatbot_pb2.InterruptPayload(
            type=interrupt_data.get("type", ""),
            task_id=interrupt_data.get("task_id", ""),
            task_title=interrupt_data.get("task_title", ""),
            message=interrupt_data.get("message", ""),
            thread_id=interrupt_data.get("thread_id", ""),
            task_description=interrupt_data.get("task_description", ""),
            result=interrupt_data.get("result", ""),
            interrupt_id=interrupt_data.get("interrupt_id", ""),
            round=int(interrupt_data.get("round", 0) or 0),
            conversation_json=interrupt_data.get("conversation_json", ""),
            resumable_actions=[str(action) for action in (interrupt_data.get("resumable_actions", []) or [])],
        ))

    return chatbot_pb2.PlaybookStreamChunk(
        step_update=step_update,
    )


def _build_failed_step_update_chunk(
    task_id: str,
    task_title: str,
    error: str,
    *,
    thread_id: str = "",
) -> chatbot_pb2.PlaybookStreamChunk:
    return chatbot_pb2.PlaybookStreamChunk(
        step_update=chatbot_pb2.PlaybookStepUpdate(
            task_id=task_id,
            task_title=task_title,
            status="failed",
            result=chatbot_pb2.PlaybookTaskResult(
                task_id=task_id,
                status="failed",
                error=error,
                duration_ms=0,
            ),
        ),
        thread_id=thread_id,
    )


def _safe_build_step_update_chunk(
    update: Dict[str, Any],
    *,
    stream_name: str,
    thread_id: str = "",
) -> chatbot_pb2.PlaybookStreamChunk:
    try:
        chunk = _build_step_update_chunk(update)
        if thread_id:
            chunk.thread_id = thread_id
        return chunk
    except Exception as exc:
        task_id = str(update.get("task_id", "") or "")
        task_title = str(update.get("task_title", "") or "")
        logger.error(
            f"[{stream_name}] Failed to serialize step update chunk",
            task_id=task_id,
            status=str(update.get("status", "") or ""),
            error=str(exc),
            exc_info=True,
        )
        return _build_failed_step_update_chunk(
            task_id=task_id,
            task_title=task_title,
            error=f"Failed to serialize step update: {exc}",
            thread_id=thread_id,
        )


def _build_in_progress_result(task_id: str, progress: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    output = progress.get("output")
    components = progress.get("components", []) or []
    tool_trace = progress.get("tool_trace", []) or []
    llm_prompt_trace = progress.get("llm_prompt_trace", []) or []
    artifacts = progress.get("artifacts", []) or []

    if output is None and not components and not tool_trace and not llm_prompt_trace and not artifacts:
        return None

    return {
        "task_id": task_id,
        "status": "in_progress",
        "output": output or "",
        "error": "",
        "duration_ms": 0,
        "components": components,
        "tool_trace": tool_trace,
        "llm_prompt_trace": llm_prompt_trace,
        "artifacts": artifacts,
    }


def _build_step_response(result: Dict[str, Any]) -> chatbot_pb2.StepResponse:
    """Build a StepResponse proto from step result dict."""
    response = chatbot_pb2.StepResponse(
        status=result.get("status", "failed"),
        thread_id=result.get("thread_id", ""),
    )

    task_result = result.get("result")
    if task_result:
        response.result.CopyFrom(_build_task_result_proto(task_result))

    interrupt_data = result.get("interrupt")
    if interrupt_data:
        response.interrupt.CopyFrom(
            chatbot_pb2.InterruptPayload(
                type=interrupt_data.get("type", ""),
                task_id=interrupt_data.get("task_id", ""),
                task_title=interrupt_data.get("task_title", ""),
                message=interrupt_data.get("message", ""),
                thread_id=interrupt_data.get("thread_id", ""),
                task_description=interrupt_data.get("task_description", ""),
                result=interrupt_data.get("result", ""),
                interrupt_id=interrupt_data.get("interrupt_id", ""),
                round=int(interrupt_data.get("round", 0) or 0),
                conversation_json=interrupt_data.get("conversation_json", ""),
                resumable_actions=[str(action) for action in (interrupt_data.get("resumable_actions", []) or [])],
            )
        )

    return response
