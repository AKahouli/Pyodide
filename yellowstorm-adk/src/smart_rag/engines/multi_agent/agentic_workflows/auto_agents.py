import asyncio
from typing import List, Dict, Any

from src.logger.logging import get_logger
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.agents.core.document_helpers import DocumentHelpers
from src.smart_rag.engines.multi_agent.config import langfuse_client
from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam

logger = get_logger("api.routers.agentic_rag.auto_agents_workflow")



async def handle_no_agents_workflow(team: AutoAgentGenerationTeam,
                                     user_request: RunAgentTeamRequest, q: asyncio.Queue[dict], main_trace) -> None:
    """Handle workflow when no agents are provided.
    Args:
        team (AutoAgentGenerationTeam): The agent team instance.
        user_request (RunAgentTeamRequest): The user request containing details.
        q (asyncio.Queue[dict]): The queue for streaming responses.
        main_trace: The main trace for langfuse logging.
    Returns:
        None

    """
    logger.info(f"[AUTO WORKFLOW] Starting auto agents workflow - session_id: {user_request.session_id}")

    # Create span for agent suggestion generation
    suggestion_span = langfuse_client.span(
        trace_id=user_request.session_id,
        parent_observation_id=main_trace.id,
        name="agent_suggestion_generation",
        input={
            "user_message": user_request.message,
            "available_agents_provided": user_request.available_agents,
            "workflow_type": "auto agents"
        },
    )

    try:
        for agent in user_request.agents:
            team.agent_repository.add_agent(agent)
        logger.info(f"[AUTO WORKFLOW] Generating agent suggestions - session_id: {user_request.session_id}")
        suggestions_prompt = team.prompt_processor.extract_prompts(user_request.manager_prompt)[7]

        # Convert user_request.agents to dictionaries first
        existing_agents = []
        for agent in (user_request.agents or []):
            if isinstance(agent, dict):
                existing_agents.append(agent)
            elif hasattr(agent, 'dict'):  # Pydantic model
                existing_agents.append(agent.dict())
            else:
                existing_agents.append(vars(agent))

        # Retry mechanism for suggestion generation (max 3 attempts)
        all_agents = None
        max_retries = 3

        for attempt in range(1, max_retries + 1):
            logger.info(f"[AUTO WORKFLOW] Generating suggestions (attempt {attempt}/{max_retries}) - session_id: {user_request.session_id}")

            all_agents = await team.get_agent_suggestions(
                suggestions_prompt, user_request.message, user_request.session_id,
                available_agents=user_request.available_agents or [],
                brain_documents=user_request.brain_documents, brain_relations=user_request.brain_relations,
                available_tools=user_request.available_tools or []
            )

            if all_agents:
                logger.info(f"[AUTO WORKFLOW] Successfully generated {len(all_agents)} total agents on attempt {attempt} - session_id: {user_request.session_id}")
                break
            else:
                logger.warning(f"[AUTO WORKFLOW] Attempt {attempt} failed to generate suggestions - session_id: {user_request.session_id}")
                if attempt < max_retries:
                    logger.info(f"[AUTO WORKFLOW] Retrying suggestion generation... ({attempt + 1}/{max_retries}) - session_id: {user_request.session_id}")

        if not all_agents:
            logger.warning(f"Failed to generate suggestions after {max_retries} attempts")
            all_agents = []  # Set to empty list to continue with existing agents only
            suggestion_span.update(output={
                "suggestions_generated": False,
                "error": f"No agent suggestions could be generated after {max_retries} attempts",
                "attempts_made": max_retries,
                "continuing_with_existing_agents": len(existing_agents) > 0
            })
            if len(existing_agents) == 0:
                await team._message_helper._send_suggestions(q, user_request.session_id,
                                                               [])
                logger.info(f"Continuing with {len(existing_agents)} existing agents only")

        # Convert all agents to dictionaries if they're not already
        for i, agent in enumerate(all_agents):
            if not isinstance(agent, dict):
                if hasattr(agent, 'dict'):  # Pydantic model
                    all_agents[i] = agent.dict()
                else:
                    all_agents[i] = vars(agent)

        # Separate new suggestions from existing agents by comparing against user_request.agents
        existing_agent_ids = {agent.get('id') for agent in existing_agents if agent.get('id')}
        existing_agent_names = {agent.get('name', '').lower().strip() for agent in existing_agents}

        new_suggestions = []
        for agent in all_agents:
            agent_id = agent.get('id')
            agent_name = agent.get('name', '').lower().strip()

            # If agent has an ID and it's in existing agents, skip it
            # If agent doesn't have an ID but name matches existing agent, skip it
            if (agent_id and agent_id in existing_agent_ids) or \
               (not agent_id and agent_name in existing_agent_names):
                continue
            else:
                new_suggestions.append(agent)

        logger.info(f"[AUTO WORKFLOW] Separated {len(new_suggestions)} new suggestions from {len(all_agents)} total agents - session_id: {user_request.session_id}")

        suggestion_span.update(output={
            "suggestions_generated": True,
            "total_agents_count": len(all_agents),
            "new_suggestions_count": len(new_suggestions),
            "existing_agents_count": len(existing_agents),
            "suggestions": new_suggestions
        })

        # Send only new suggestions (not existing agents) to the client
        await team._message_helper._send_suggestions(q, user_request.session_id, new_suggestions)

        logger.info(f"[AUTO WORKFLOW] Starting team execution with {len(all_agents)} total agents - session_id: {user_request.session_id}")
        all_agents_for_execution = existing_agents + all_agents
        await _run_team_with_suggestions(team, user_request, all_agents_for_execution, q, main_trace)
        logger.info(f"[AUTO WORKFLOW] Completed auto agents workflow - session_id: {user_request.session_id}")

    except Exception as e:
        logger.error(f"[AUTO WORKFLOW] Error in auto agents workflow - session_id: {user_request.session_id}: {str(e)}")
        suggestion_span.event(
            name="error",
            output={
                "error_message": str(e),
                "error_type": "suggestion_generation_error"
            },
        )
        suggestion_span.update(output={
            "suggestions_generated": False,
            "error": str(e)
        })




