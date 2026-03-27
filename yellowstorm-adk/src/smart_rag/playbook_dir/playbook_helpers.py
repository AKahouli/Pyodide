from typing import List
from src.schema.playbook import RunPlaybookStepRequest


def construct_workplan(steps: List[RunPlaybookStepRequest]) -> str:
    """
    Construct a workplan string from a list of playbook steps.

    Args:
        steps: List of RunPlaybookStepRequest objects containing step information

    Returns:
        str: A formatted workplan string listing all steps with their descriptions and agents
    """
    workplan = "You MUST follow the following workplan :\n\n"

    for idx, step in enumerate(steps, start=1):
        agent_name = step.agent.name if step.agent else "Agent non spécifié"
        workplan += f"- Step {idx}: {step.taskDescription} (Agent: {agent_name})\n"

    return workplan


def construct_manager_prompt(manager_prompt: str, workplan: str, manager_agent_prompt: str) -> tuple[str, str]:
    """
    Construct the manager agent prompts by integrating workplan execution instructions.

    The manager_prompt is expected to contain multiple prompts separated by '###'.
    This function will retrieve the second-to-last prompt, concatenate it with the
    workplan override instructions, and place it back at the same position.

    Additionally, it creates a second prompt by concatenating the override instructions
    with the manager_agent_prompt (which is a single mono-prompt).

    When a workplan is provided, the manager should follow it exactly as specified
    and delegate tasks to the agents mentioned in the workplan without deviation.

    Args:
        manager_prompt: The original manager agent prompt containing multiple prompts separated by '###'
        workplan: The workplan string containing steps and agent assignments
        manager_agent_prompt: The manager agent's mono-prompt to be concatenated with override instructions

    Returns:
        tuple[str, str]: A tuple containing:
            - The modified manager prompt with workplan execution instructions inserted at the penultimate position
            - The manager_agent_prompt concatenated with the override instructions
    """
    # Instructions to prepend that override the manager's normal planning behavior
    workplan_override_instructions = f"""
<PLAYBOOK_EXECUTION_MODE>
CRITICAL INSTRUCTION: You are currently in PLAYBOOK EXECUTION MODE so you don't have to generate a workplan.

A predefined workplan has been provided to you. Your role is to execute this workplan by following its structure and task types, while adapting the specific details to match the user's actual request.

{workplan}

MANDATORY EXECUTION RULES:
1. You MUST delegate each task in the workplan to the EXACT agent specified
2. You MUST follow the workplan sequence without skipping or reordering tasks
3. You MUST adapt the task descriptions to match the user's specific request while keeping the same task type and structure

   ADAPTATION EXAMPLES:
   - If the workplan says "search for financial data of company Y" but the user asks about "company X",
     you MUST adapt to "search for financial data of company X"
   - If the workplan says "provide IFRS15 standards" but the user asks about "IFRS16",
     you MUST adapt to "provide IFRS16 standards"
   - Keep the same task structure and type (search, analysis, calculation, etc.) but replace specific entities,
     documents, references, names, dates, or parameters with those mentioned in the user's request

4. You MUST NOT create additional tasks unless a task explicitly fails and requires remediation
5. You MUST mark each task as "In Progress" when delegating, then "Finished" upon receiving the agent's response
6. You MUST update the workplan status after each task completion
7. You MUST proceed with immediate delegation without asking for user confirmation of the workplan
8. You MUST NEVER ask the user for confirmation, you only Must delegate tasks.

EXECUTION WORKFLOW:
- For each step in the workplan:
  1. Analyze the user's request to identify specific entities, parameters, and requirements
  2. Adapt the task description to match the user's specific request (company names, document references, dates, etc.)
  3. Mark the task status as "In Progress"
  4. Delegate immediately to the specified agent with the adapted task description
  5. Wait for the agent's response
  6. Mark the task status as "Finished"
  7. Move to the next task in the workplan

- If an agent reports missing data or errors:
  1. Create a remediation task
  2. Delegate to the appropriate agent to resolve the issue
  3. Return to the original workplan sequence once resolved

IMPORTANT: Adapt task descriptions to the user's context while maintaining the workplan's structure and agent assignments.
</PLAYBOOK_EXECUTION_MODE>

"""

    # Split the manager_prompt by '###'
    prompt_sections = manager_prompt.split('###')

    # Check if we have at least 2 sections to get the penultimate one
    if len(prompt_sections) < 2:
        # If there's only one section or none, prepend the instructions as before
        modified_prompt = workplan_override_instructions + "\n\n" + manager_prompt
    else:
        # Get the penultimate (second-to-last) prompt
        penultimate_index = -2
        penultimate_prompt = prompt_sections[penultimate_index]

        # Concatenate the penultimate prompt with the workplan override instructions
        modified_penultimate = workplan_override_instructions + "\n\n" + penultimate_prompt + "\n\n" + "===============\nYou are in the playbook mode: YOU MUST NEVER EVER ASK THE USER FOR HIS CONFIRMATION !!! START AUTOMATICALLY THE STEPS DELEGATION."

        # Replace the penultimate prompt with the modified version
        prompt_sections[penultimate_index] = modified_penultimate

        # Reassemble the manager_prompt with '###' separator
        modified_prompt = '###'.join(prompt_sections)

    # Create the second prompt by concatenating override instructions with manager_agent_prompt
    modified_manager_agent_prompt = workplan_override_instructions + "\n\n" + manager_agent_prompt + "\n\n" + "===============\nYou are in the playbook mode: YOU MUST NEVER EVER ASK THE USER FOR HIS CONFIRMATION !!! START AUTOMATICALLY THE STEPS DELEGATION."

    return modified_prompt, modified_manager_agent_prompt
