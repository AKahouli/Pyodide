"""Playbook generation prompt builder.

Ported from langgraph_engine/generate_playbook_prompt.py.
Produces DAG-only output initially; loops are a follow-up.
"""

from typing import Any, Dict, List, Optional


def build_generation_prompt(
    user_query: str,
    available_agents: List[Dict[str, Any]],
    workspace_context: Optional[List[Dict[str, Any]]] = None,
    existing_playbook: Optional[Dict[str, Any]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build system and user prompts for playbook generation.

    Args:
        user_query: The user's natural language request.
        available_agents: List of agent configs with id, name, role, tools.
        workspace_context: Optional workspace document context.
        existing_playbook: Optional existing flow to modify.
        prompt_overrides: Optional prompt template overrides.

    Returns:
        Dict with 'system_prompt' and 'user_prompt' keys.
    """
    sys_lines = [
        "You are an expert playbook architect.",
        "Produce a valid, actionable workflow as a FlowSnapshot.",
        "Use only the provided agents. Do not invent agent names or tool names.",
    ]

    if existing_playbook:
        sys_lines.append("Modify the existing workflow to match the user's request.")

    agent_list = "\n".join(
        f"- {a.get('name', 'Unknown')} ({a.get('role', 'no role')}): {a.get('id', '')}"
        for a in available_agents[:20]
    )

    user_lines = [
        f"User request: {user_query}",
        "",
        "Available agents:",
        agent_list,
    ]

    if existing_playbook:
        user_lines.append(f"\nExisting workflow: {existing_playbook}")

    return {
        "system_prompt": "\n".join(sys_lines),
        "user_prompt": "\n".join(user_lines),
    }
