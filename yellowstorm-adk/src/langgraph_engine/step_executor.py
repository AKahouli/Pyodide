"""Single-step task executor for isolated task execution with LangChain agents."""

import json
import time
import uuid
from typing import Dict, Any, Optional, List

from structlog import get_logger

from langchain_core.runnables import RunnableConfig
from src.langgraph_engine.state import TaskConfig, AgentConfig

logger = get_logger(__name__)

MAX_TOOL_ITERATIONS = 10  # Guard against infinite tool-calling loops
SKIP_STEP_REASON = "__SKIP_STEP__"


def _serialize_prompt_messages(messages: List[Dict[str, str]]) -> str:
    blocks: List[str] = []
    for message in messages:
        role = str(message.get("role", "unknown")).upper()
        content = str(message.get("content", ""))
        blocks.append(f"[{role}]\n{content}")
    return "\n\n".join(blocks)


def _append_prompt_trace(
    prompt_trace: Optional[List[Dict[str, Any]]],
    *,
    stage: str,
    model: str,
    messages: List[Dict[str, str]],
) -> None:
    if prompt_trace is None:
        return
    prompt_trace.append({
        "stage": stage,
        "model": model,
        "prompt": _serialize_prompt_messages(messages),
    })


def _summarize_tool_args(args: Any, max_length: int = 500) -> str:
    """Return a bounded JSON-ish string for logging tool args."""
    text = str(args)
    if len(text) <= max_length:
        return text
    return f"{text[:max_length]}...[truncated]"


def _summarize_tool_result(result: Any, max_length: int = 2000) -> str:
    """Return a bounded text summary suitable for persistence in execution traces."""
    text = str(result)
    if len(text) <= max_length:
        return text
    return f"{text[:max_length]}...[truncated]"


def _extract_interrupt_from_snapshot(state_snapshot, task_id: str, thread_id: str) -> Optional[Dict[str, Any]]:
    """Extract interrupt payload from a LangGraph state snapshot.

    After ainvoke returns, if state_snapshot.next is non-empty the graph
    is suspended. The interrupt values are stored in state_snapshot.tasks.
    """
    for pregel_task in state_snapshot.tasks:
        if hasattr(pregel_task, "interrupts") and pregel_task.interrupts:
            iv = pregel_task.interrupts[0].value
            if isinstance(iv, dict):
                return {
                    "type": iv.get("type", ""),
                    "task_id": iv.get("task_id", task_id),
                    "task_title": iv.get("task_title", ""),
                    "message": iv.get("message", ""),
                    "thread_id": thread_id,
                    "task_description": iv.get("task_description", ""),
                    "result": iv.get("result", ""),
                }
    return None


def _extract_usage(response) -> Dict[str, Any]:
    """Extract token usage from a LangChain AIMessage response.

    Checks usage_metadata (LangChain >=0.2) then response_metadata fallback.
    """
    usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "model": ""}

    # LangChain >= 0.2: usage_metadata
    if hasattr(response, "usage_metadata") and response.usage_metadata:
        um = response.usage_metadata
        usage["input_tokens"] = um.get("input_tokens", 0)
        usage["output_tokens"] = um.get("output_tokens", 0)
        usage["total_tokens"] = um.get("total_tokens", 0)
    # Fallback: response_metadata.token_usage
    elif hasattr(response, "response_metadata") and response.response_metadata:
        tu = response.response_metadata.get("token_usage", {})
        usage["input_tokens"] = tu.get("prompt_tokens", 0)
        usage["output_tokens"] = tu.get("completion_tokens", 0)
        usage["total_tokens"] = tu.get("total_tokens", 0)

    if hasattr(response, "response_metadata") and response.response_metadata:
        usage["model"] = response.response_metadata.get("model_name", "")

    return usage


def _is_skip_step_response(response: Any) -> bool:
    return (
        isinstance(response, dict)
        and response.get("approved") is False
        and response.get("reason") == SKIP_STEP_REASON
    )


def _format_workspace_file_hint(workspace_context: Optional[list], max_files: int = 12) -> str:
    """Build a short hint listing files already available from workspace context."""
    filenames: List[str] = []
    seen = set()
    for workspace in workspace_context or []:
        for doc in workspace.get("documents", []):
            filename = str(doc.get("filename", "")).strip()
            if filename and filename not in seen:
                filenames.append(filename)
                seen.add(filename)

    if not filenames:
        return ""

    visible = filenames[:max_files]
    suffix = ""
    if len(filenames) > max_files:
        suffix = f" (+{len(filenames) - max_files} more)"
    return ", ".join(visible) + suffix


