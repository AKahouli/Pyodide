import asyncio

from src.logger.logging import get_logger
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.agents.core.document_helpers import DocumentHelpers
from src.smart_rag.engines.multi_agent.config import langfuse_client
from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam
from src.guardrails.prompt_injection_guardrail import PromptInjectionGuardrail

logger = get_logger("api.routers.agentic_rag.manual_agents")

async def handle_agents_provided_workflow(
        team: AutoAgentGenerationTeam,
        user_request: RunAgentTeamRequest,
        q: asyncio.Queue[dict],
        main_trace
) -> None:
    """Handle workflow when agents are provided.
    Args:
        team (AutoAgentGenerationTeam): The agent team instance.
        user_request (RunAgentTeamRequest): The user request containing details.
        q (asyncio.Queue[dict]): The queue for streaming responses.
        main_trace: The main trace for langfuse logging.
    Returns:
        None
        """
    logger.info(f"[MANUAL WORKFLOW] Starting manual agents workflow - session_id: {user_request.session_id}")

    # create span for agent team execution with provided agents
    agent_provided_span= langfuse_client.span(
        trace_id=user_request.session_id,
        parent_observation_id=main_trace.id,
        name="agent_team_execution_with_provided_agents",
        input={
            "user_message": user_request.message,
            "manager_prompt": user_request.manager_prompt,
            "agents_provided": len(user_request.agents),
            "workflow_type": "agents_provided"
        },
    )


    # Extract necessary prompts and session details
    session_id = user_request.session_id
    # Get fallback manager prompt from extract_prompts
    fallback_manager_prompt = team.prompt_processor.extract_prompts(user_request.manager_prompt)[5]
    # Check if there's a manager agent in user_request.agents and use its prompt, temperature, and memory settings, otherwise use fallback
    manager_prompt = team.agent_helper.get_manager_prompt_from_agents(user_request.agents, fallback_manager_prompt)
    manager_temperature = team.agent_helper.get_temperature_from_agents(user_request.agents)
    manager_memory = team.agent_helper.get_manager_memory_from_agents(user_request.agents)

    # Filter out all manager agents from user_request.agents after extracting prompt
    # Convert to list if it's not already to allow filtering
    filtered_agents = [
        agent for agent in (user_request.agents or [])
        if DocumentHelpers.agent_to_dict(agent).get('agent_type') != 'manager'
    ]

    report_writer_prompt = team.prompt_processor.extract_prompts(user_request.manager_prompt)[6]
    html_agent_fallback_prompt= team.prompt_processor.extract_prompts(user_request.manager_prompt)[3]
    html_agent_prompt=team.agent_helper.get_html_prompt_from_agents(user_request.agents, html_agent_fallback_prompt)
    response_format_for_html_agents=team.prompt_processor.extract_prompts(user_request.manager_prompt)[8]

    try:
        logger.info(f"[MANUAL WORKFLOW] Processing {len(filtered_agents)} provided agents - session_id: {user_request.session_id}")

        # STEP 1: Merge user_request brain_documents into each agent's brain_documents
        filtered_agents = DocumentHelpers.merge_user_request_brain_documents_into_agents(filtered_agents, user_request)

        # STEP 1b: Inject deep_search tool when deep_search_enabled is True on the request.
        # The factories detect deep search by tool name, so we must add the tool entry here —
        # same bridge as single_agent.py:68-73 but applied to every tagged worker agent.
        if getattr(user_request, "deep_search_enabled", False):
            for agent in filtered_agents:
                existing_tools = getattr(agent, "tools", None) or []
                if not any(isinstance(t, dict) and t.get("name") == "deep_search" for t in existing_tools):
                    agent.tools = [*existing_tools, {"name": "deep_search"}]
                    logger.info(f"[MANUAL WORKFLOW] deep_search_enabled=True — added deep_search tool to agent {getattr(agent, 'name', 'unnamed')}")

        # STEP 2: Update user_request.agents by mapping on agent ID
        DocumentHelpers.update_agents_in_list_by_mapping(user_request.agents, filtered_agents)

        # STEP 3: Merge brain documents from tagged agents with user_request
        # This ensures the manager has access to documents from all tagged agents
        merged_brain_documents, merged_brain_relations = DocumentHelpers.merge_agents_brain_data(
            filtered_agents, user_request, team
        )

        # STEP 4: Update user_request with merged brain data for manager
        user_request.brain_documents = merged_brain_documents
        user_request.brain_relations = merged_brain_relations

        logger.info(f"[MANUAL WORKFLOW] Merged brain data: {len(merged_brain_documents)} documents - session_id: {user_request.session_id}")

        fallback_chatbot_name = user_request.chatbot_name
        # Add each provided agent to the team (using filtered list without manager agents)
        for agent_dict in filtered_agents:
            agent_data = team.agent_helper._prepare_agent_data(agent_dict, user_request, team)
            team.agent_repository.add_agent(agent_data)
            agent_provided_span.event(
                name="agent_added",
                output={
                    "agent_name": agent_data.get('name', 'unnamed'),
                    "description": agent_data.get('description', ''),
                    "tools": agent_data.get('tools', []),
                    "has_tools": bool(agent_data.get('tools')),
                    "merged_documents_count": len(merged_brain_documents),
                },
            )

        logger.info(f"[MANUAL WORKFLOW] Added {len(filtered_agents)} agents to team - session_id: {user_request.session_id}")

        guardrail_agent_config = next(iter(team.agent_repository.get_all_agents()), {})
        guarded = await PromptInjectionGuardrail().check_input(
            text=user_request.message,
            agent_config=guardrail_agent_config,
            channel=getattr(user_request, "channel", "web"),
        )
        if guarded.blocked:
            agent_provided_span.update(output={"execution_completed": False, "guardrail_blocked": True})
            await q.put(team.streaming_formatter.format_streaming_event(
                agent_id=guardrail_agent_config.get("id", "no_id"),
                agent_name=guardrail_agent_config.get("name", "agent"),
                agent_type="agent",
                chunk=guarded.text,
                message_id=session_id,
                content_type="text",
                guardrail_decision=guarded.decision_metadata(),
            ))
            await q.put(None)
            return
        user_request.message = guarded.text

        # Finalize agent configurations before running
        team.agent_helper.pre_agent_run_config(report_writer_prompt,html_agent_prompt, team.agent_repository.get_all_agents(), fallback_chatbot_name,response_format_for_html_agents)
        if not team.agent_repository.get_all_agents():
            logger.info(f"[MANUAL WORKFLOW] No worker agents provided, manager will respond directly - session_id: {user_request.session_id}")

        logger.info(f"[MANUAL WORKFLOW] Starting team execution - session_id: {user_request.session_id}")
        # Run the agent team with manager_memory configuration
        await _run_provided_agent_team(team, user_request, manager_prompt, session_id, manager_temperature, manager_memory, q)
        logger.info(f"[MANUAL WORKFLOW] Completed manual agents workflow - session_id: {user_request.session_id}")

    except Exception as e:
        logger.error(f"[MANUAL WORKFLOW] Error in manual agents workflow - session_id: {user_request.session_id}: {str(e)}")