async def _run_team_with_suggestions(team: AutoAgentGenerationTeam,
                                     user_request: RunAgentTeamRequest,
                                     suggestions: List[Dict[str, Any]], q: asyncio.Queue[dict], main_trace) -> None:
    """Run team with generated suggestions.
    Args:
        team (AutoAgentGenerationTeam): The agent team instance.
        user_request (RunAgentTeamRequest): The user request containing details.
        suggestions (List[Dict[str, Any]]): The list of suggested agents.
        q (asyncio.Queue[dict]): The queue for streaming responses.
        main_trace: The main trace for langfuse logging.
    Returns:
        None

        """

    # Extract necessary prompts and session details
    session_id = user_request.session_id
    # Get fallback manager prompt from extract_prompts
    fallback_manager_prompt = team.prompt_processor.extract_prompts(user_request.manager_prompt)[5]
    # Check if there's a manager agent in suggestions and use its prompt and temperature, otherwise use fallback
    manager_prompt = team.agent_helper.get_manager_prompt_from_agents(suggestions, fallback_manager_prompt)
    manager_temperature = team.agent_helper.get_temperature_from_agents(suggestions)
    manager_memory = team.agent_helper.get_manager_memory_from_agents(suggestions)

    # Filter out all manager agents from suggestions after extracting prompt
    suggestions = [agent for agent in suggestions if agent.get('agent_type') != 'manager']

    report_writer_prompt = team.prompt_processor.extract_prompts(user_request.manager_prompt)[6]
    fallback_html_agent_prompt = team.prompt_processor.extract_prompts(user_request.manager_prompt)[3]
    html_prompt=team.agent_helper.get_html_prompt_from_agents(suggestions, fallback_html_agent_prompt)

    response_format_for_html_agents=team.prompt_processor.extract_prompts(user_request.manager_prompt)[8]

    # Create span for team execution with suggestions
    execution_span = langfuse_client.span(
        trace_id=session_id,
        parent_observation_id=main_trace.id,
        name="manager_creation_with_suggestions",
        input={
            "user_message": user_request.message,
            "manager_prompt": manager_prompt,
            "suggested_agents": [s.get('name', 'unnamed') for s in suggestions],
            "suggestion_count": len(suggestions)
        },
    )

    try:
        logger.info(f"[AUTO WORKFLOW] Preparing team execution with {len(suggestions)} agents - session_id: {session_id}")

        # STEP 1: Merge user_request brain_documents into each available agent's brain_documents
        # This ensures each agent has access to user_request documents
        suggestions = DocumentHelpers.merge_user_request_brain_documents_into_agents(suggestions, user_request)

        # STEP 2: Update available_agents by mapping on agent ID
        if user_request.available_agents:
            DocumentHelpers.update_agents_in_list_by_mapping(user_request.available_agents, suggestions)

        # STEP 3: Merge brain documents from available_agents (those that will be executed) with user_request
        # This ensures the manager has access to documents from all agents that will be available
        merged_brain_documents, merged_brain_relations = DocumentHelpers.merge_agents_brain_data(
            suggestions, user_request, team
        )

        # STEP 4: Update user_request with merged brain data for manager
        user_request.brain_documents = merged_brain_documents
        user_request.brain_relations = merged_brain_relations
        image_input = user_request.image_input
        logger.info(f"[AUTO WORKFLOW] Merged brain data: {len(merged_brain_documents)} documents - session_id: {session_id}")

        # Enhance manager prompt with suggested agents
        agent_list = "\n".join([
            f"- @{agent.get('name', '').replace(' ', '_').lower()}: {agent.get('description', '')}"
            for agent in suggestions
        ])

        # Build file context if attached files or images are present
        file_context = team.agent_helper._build_file_context_prompt(
            getattr(team.config, 'attached_files', None),
            getattr(team.config, 'attached_images', None),
            getattr(team.config, 'previous_attached_files', None),
        )

        enhanced_manager_prompt = f"""{manager_prompt}
       Available agents that can help with this request:
       {agent_list}

       You have access to delegate functions for each agent. Use the appropriate delegate_to_[agent_name] function to call the agent that can best handle the user's request. Do not just mention agents - actually call their delegate functions with the user's task."""

        if file_context:
            enhanced_manager_prompt = f"{enhanced_manager_prompt}\n\n{file_context}"

        # Create user prompt for manager
        manager_user_prompt = f"Handle this request: '{user_request.message}'. Call the appropriate agent using the delegate functions available to you."

        # Log details about the enhanced prompt and suggestions
        execution_span.event(
            name="manager_prompt_enhanced",
            output={
                "enhanced_prompt_length": len(enhanced_manager_prompt),
                "available_agents": [s.get('name', 'unnamed') for s in suggestions],
                "merged_documents_count": len(merged_brain_documents)
            },
        )

        team.agent_helper.pre_agent_run_config(report_writer_prompt, html_prompt,suggestions,user_request.chatbot_name, response_format_for_html_agents)
        team.agent_repository.set_agents(suggestions)
        # Run the agent team
        await team.run_agent_team(manager_user_prompt, enhanced_manager_prompt, session_id, manager_memory, q, manager_temperature
                                  , user_request.search_web, image_input)

        # Mark execution span as completed
        execution_span.update(output={
            "team_execution_completed": True,
            "suggestions_used": len(suggestions)
        })

    except Exception as e:
        logger.error(f"Error running team with suggestions: {str(e)}")
        execution_span.event(
            name="error",
            output={
                "error_message": str(e),
                "error_type": "team_execution_error"
            },
        )
        execution_span.update(output={
            "team_execution_completed": False,
            "error": str(e)
        })