async def execute_step(
    task: TaskConfig,
    agent: AgentConfig,
    context_from_dependencies: str = "",
    workspace_context: Optional[list] = None,
    execution_mode: str = "live",
    validated_replay: Optional[Dict[str, Any]] = None,
    evaluation_user_id: str = "unknown",
) -> Dict[str, Any]:
    """Execute a single task with an agent.

    If HITL is needed (interrupt_before/after), wraps in a mini LangGraph
    with interrupt support.

    Args:
        task: Task configuration
        agent: Agent configuration
        context_from_dependencies: Context string from dependency task results
        workspace_context: Optional workspace context

    Returns:
        Dict with keys: status, result (TaskResult-like dict), interrupt, thread_id
    """
    task_id = task.get("id", "unknown")
    tool_configs = agent.get("tools", [])
    needs_hitl = task.get("interrupt_before", False) or task.get("interrupt_after", False)

    if needs_hitl:
        return await _execute_step_with_hitl(
            task,
            agent,
            context_from_dependencies,
            workspace_context,
            execution_mode,
            validated_replay,
            evaluation_user_id,
        )

    return await _execute_step_simple(
        task,
        agent,
        context_from_dependencies,
        workspace_context,
        execution_mode,
        validated_replay,
        evaluation_user_id,
    )


