"""Mono-agent workflow: run a single specialized agent with no manager.

Unlike the manual/auto workflows, there is no manager and no delegation. The one
provided agent is built with its real tools attached (search, code interpreter,
web, dataviz, connectors, skills, ...) and executed directly. All tool wiring and
streaming infrastructure is reused from the multi-agent stack.
"""

import asyncio

from src.logger.logging import get_logger
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.agents.core.document_helpers import DocumentHelpers
from src.smart_rag.engines.multi_agent.config import langfuse_client
from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam
from src.guardrails.prompt_injection_guardrail import PromptInjectionGuardrail
from src.corrective_replay import build_corrective_replay_user_message

logger = get_logger("api.routers.agentic_rag.single_agent")


async def handle_single_agent_workflow(
        team: AutoAgentGenerationTeam,
        user_request: RunAgentTeamRequest,
        q: asyncio.Queue[dict],
        main_trace
) -> None:
    """Handle the mono-agent workflow (single agent, no manager/delegation).

    Args:
        team (AutoAgentGenerationTeam): The agent team instance (used as the host
            for shared factories, repository and streaming infrastructure).
        user_request (RunAgentTeamRequest): The user request. Carries exactly one
            agent in ``agents`` and ``agent_mode == 'mono'``.
        q (asyncio.Queue[dict]): The queue for streaming responses.
        main_trace: The main trace for langfuse logging.

    Returns:
        None
    """
    session_id = user_request.session_id
    logger.info(f"[MONO WORKFLOW] Starting single-agent workflow - session_id: {session_id}")

    single_agent_span = langfuse_client.span(
        trace_id=session_id,
        parent_observation_id=main_trace.id,
        name="single_agent_execution",
        input={
            "user_message": user_request.message,
            "workflow_type": "mono",
        },
    )

    try:
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
        team.agent_repository.add_agent(agent_data)
        single_agent_span.event(
            name="agent_added",
            output={
                "agent_name": agent_data.get('name', 'unnamed'),
                "tools": agent_data.get('tools', []),
                "has_tools": bool(agent_data.get('tools')),
            },
        )

        image_input = user_request.image_input if hasattr(user_request, 'image_input') else None
        guarded = await PromptInjectionGuardrail().check_input(
            text=user_request.message,
            agent_config=agent_data,
            channel=getattr(user_request, "channel", "web"),
        )
        if guarded.blocked:
            single_agent_span.update(output={"execution_completed": False, "guardrail_blocked": True})
            await q.put(team.streaming_formatter.format_streaming_event(
                agent_id=agent_data.get("id", "no_id"),
                agent_name=agent_data.get("name", "agent"),
                agent_type="agent",
                chunk=guarded.text,
                message_id=session_id,
                content_type="text",
                guardrail_decision=guarded.decision_metadata(),
            ))
            await q.put(None)
            return

        q.include_private_tool_results = user_request.correction_replay_context is not None
        await team.run_single_agent(
            user_prompt=build_corrective_replay_user_message(
                guarded.text,
                user_request.correction_replay_context,
            ),
            session_id=session_id,
            q=q,
            parent_trace=single_agent_span,
            image_input=image_input,
            task_summary=user_request.task_summary,
        )
        logger.info(f"[MONO WORKFLOW] Completed single-agent workflow - session_id: {session_id}")

    except Exception as e:
        logger.exception(f"[MONO WORKFLOW] Error in single-agent workflow - session_id: {session_id}: {str(e)}")
        single_agent_span.update(output={"execution_completed": False, "error": str(e)})
        await team._message_helper._send_error_message(q, session_id, str(e))
