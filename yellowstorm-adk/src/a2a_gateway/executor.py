"""A2A executor that delegates to the RunSingleAgent gRPC service.

Builds a ``RunSingleAgentRequest`` from a stored agent definition and maps the
streamed ``StreamChunk``s back to A2A events. This is the multi-tenant version
of the standalone adapter: the agent definition is injected per instance.
"""

from typing import Any, Dict

import grpc
from google.protobuf import json_format

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part, TextPart, TaskState
from a2a.utils import new_task, new_agent_text_message

from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc
from src.logger.logging import get_logger

logger = get_logger("api.a2a_gateway.executor")


class RunSingleAgentExecutor(AgentExecutor):
    """Forwards an A2A turn to RunSingleAgent for a single stored agent."""

    def __init__(self, grpc_target: str, definition: Dict[str, Any]):
        self._target = grpc_target
        self._definition = definition

    def _build_request(self, user_text: str, conversation_id: str):
        agent = chatbot_pb2.Agent()
        json_format.ParseDict(self._definition, agent, ignore_unknown_fields=True)

        request = chatbot_pb2.RunSingleAgentRequest(
            user_context=chatbot_pb2.UserContext(
                user_id="copilot-studio", username="copilot-studio"
            ),
            conversation_id=conversation_id,
            query=user_text,
            agent=agent,
        )
        # Mirror the agent's knowledge bases / skills to the request level so the
        # mono pipeline picks up brain documents and skills (same as the team path).
        if agent.brain_context:
            request.workspace_context.extend(agent.brain_context)
        if agent.skills:
            request.skills.extend(agent.skills)
        return request

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        user_text = context.get_user_input()

        task = context.current_task
        if task is None:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)
        await updater.start_work()

        request = self._build_request(user_text, task.context_id)
        full_text_parts: list[str] = []
        error_text: str | None = None

        try:
            async with grpc.aio.insecure_channel(self._target) as channel:
                stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)
                async for chunk in stub.RunSingleAgent(request):
                    comp = chunk.component
                    kind = comp.WhichOneof("data")
                    if kind == "text":
                        piece = comp.text.content
                        if piece:
                            full_text_parts.append(piece)
                            await updater.update_status(
                                TaskState.working,
                                message=new_agent_text_message(
                                    piece, task.context_id, task.id
                                ),
                            )
                    elif kind == "error":
                        error_text = comp.error.content or comp.error.title or "error"
        except grpc.aio.AioRpcError as exc:
            error_text = f"gRPC call failed: {exc.code()} - {exc.details()}"
            logger.error(error_text)

        if error_text is not None:
            await updater.failed(
                message=new_agent_text_message(error_text, task.context_id, task.id)
            )
            return

        full_text = "".join(full_text_parts).strip() or "(no response)"
        await updater.add_artifact(
            [Part(root=TextPart(text=full_text))], name="response", last_chunk=True
        )
        await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        if context.current_task is not None:
            updater = TaskUpdater(event_queue, context.task_id, context.context_id)
            await updater.cancel()