async def _execute_step_simple(
    task: TaskConfig,
    agent: AgentConfig,
    context_from_dependencies: str = "",
    workspace_context: Optional[list] = None,
    execution_mode: str = "live",
    validated_replay: Optional[Dict[str, Any]] = None,
    evaluation_user_id: str = "unknown",
) -> Dict[str, Any]:
    """Execute a step without HITL — direct agent call, with real tools if available."""
    from src.config.settings import get_settings

    settings = get_settings()
    task_id = task.get("id", "unknown")
    start_time = time.time()

    agent_instructions = agent.get("instructions") or agent.get("prompt", "")
    model_name = agent.get("model") or "gpt-4.1"
    agent_params = agent.get("agent_params") or {}
    temperature = float(agent_params.get("temperature", 0.7))

    system_prompt = (
        f"You are {agent['name']}.\n\n"
        f"Your instructions:\n{agent_instructions}\n\n"
        f"You are working on a task as part of a playbook execution."
    )

    user_prompt = f"Task: {task['title']}\n\nDescription:\n{task['description']}"
    if context_from_dependencies:
        user_prompt += f"\n\nContext from previous tasks:\n{context_from_dependencies}"
    workspace_file_hint = _format_workspace_file_hint(workspace_context)
    if workspace_file_hint:
        user_prompt += (
            "\n\nWorkspace files already available in the sandbox:\n"
            f"{workspace_file_hint}\n"
            "Do not ask the user to upload these files again."
        )
    user_prompt += "\n\nPlease complete this task and provide a clear output."
    llm_prompt_trace: List[Dict[str, Any]] = []

    try:
        # Create real LangChain tools from agent config
        from src.langgraph_engine.playbook_tool_factory import create_langchain_tools

        # Get input_files from task config if available (for document filtering)
        input_files = task.get("input_files")

        logger.info(
            f"[{task_id}] INPUT_FILES_DEBUG",
            has_input_files=input_files is not None,
            input_files_count=len(input_files) if input_files else 0,
        )

        lc_tools, collector = create_langchain_tools(
            agent, workspace_context=workspace_context, input_files=input_files
        )

        if execution_mode in ("replay_strict", "replay_flex", "replay_adaptive") and validated_replay:
            logger.info(
                "[%s] REPLAY_PATH_SELECTED",
                task_id,
                execution_mode=execution_mode,
                replay_id=validated_replay.get("replay_id"),
                replay_task_id=validated_replay.get("task_id"),
                replay_tool_calls=len(validated_replay.get("tool_calls", []) or []),
                available_tools=[tool.name for tool in lc_tools],
            )
            if not lc_tools:
                raise ValueError(f"Validated replay for task {task_id} cannot run because no tools are configured")
            strict_response, components, tool_trace, synthesis_context = await _execute_replay_tool_calls(
                lc_tools,
                collector,
                validated_replay,
                prompt_trace=llm_prompt_trace,
                adaptive=execution_mode == "replay_adaptive",
                adaptation_context={
                    "task_id": task_id,
                    "task_title": task.get("title", ""),
                    "task_description": task.get("description", ""),
                    "current_query": "",
                    "dependency_context": context_from_dependencies,
                    "reference_task_title": validated_replay.get("task_title", ""),
                    "reference_task_description": validated_replay.get("reference_task_description", ""),
                },
                settings=settings,
                model_name=model_name,
            )
            if execution_mode in ("replay_flex", "replay_adaptive"):
                logger.info("[%s] REPLAY_FLEX_FINAL_SYNTHESIS", task_id)
                format_guide = (validated_replay.get("output_format_guide") or "").strip()
                format_instruction = ""
                if validated_replay.get("preserve_output_format") and format_guide:
                    format_instruction = (
                        "\n\n#Output Furmat guidelines\n"
                        f"{format_guide}\n\n"
                        "Keep the structure and presentation style, but refresh the content from the current replay evidence only."
                    )
                replay_user_prompt = (
                    f"{user_prompt}\n\n"
                    "Use the following replayed tool execution results to produce the final answer.\n\n"
                    f"{synthesis_context}"
                    f"{format_instruction}"
                )
                response, usage = await _llm_call(
                    settings, model_name, system_prompt, replay_user_prompt,
                    temperature=temperature, prompt_trace=llm_prompt_trace, stage="replay_final_synthesis"
                )
            else:
                response = strict_response
                usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "model": ""}
        elif lc_tools:
            logger.info(f"[{task_id}] Executing with real tools", count=len(lc_tools),
                        tools=[t.name for t in lc_tools])
            response, components, usage, tool_trace, llm_prompt_trace = await _execute_with_tools(
                settings, model_name, system_prompt, user_prompt, lc_tools, collector, temperature=temperature
            )
        else:
            response, usage = await _llm_call(
                settings, model_name, system_prompt, user_prompt,
                temperature=temperature, prompt_trace=llm_prompt_trace, stage="task_direct_completion"
            )
            components = []
            tool_trace = []

        # Wrap visualizer agent output as a web_preview component
        is_visualizer = (
            agent.get("agent_type") == "visualizer"
            or agent.get("name") == "Visualizer Agent"
            or "visualizer_agent" in (agent.get("name") or "").lower()
        )
        if is_visualizer and response:
            components.insert(0, {
                "type": "web_preview",
                "data": {"content": response},
            })

        duration_ms = int((time.time() - start_time) * 1000)
        semantic_match = None

        return {
            "status": "completed",
            "result": {
                "task_id": task_id,
                "status": "completed",
                "output": "" if is_visualizer else response,
                "error": "",
                "duration_ms": duration_ms,
                "components": components,
                "usage": usage,
                "tool_trace": tool_trace,
                "llm_prompt_trace": llm_prompt_trace,
                "semantic_match": semantic_match,
            },
            "interrupt": None,
            "thread_id": "",
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error(f"[{task_id}] Step execution failed", error=error_msg)

        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": error_msg,
                "duration_ms": duration_ms,
                "llm_prompt_trace": llm_prompt_trace,
            },
            "interrupt": None,
            "thread_id": "",
        }


