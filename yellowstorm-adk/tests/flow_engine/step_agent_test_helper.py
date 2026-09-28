from typing import Any

from src.flow_engine.agent_runtime import StepRuntimeContext, run_step_agent


async def run_step_with_tools(
    model_id: str,
    system_prompt: str,
    user_msg: str,
    tools: list[Any],
    on_progress: Any = None,
    on_trace_update: Any = None,
    trace_collector: Any = None,
    agent_role: str = "parent",
    agent_name: str = "",
    summary_session_id: str = "",
    **_kwargs: Any,
) -> str:
    return await run_step_agent(
        system_prompt=system_prompt,
        user_msg=user_msg,
        tools=tools,
        context=StepRuntimeContext(
            model_id=model_id, on_progress=on_progress,
            on_trace_update=on_trace_update, trace_collector=trace_collector,
            agent_role=agent_role, agent_name=agent_name,
            summary_session_id=summary_session_id, tools_enabled=True,
        ),
    )
