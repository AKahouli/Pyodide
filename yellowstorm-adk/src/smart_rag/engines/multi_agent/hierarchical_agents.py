"""Hierarchical teams using YellowStorm's delegated AgentRunner lifecycle.

Native ADK sub-agents were rejected because they bypass run_agent_tool, which owns
the product's child streaming, connector, citation, artifact, and memory behavior.
"""

import asyncio
from collections import deque

from src.schema.chatbot_schema import AgentSuggestion, RunAgentTeamRequest

MAX_TEAM_NODES = 25
MAX_TEAM_DEPTH = 5


def validate_hierarchical_request(request: RunAgentTeamRequest) -> tuple[AgentSuggestion, dict[str, list[str]]]:
    definition = request.team_definition
    if request.agent_mode != "hierarchical" or definition is None:
        raise ValueError("Hierarchical mode requires exactly one team definition")
    if not definition.team_id or not definition.nodes or len(definition.nodes) > MAX_TEAM_NODES:
        raise ValueError("Invalid hierarchical team size")

    agents = {agent.id: agent for agent in request.agents or []}
    nodes = {node.agent_id: node for node in definition.nodes}
    if len(agents) != len(request.agents or []) or len(nodes) != len(definition.nodes) or set(nodes) != set(agents):
        raise ValueError("Team topology and agent definitions must have identical IDs")

    roots = [node for node in definition.nodes if node.parent_agent_id is None]
    if len(roots) != 1:
        raise ValueError("An executable team must have exactly one root")

    children: dict[str, list] = {}
    for node in definition.nodes:
        if node.parent_agent_id == node.agent_id:
            raise ValueError("An agent cannot be its own parent")
        if node.parent_agent_id and node.parent_agent_id not in nodes:
            raise ValueError("Every parent must be a team member")
        if node.parent_agent_id:
            children.setdefault(node.parent_agent_id, []).append(node)
    for siblings in children.values():
        siblings.sort(key=lambda node: node.order)

    visited: set[str] = set()
    queue = deque([(roots[0].agent_id, 1)])
    while queue:
        agent_id, depth = queue.popleft()
        if agent_id in visited:
            raise ValueError("Team hierarchy must be acyclic")
        if depth > MAX_TEAM_DEPTH:
            raise ValueError("Team hierarchy exceeds maximum depth")
        visited.add(agent_id)
        queue.extend((child.agent_id, depth + 1) for child in children.get(agent_id, []))
    if visited != set(nodes):
        raise ValueError("Every team member must be reachable from the root")

    for agent_id in {roots[0].agent_id, *children.keys()}:
        if agents[agent_id].agent_type != "manager":
            raise ValueError("The root and every parent must be manager agents")

    return agents[roots[0].agent_id], {
        parent_id: [child.agent_id for child in direct_children]
        for parent_id, direct_children in children.items()
    }


async def handle_hierarchical_agents_workflow(team, user_request: RunAgentTeamRequest, q: asyncio.Queue[dict]) -> None:
    root, children = validate_hierarchical_request(user_request)
    agents = {agent.id: agent for agent in user_request.agents or []}
    team.delegation_factory.set_hierarchy(children)

    for agent_id in [node.agent_id for node in user_request.team_definition.nodes]:
        agent = agents[agent_id]
        agent_data = team.agent_helper._prepare_agent_data(agent, user_request, team)
        agent_data["display_name"] = agent.name
        agent_data["name"] = "manager_agent" if agent_id == root.id else f"agent_{agent_id}"
        team.agent_repository.add_agent(agent_data)

    direct_children = [team.agent_repository.get_agent_by_id(agent_id) for agent_id in children.get(root.id, [])]
    prompt = team.agent_helper._create_enhanced_manager_prompt(root.prompt, direct_children, team.config)
    await team.run_agent_team(
        user_request.message,
        prompt,
        user_request.session_id,
        root.save_memory,
        q=q,
        manager_temperature=(root.agent_params or {}).get("temperature"),
        image_input=user_request.image_input,
        original_agents=[root],
        delegate_agent_ids=children.get(root.id, []),
        manager_agent_id=root.id,
    )
