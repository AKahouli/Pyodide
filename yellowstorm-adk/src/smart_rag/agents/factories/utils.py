from typing import Dict, Any, List

def create_enhanced_prompt(tool_provider, agent_repository, agent_config: Dict[str, Any], tools, tools_for_config=None) -> str:
    """Create enhanced prompt with tool descriptions and context.

    Builds a comprehensive prompt by combining the base agent prompt with
    tool descriptions, citation requirements, conversation context, and
    source reference requirements based on agent type and team composition.

    Args:
        agent_config (Dict[str, Any]): Agent configuration containing base prompt.
        tools: List of tools available to the agent (strings or configs).
        tools_for_config: Optional detailed tool configurations with custom descriptions and settings.

    Returns:
        str: Enhanced prompt with all necessary context and instructions.
    """
    # Use tools_for_config for descriptions if provided, otherwise use tools
    tools_with_configs = tools_for_config if tools_for_config is not None else tools

    base_prompt = (agent_config['prompt'] +
                   tool_provider.get_tools_description(tools_with_configs) )
    # Add source reference requirements for non-HTML agents when search agents exist in team
    is_html_agent = agent_config.get('html', False)

    return base_prompt


def process_execution_summary(execution_summary, delegation_span):
    """Process execution summary and add events to span."""
    if not execution_summary or not isinstance(execution_summary, dict):
        return

    execution_flow = execution_summary.get("execution_flow", [])
    for step in execution_flow:
        process_execution_step(step, delegation_span)


def process_execution_step(step, delegation_span):
    """Process a single execution step and add appropriate event."""
    step_type = step.get("step_type")

    if step_type == "function_execution":
        add_function_execution_event(step, delegation_span)
    elif step_type == "text_generation":
        delegation_span.event(
            name=step_type,
            output=step.get("content", ""),
        )
    elif step_type == "error":
        delegation_span.event(
            name="error",
            output={
                "error_message": step.get("error_message", ""),
                "error_type": "agent_execution_error"
            },
        )
    else:
        delegation_span.event(
            name=step_type,
            output=step.get("output", step.get("content", "")),
        )


def add_function_execution_event(step, delegation_span):
    """Add function execution event with proper input/output handling."""
    event_kwargs = {
        "name": f"function_{step['input']['function_name']}",
        "input": step["input"]
    }
    # Add output only if it exists and is not None (following TraceRecorder pattern)
    if step.get("output") is not None:
        event_kwargs["output"] = step["output"]
    delegation_span.event(**event_kwargs)


def update_span_with_execution_result(delegation_span, result, execution_summary, agent_name):
    """Update span with execution result based on success/failure."""
    success = determine_execution_success(execution_summary)

    if not success:
        error_count = get_error_count(execution_summary)
        delegation_span.update(output={
            "result": result,
            "execution_status": "failed",
            "error_count": error_count,
            "agent_name": agent_name
        })
    else:
        delegation_span.update(output={
            "result": result,
            "execution_status": "success",
            "agent_name": agent_name
        })


def determine_execution_success( execution_summary):
    """Determine if execution was successful."""
    if not execution_summary:
        return True
    return execution_summary.get("execution_statistics", {}).get("execution_success", True)


def get_error_count(execution_summary):
    """Get error count from execution summary."""
    if not execution_summary:
        return 0
    return execution_summary.get("execution_statistics", {}).get("errors_count", 0)
