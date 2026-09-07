from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool, StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from src.flow_engine.agent_runtime.context import StepRuntimeContext
from src.flow_engine.agent_runtime.model import build_model_node
from src.flow_engine.agent_runtime.state import StepAgentState
from src.flow_engine.agent_runtime.tool_wrapper import build_tool_wrapper


def build_step_agent_graph(tools: list[Any]):
    tools = [_as_langchain_tool(tool) for tool in tools]
    builder = StateGraph(StepAgentState, context_schema=StepRuntimeContext)
    builder.add_node("model", build_model_node(tools))
    builder.add_edge(START, "model")
    if tools:
        builder.add_node("tools", ToolNode(tools, awrap_tool_call=build_tool_wrapper(), handle_tool_errors=False))
        builder.add_conditional_edges("model", _route_after_model, {"tools": "tools", "end": END})
        builder.add_edge("tools", "model")
    else:
        builder.add_edge("model", END)
    return builder.compile()


def _as_langchain_tool(tool: Any) -> BaseTool:
    if isinstance(tool, BaseTool):
        return tool

    async def invoke(**kwargs: Any) -> Any:
        return await tool.ainvoke(kwargs)

    return StructuredTool(
        name=str(tool.name),
        description=str(getattr(tool, "description", "") or ""),
        func=None,
        coroutine=invoke,
        args_schema=getattr(tool, "args_schema", None),
        metadata=getattr(tool, "metadata", None),
    )


def _route_after_model(state: StepAgentState) -> str:
    if state.get("guardrail_blocked"):
        return "end"
    last = state["messages"][-1]
    return "tools" if isinstance(last, AIMessage) and last.tool_calls else "end"


async def run_step_agent(*, system_prompt: str, user_msg: str, tools: list[Any], context: StepRuntimeContext) -> str:
    graph = build_step_agent_graph(tools)
    result = await graph.ainvoke(
        {"messages": [SystemMessage(content=system_prompt), HumanMessage(content=user_msg)], "tool_iterations": 0, "guardrail_blocked": False, "guardrail_reason": ""},
        config={"recursion_limit": 2 * max(context.max_tool_iterations, 0) + 2},
        context=context,
    )
    last = result["messages"][-1]
    return str(last.content or "")
