"""Mono-agent workflow: run a single specialized agent with no manager.

Unlike the manual/auto workflows, there is no manager and no delegation. The one
provided agent is built with its real tools attached (search, code interpreter,
web, connectors, skills, ...) and executed directly. All tool wiring and
streaming infrastructure is reused from the multi-agent stack.
"""

import asyncio

from src.logger.logging import get_logger
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.agents.core.document_helpers import DocumentHelpers
from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam
from src.corrective_replay import build_corrective_replay_user_message

logger = get_logger("api.routers.agentic_rag.single_agent")


async def handle_single_agent_workflow(
        team: AutoAgentGenerationTeam,
        user_request: RunAgentTeamRequest,
        q: asyncio.Queue[dict],
) -> None:
    """Handle the mono-agent workflow (single agent, no manager/delegation).

    Args:
        team (AutoAgentGenerationTeam): The agent team instance (used as the host
            for shared factories, repository and streaming infrastructure).
        user_request (RunAgentTeamRequest): The user request. Carries exactly one
            agent in ``agents`` and ``agent_mode == 'mono'``.
        q (asyncio.Queue[dict]): The queue for streaming responses.

    Returns:
        None
    """
    session_id = user_request.session_id
    logger.info(f"[MONO WORKFLOW] Starting single-agent workflow - session_id: {session_id}")

    try:
        session_service = user_request.session_service
        if session_service is not None:
            from src.root_runtime.background_sessions import validate_background_request
            validate_background_request(session_service, user_request.execution_scope, user_request.user_id, session_id)
            await session_service.validate_owner()
        # Exactly one agent is expected. Ignore any manager agent defensively.
        agents = [
            agent for agent in (user_request.agents or [])
            if DocumentHelpers.agent_to_dict(agent).get('agent_type') != 'manager'
        ]
        if not agents:
            raise ValueError("No agent was provided for the mono-agent workflow")
        if len(agents) > 1:
            logger.warning(
                f"[MONO WORKFLOW] {len(agents)} agents provided; using the first - session_id: {session_id}"
            )

        # Give the agent access to the conversation's documents (search needs them).
        agents = DocumentHelpers.merge_user_request_brain_documents_into_agents(agents, user_request)

        if getattr(user_request, "deep_search_enabled", False):
            agent = agents[0]
            existing_tools = getattr(agent, "tools", None) or []
            if not any(isinstance(t, dict) and t.get("name") == "deep_search" for t in existing_tools):
                agent.tools = [*existing_tools, {"name": "deep_search"}]
                logger.info("[MONO WORKFLOW] deep_search_enabled=True — added deep_search tool to agent")

        agent_data = team.agent_helper._prepare_agent_data(agents[0], user_request, team)
        from src.root_runtime.contracts import ExecutionRole
        scope = getattr(user_request, "execution_scope", None)
        if scope is not None and scope.role is ExecutionRole.ROOT:
            agent_data["_root_input_control_version"] = (getattr(user_request, "root_context", None) or {}).get("native_input_control_version", 0)
        team.agent_repository.add_agent(agent_data)
        image_input = user_request.image_input if hasattr(user_request, 'image_input') else None

        # WP04: when the backend attached a root delegation context, build the
        # replayable dispatcher so the root can delegate to allowlisted
        # specialists. Candidates stay data until the root chooses one.
        delegation_tool = None
        temporary_worker_tool = None
        fanout_tool = None
        background_task_tool = None
        delegation_instruction = ""
        root_context = getattr(user_request, "root_context", None)
        if root_context and root_context.get("catalog"):
            from src.root_runtime.dispatcher import (
                build_delegate_dispatcher,
                build_delegation_instruction,
            )

            delegation_tool = build_delegate_dispatcher(
                team,
                user_request,
                root_context,
                getattr(user_request, "delegate_candidates", None),
                root_scope=getattr(user_request, "execution_scope", None),
            )
            if delegation_tool is not None:
                delegation_instruction = build_delegation_instruction(root_context["catalog"])

        if root_context and root_context.get('temporary_workers_enabled') is True:
            from src.root_runtime.dispatcher import build_delegate_dispatcher
            temporary_worker_tool = build_delegate_dispatcher(team, user_request, root_context, [],
                root_scope=scope, temporary=True)

        if root_context and root_context.get('fanout_enabled') is True:
            from src.root_runtime.fanout import build_fanout_dispatcher
            fanout_tool = build_fanout_dispatcher(team, user_request, root_context, scope)
        if root_context and root_context.get('background_enabled') is True:
            from src.root_runtime.background_dispatcher import build_background_dispatcher
            background_task_tool = build_background_dispatcher(root_context, scope)

        result = await team.run_single_agent(
            user_prompt=build_corrective_replay_user_message(
                user_request.message,
                user_request.correction_replay_context,
            ),
            session_id=session_id,
            q=q,
            image_input=image_input,
            task_summary=user_request.task_summary,
            delegation_tool=delegation_tool,
            temporary_worker_tool=temporary_worker_tool,
            fanout_tool=fanout_tool,
            delegation_instruction=delegation_instruction,
            execution_scope=getattr(user_request, "execution_scope", None),
            abort_signal=getattr(user_request, "abort_signal", None),
            native_input_responses=getattr(user_request, "native_input_responses", None),
            **({'session_service': session_service} if session_service is not None else {}),
            **({'background_task_tool': background_task_tool} if background_task_tool is not None else {}),
        )
        logger.info(f"[MONO WORKFLOW] Completed single-agent workflow - session_id: {session_id}")
        return result

    except Exception as e:
        if user_request.session_service is not None:
            raise
        logger.exception(f"[MONO WORKFLOW] Error in single-agent workflow - session_id: {session_id}: {str(e)}")
        await team._message_helper._send_error_message(q, session_id, str(e))