async def _execute_step_with_hitl(
    task: TaskConfig,
    agent: AgentConfig,
    context_from_dependencies: str = "",
    workspace_context: Optional[list] = None,
    execution_mode: str = "live",
    validated_replay: Optional[Dict[str, Any]] = None,
    evaluation_user_id: str = "unknown",
) -> Dict[str, Any]:
    """Execute a step with HITL support — wraps in a mini LangGraph with interrupt."""
    from langgraph.graph import StateGraph, END
    from langgraph.types import interrupt
    from src.langgraph_engine.checkpointer import get_checkpointer
    from src.langgraph_engine.graph_cache import store_thread_graph
    from typing_extensions import TypedDict
    from typing import Annotated

    task_id = task.get("id", "unknown")
    thread_id = f"step_{task_id}_{uuid.uuid4().hex[:8]}"

    class StepState(TypedDict):
        task: Dict[str, Any]
        agent: Dict[str, Any]
        context: str
        output: Optional[str]
        status: str
        error: Optional[str]
        components: List[Dict[str, Any]]
        usage: Dict[str, Any]
        tool_trace: List[Dict[str, Any]]
        llm_prompt_trace: List[Dict[str, Any]]
        semantic_match: Optional[Dict[str, Any]]
        execution_mode: str
        validated_replay: Optional[Dict[str, Any]]

    async def execute_node(state: StepState, config: RunnableConfig) -> Dict[str, Any]:
        t = state["task"]
        a = state["agent"]

        if t.get("interrupt_before", False):
            approval_payload = {
                "type": "approval_request",
                "task_id": t.get("id", ""),
                "task_title": t.get("title", ""),
                "message": f"Task '{t.get('title', '')}' requires approval.",
                "thread_id": thread_id,
            }
            approval_response = interrupt(approval_payload)
            if _is_skip_step_response(approval_response):
                return {
                    "status": "skipped",
                    "error": None,
                }
            if isinstance(approval_response, dict) and approval_response.get("approved") is False:
                return {
                    "status": "failed",
                    "error": approval_response.get("reason", "Rejected"),
                }

        result = await _execute_step_simple(
            t,
            a,
            state.get("context", ""),
            workspace_context,
            state.get("execution_mode", "live"),
            state.get("validated_replay"),
            evaluation_user_id,
        )

        if t.get("interrupt_after", False) and result["status"] == "completed":
            review_payload = {
                "type": "review_request",
                "task_id": t.get("id", ""),
                "task_title": t.get("title", ""),
                "result": result["result"]["output"],
                "message": f"Task '{t.get('title', '')}' completed. Please review.",
                "thread_id": thread_id,
            }
            review_response = interrupt(review_payload)
            if _is_skip_step_response(review_response):
                return {
                    "status": "skipped",
                    "error": None,
                }
            if isinstance(review_response, dict) and review_response.get("approved") is False:
                return {
                    "status": "failed",
                    "error": review_response.get("reason", "Rejected"),
                }

        return {
            "output": result["result"]["output"] if result["status"] == "completed" else None,
            "status": result["status"],
            "error": result.get("result", {}).get("error"),
            "components": result.get("result", {}).get("components", []),
            "usage": result.get("result", {}).get("usage", {}),
            "tool_trace": result.get("result", {}).get("tool_trace", []),
            "llm_prompt_trace": result.get("result", {}).get("llm_prompt_trace", []),
            "semantic_match": result.get("result", {}).get("semantic_match"),
        }

    workflow = StateGraph(StepState)
    workflow.add_node("execute", execute_node)
    workflow.set_entry_point("execute")
    workflow.add_edge("execute", END)

    checkpointer = await get_checkpointer()
    compiled = workflow.compile(checkpointer=checkpointer)

    store_thread_graph(thread_id, compiled)

    initial_state: StepState = {
        "task": dict(task),
        "agent": dict(agent),
        "context": context_from_dependencies,
        "output": None,
        "status": "in_progress",
        "error": None,
        "components": [],
        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "model": ""},
        "tool_trace": [],
        "llm_prompt_trace": [],
        "semantic_match": None,
        "execution_mode": execution_mode,
        "validated_replay": validated_replay,
    }

    config = {"configurable": {"thread_id": thread_id}}

    try:
        final_state = await compiled.ainvoke(initial_state, config)

        # Check if the graph is suspended (HITL interrupt)
        state_snapshot = await compiled.aget_state(config)
        if state_snapshot.next:
            interrupt_data = _extract_interrupt_from_snapshot(state_snapshot, task_id, thread_id)
            logger.info(f"[{task_id}] Graph suspended (HITL)", interrupt_type=interrupt_data.get("type") if interrupt_data else None)
            return {
                "status": "suspended",
                "result": {
                    "task_id": task_id,
                    "status": "suspended",
                    "output": "",
                    "error": "",
                    "duration_ms": 0,
                },
                "interrupt": interrupt_data,
                "thread_id": thread_id,
            }

        final_status = final_state.get("status", "completed")
        return {
            "status": final_status,
            "result": {
                "task_id": task_id,
                "status": final_status,
                "output": final_state.get("output", ""),
                "error": final_state.get("error", ""),
                "duration_ms": 0,
                "components": final_state.get("components", []),
                "usage": final_state.get("usage", {}),
                "tool_trace": final_state.get("tool_trace", []),
                "llm_prompt_trace": final_state.get("llm_prompt_trace", []),
                "semantic_match": final_state.get("semantic_match"),
            },
            "interrupt": None,
            "thread_id": thread_id,
        }

    except Exception as e:
        error_str = str(e)
        logger.error(f"[{task_id}] HITL step execution failed", error=error_str)
        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": error_str,
                "duration_ms": 0,
            },
            "interrupt": None,
            "thread_id": thread_id,
        }