async def _run_provided_agent_team(team, user_request, manager_prompt, session_id, manager_temperature, manager_memory, q):
    """Run the agent team based on whether there are agent mentions.
    Args:
        team: The agent team instance.
        user_request: The user request containing details.
        manager_prompt: The manager prompt to use.
        session_id: The session ID for tracking.
        manager_temperature: The temperature setting for manager LLM.
        manager_memory: Whether to save manager conversation to memory.
        q: The queue for streaming responses.
    Returns:
        None
    """
    logger.info(f"[MANUAL WORKFLOW] Creating manager with delegated agents - session_id: {session_id}")
    # Filter out manager agents before creating enhanced prompt
    agents_for_delegation = [
        agent for agent in (team.agent_repository.get_all_agents() or [])
    ]
    logger.info(f"[MANUAL WORKFLOW] Manager will delegate to {len(agents_for_delegation)} agents - session_id: {session_id}")

    if agents_for_delegation:
        # Enhance manager prompt with available agents
        enhanced_manager_prompt = team.agent_helper._create_enhanced_manager_prompt(manager_prompt, agents_for_delegation, team.config)
        # Create user prompt for manager
        manager_user_prompt = f"Handle this request: '{user_request.message}'. Call the appropriate agent using the delegate functions available to you."
    else:
        logger.info(f"[MANUAL WORKFLOW] No delegation agents, manager responding directly - session_id: {session_id}")
        enhanced_manager_prompt = manager_prompt
        manager_user_prompt = user_request.message
    # Run the agent team with manager_memory configuration
    image_input = user_request.image_input if hasattr(user_request, 'image_input') else None
    await team.run_agent_team(manager_user_prompt, enhanced_manager_prompt, session_id, manager_memory, q, manager_temperature, None, image_input, user_request.agents)

