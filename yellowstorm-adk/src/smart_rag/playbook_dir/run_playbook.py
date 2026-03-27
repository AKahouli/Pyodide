"""Execute playbook with agent team logic."""

import asyncio
from src.logger.logging import get_logger
from src.schema.playbook import RunPlaybookRequest
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.playbook_dir.playbook_helpers import construct_workplan, construct_manager_prompt
from src.smart_rag.engines.multi_agent.workflow_processor import run_agent_team_logic

logger = get_logger("api.smart_rag.playbook_dir.run_playbook")


async def execute_playbook_with_agent_team(
    request: RunPlaybookRequest,
    queue: asyncio.Queue[dict]
) -> None:
    """
    Execute a playbook by constructing a workplan and running agent team logic.

    Args:
        request: The playbook execution request containing:
            - playbook_id: Unique identifier for the playbook
            - playbook_name: Name of the playbook
            - message: User query
            - steps: List of RunPlaybookStepRequest to execute in order
            - manager_agent: Manager agent configuration
        queue: AsyncIO queue for streaming response events back to client

    Returns:
        None: Results are streamed through the queue
    """
    logger.info(
        f"[RUN_PLAYBOOK] Starting playbook execution - "
        f"PlaybookId: {request.playbook_id}, "
        f"Total steps: {len(request.steps)}"
    )

    try:
        # Step 1: Construct the workplan from the list of steps
        workplan = construct_workplan(request.steps)
        logger.info(f"[RUN_PLAYBOOK] Workplan constructed:\n{workplan}")

        overrited_manager_prompt, manager_agent_prompt = construct_manager_prompt(request.manager_prompt, workplan, request.manager_agent.prompt)
        request.manager_agent.prompt = manager_agent_prompt
        # Step 2: Extract agents from the steps
        agents = [step.agent for step in request.steps]
        available_agents = []
        for agent in agents:
            actual_agent = {
                "id": agent.id,  # use the agent's id attribute, not the object itself
                "name": agent.name,
                "description": agent.description,
                "prompt": agent.prompt,
                "tools": agent.tools,
                "chatbot_name": agent.chatbot_name,
                "brain_documents": agent.brain_documents,
                "brain_relations": agent.brain_relations,
                "brain_ids": agent.brain_ids,
                "vectorstore_name": agent.vectorstore_name,
                "agent_params": agent.agent_params if hasattr(agent, 'agent_params') else {},
                "save_memory": agent.save_memory,
            }
            available_agents.append(actual_agent)
        logger.info(
            f"[RUN_PLAYBOOK] Extracted {len(available_agents)} agents from steps"
        )
        # Step 5: Build RunAgentTeamRequest from the playbook request
        agent_team_request = RunAgentTeamRequest(
            user_id=request.user_id,
            session_id=request.session_id,
            message=request.message,
            manager_prompt=overrited_manager_prompt,
            chatbot_name=request.chatbot_name,
            agents=[request.manager_agent]+ agents,
            available_agents= available_agents,
            available_tools=request.available_tools,
            brain_ids=request.brain_ids,
            brain_documents=request.brain_documents,
            brain_relations=request.brain_relations,
            vectorstore_name=request.vectorstore_name,
            search_web=request.search_web if request.search_web else False,
            agent_mode="manual"
        )

        agent_team_request.available_agents = available_agents
        logger.info(
            f"[RUN_PLAYBOOK] Calling run_agent_team_logic - "
            f"SessionId: {request.session_id}, "
            f"UserId: {request.user_id}, "
            f"Manager: {request.manager_agent.name}, "
            f"Available agents: {[agent.name for agent in agents]}"
        )

        # Step 4: Call run_agent_team_logic
        await run_agent_team_logic(agent_team_request, queue)

        logger.info(
            f"[RUN_PLAYBOOK] Playbook execution completed successfully - "
            f"PlaybookId: {request.playbook_id}"
        )

    except Exception as e:
        logger.error(
            f"[RUN_PLAYBOOK] Error executing playbook {request.playbook_id}: {str(e)}"
        )
        raise