async def _execute_with_tools(
    settings,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    tools: List,
    collector=None,
    temperature: float = 0.7,
) -> tuple:
    """Execute an LLM call with tool binding and agentic tool-calling loop.

    The LLM can iteratively call tools and receive results until it produces
    a final text response (no more tool_calls).

    Returns:
        Tuple of (response_text, components_list, usage_dict, tool_trace, prompt_trace).
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage

    llm = ChatOpenAI(
        base_url=settings.LITELLM_API_BASE_URL,
        api_key=settings.LITELLM_API_SECRET_KEY,
        model=model_name,
        temperature=temperature,
    )
    llm_with_tools = llm.bind_tools(tools)

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    tool_map = {t.name: t for t in tools}
    all_components = []
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "model": ""}
    tool_trace = []
    prompt_trace: List[Dict[str, Any]] = []

    for iteration in range(MAX_TOOL_ITERATIONS):
        _append_prompt_trace(
            prompt_trace,
            stage=f"tool_loop_iteration_{iteration + 1}",
            model=model_name,
            messages=[
                {
                    "role": getattr(message, "type", message.__class__.__name__),
                    "content": str(getattr(message, "content", "")),
                }
                for message in messages
            ],
        )
        response = await llm_with_tools.ainvoke(messages)
        messages.append(response)

        # Accumulate usage from each LLM call
        iter_usage = _extract_usage(response)
        total_usage["input_tokens"] += iter_usage["input_tokens"]
        total_usage["output_tokens"] += iter_usage["output_tokens"]
        total_usage["total_tokens"] += iter_usage["total_tokens"]
        total_usage["model"] = iter_usage["model"] or total_usage["model"]

        if not response.tool_calls:
            return response.content or "", all_components, total_usage, tool_trace, prompt_trace

        logger.info(
            "Tool calls in iteration",
            iteration=iteration,
            calls=[tc["name"] for tc in response.tool_calls],
        )

        for tool_call in response.tool_calls:
            tool = tool_map.get(tool_call["name"])
            if tool:
                try:
                    result = await tool.ainvoke(tool_call["args"])
                except Exception as e:
                    result = f"Error executing tool '{tool_call['name']}': {e}"
                    logger.error("Tool execution error", tool=tool_call["name"], error=str(e))
            else:
                result = f"Unknown tool: {tool_call['name']}"
                logger.warning("Unknown tool called", tool=tool_call["name"])

            messages.append(ToolMessage(
                content=str(result),
                tool_call_id=tool_call["id"],
            ))

            tool_trace.append({
                "call_index": len(tool_trace) + 1,
                "tool_name": tool_call["name"],
                "args": tool_call.get("args", {}),
                "output_summary": _summarize_tool_result(result),
            })

            # Collect components generated by this tool call
            if collector:
                all_components.extend(collector.get_and_clear())

    # Fallback: exceeded max iterations, return last content
    logger.warning("Max tool iterations reached", max=MAX_TOOL_ITERATIONS)
    last_content = messages[-1].content if hasattr(messages[-1], "content") else ""
    return last_content or "Max tool iterations reached without a final response.", all_components, total_usage, tool_trace, prompt_trace


async def _execute_replay_tool_calls(
    tools: List,
    collector,
    validated_replay: Dict[str, Any],
    prompt_trace: Optional[List[Dict[str, Any]]] = None,
    adaptive: bool = False,
    adaptation_context: Optional[Dict[str, Any]] = None,
    settings=None,
    model_name: Optional[str] = None,
) -> tuple[str, List[Dict[str, Any]], List[Dict[str, Any]], str]:
    """Execute a recorded tool trajectory with exact recorded args.

    Returns:
        Tuple of (strict_reference_output, components, tool_trace, synthesis_context)
    """
    tool_map = {tool.name: tool for tool in tools}
    all_components: List[Dict[str, Any]] = []
    tool_trace: List[Dict[str, Any]] = []
    synthesis_entries: List[str] = []
    replay_id = validated_replay.get("replay_id", "")
    replay_task_id = validated_replay.get("task_id", "")

    logger.info(
        "[replay_executor] EXECUTE_REPLAY_TOOL_CALLS_START",
        replay_id=replay_id,
        replay_task_id=replay_task_id,
        tool_call_count=len(validated_replay.get("tool_calls", []) or []),
        available_tools=list(tool_map.keys()),
        adaptive=adaptive,
    )

    for recorded_call in validated_replay.get("tool_calls", []) or []:
        tool_name = recorded_call.get("tool_name") or ""
        tool_args = recorded_call.get("args") or {}
        call_index = int(recorded_call.get("call_index", len(tool_trace) + 1))
        tool = tool_map.get(tool_name)
        if tool is None:
            logger.error(
                "[replay_executor] EXECUTE_REPLAY_TOOL_CALLS_UNKNOWN_TOOL",
                replay_id=replay_id,
                replay_task_id=replay_task_id,
                call_index=call_index,
                tool_name=tool_name,
            )
            raise ValueError(f"Validated replay references unknown tool '{tool_name}'")

        if adaptive:
            tool_args = await _adapt_replay_tool_args(
                settings=settings,
                model_name=model_name or "gpt-4.1",
                recorded_call=recorded_call,
                adaptation_context=adaptation_context or {},
                previous_outputs=synthesis_entries,
                prompt_trace=prompt_trace,
            )

        logger.info(
            "[replay_executor] EXECUTE_REPLAY_TOOL_CALL",
            replay_id=replay_id,
            replay_task_id=replay_task_id,
            call_index=call_index,
            tool_name=tool_name,
            tool_args_preview=_summarize_tool_args(tool_args),
        )
        result = await tool.ainvoke(tool_args)
        tool_trace.append({
            "call_index": call_index,
            "tool_name": tool_name,
            "args": tool_args,
            "output_summary": _summarize_tool_result(result),
        })
        logger.info(
            "[replay_executor] EXECUTE_REPLAY_TOOL_CALL_DONE",
            replay_id=replay_id,
            replay_task_id=replay_task_id,
            call_index=call_index,
            tool_name=tool_name,
            output_summary=_summarize_tool_result(result, max_length=300),
        )
        synthesis_entries.append(
            f"Tool call {tool_trace[-1]['call_index']}: {tool_name}\n"
            f"Args: {tool_args}\n"
            f"Output:\n{_summarize_tool_result(result, max_length=6000)}"
        )

        if collector:
            all_components.extend(collector.get_and_clear())

    return (
        validated_replay.get("reference_output", "") or "",
        all_components,
        tool_trace,
        "\n\n".join(synthesis_entries),
    )


def _extract_json_object(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return {}
    if text.startswith("```"):
        lines = [line for line in text.splitlines() if not line.strip().startswith("```")]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("Adaptive replay did not return a JSON object")
    return json.loads(text[start:end + 1])


async def _adapt_replay_tool_args(
    settings,
    model_name: str,
    recorded_call: Dict[str, Any],
    adaptation_context: Dict[str, Any],
    previous_outputs: List[str],
    prompt_trace: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    if settings is None:
        raise ValueError("Adaptive replay requires settings")

    original_args = recorded_call.get("args") or {}
    tool_name = recorded_call.get("tool_name", "")
    system_prompt = (
        "You rewrite tool arguments for adaptive replay.\n"
        "Keep the same tool intent and the same JSON shape.\n"
        "Only change values that are necessary to align with the current task context.\n"
        "Return JSON only."
    )
    user_prompt = (
        f"Tool name: {tool_name}\n"
        f"Original args JSON:\n{json.dumps(original_args, ensure_ascii=True, indent=2)}\n\n"
        f"Reference task title: {adaptation_context.get('reference_task_title', '')}\n"
        f"Reference task description: {adaptation_context.get('reference_task_description', '')}\n\n"
        f"Current task title: {adaptation_context.get('task_title', '')}\n"
        f"Current task description: {adaptation_context.get('task_description', '')}\n"
        f"Current user query: {adaptation_context.get('current_query', '')}\n"
        f"Dependency context: {adaptation_context.get('dependency_context', '')}\n\n"
        f"Previous replay tool outputs:\n{chr(10).join(previous_outputs[-2:]) if previous_outputs else 'None'}\n\n"
        "Return the adapted args as JSON with the same top-level keys as the original args."
    )
    response_text, _usage = await _llm_call(
        settings,
        model_name,
        system_prompt,
        user_prompt,
        temperature=0.2,
        prompt_trace=prompt_trace,
        stage=f"adaptive_rewrite_{tool_name or 'tool'}",
    )
    adapted_args = _extract_json_object(response_text)
    if not isinstance(adapted_args, dict):
        raise ValueError("Adaptive replay returned invalid args payload")
    logger.info(
        "[replay_executor] ADAPT_REPLAY_TOOL_ARGS",
        tool_name=tool_name,
        original_args_preview=_summarize_tool_args(original_args),
        adapted_args_preview=_summarize_tool_args(adapted_args),
    )
    return adapted_args


async def resume_step(
    thread_id: str,
    human_response: dict,
    task_id: str = "",
) -> Dict[str, Any]:
    """Resume an interrupted step with the human response.

    Args:
        thread_id: Thread ID from the interrupted step execution
        human_response: Dict with approved, reason, feedback
        task_id: Optional task ID being resumed

    Returns:
        Dict with keys: status, result, interrupt, thread_id
    """
    from langgraph.types import Command
    from src.langgraph_engine.graph_cache import get_thread_graph, cleanup_thread_graph

    graph = get_thread_graph(thread_id)
    if graph is None:
        logger.warning("[resume_step] Graph not found for thread", thread_id=thread_id)
        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": f"No active graph found for thread {thread_id}. The execution may have expired.",
                "duration_ms": 0,
            },
            "interrupt": None,
            "thread_id": thread_id,
        }

    config = {"configurable": {"thread_id": thread_id}}

    response_data = human_response

    logger.info("[resume_step] Resuming", thread_id=thread_id, task_id=task_id)

    try:
        final_state = await graph.ainvoke(Command(resume=response_data), config)

        # Check if the graph is suspended again (e.g. interrupt_after following interrupt_before)
        state_snapshot = await graph.aget_state(config)
        if state_snapshot.next:
            interrupt_data = _extract_interrupt_from_snapshot(state_snapshot, task_id, thread_id)
            logger.info("[resume_step] Graph suspended again (HITL)", interrupt_type=interrupt_data.get("type") if interrupt_data else None)
            return {
                "status": "suspended",
                "result": {
                    "task_id": task_id,
                    "status": "suspended",
                    "output": "",
                    "error": "",
                    "duration_ms": 0,
                },
                "interrupt": interrupt_data,
                "thread_id": thread_id,
            }

        final_status = final_state.get("status", "completed")
        logger.info("[resume_step] Resumed execution completed", status=final_status)

        if final_status in ("completed", "failed", "skipped"):
            cleanup_thread_graph(thread_id)

        return {
            "status": final_status,
            "result": {
                "task_id": task_id,
                "status": final_status,
                "output": final_state.get("output", ""),
                "error": final_state.get("error", ""),
                "duration_ms": 0,
                "components": final_state.get("components", []),
                "usage": final_state.get("usage", {}),
                "tool_trace": final_state.get("tool_trace", []),
                "semantic_match": final_state.get("semantic_match"),
            },
            "interrupt": None,
            "thread_id": thread_id,
        }

    except Exception as e:
        error_str = str(e)
        logger.error("[resume_step] Failed", error=error_str)
        cleanup_thread_graph(thread_id)
        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": error_str,
                "duration_ms": 0,
            },
            "interrupt": None,
            "thread_id": thread_id,
        }


async def _llm_call(
    settings,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.7,
    prompt_trace: Optional[List[Dict[str, Any]]] = None,
    stage: str = "llm_call",
) -> tuple:
    """Direct LLM call without tools.

    Returns:
        Tuple of (content_str, usage_dict).
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    llm = ChatOpenAI(
        base_url=settings.LITELLM_API_BASE_URL,
        api_key=settings.LITELLM_API_SECRET_KEY,
        model=model_name,
        temperature=temperature,
    )
    _append_prompt_trace(
        prompt_trace,
        stage=stage,
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    result = await llm.ainvoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ])
    return result.content, _extract_usage(result)
