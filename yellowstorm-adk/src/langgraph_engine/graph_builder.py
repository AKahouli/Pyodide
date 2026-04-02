"""Dynamic LangGraph execution graph builder.

Creates unique graphs per playbook where each task becomes its own node.
Supports parallel execution, HITL via interrupt(), and dependency-based routing.

Step updates are emitted via a callback (``on_step_update``) instead of a
side-channel asyncio queue so that the graph stays serialisable and the
single streaming path (LangGraph ``astream``) is the only mechanism in use.
"""

from typing import Any, Callable, Dict, List, Optional

from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.base import BaseCheckpointSaver
from structlog import get_logger

from src.langgraph_engine.state import (
    ExecutionState,
    StepCallback,
    StepUpdate,
    TaskConfig,
    EdgeConfig,
    NoopStepCallback,
)
from src.langgraph_engine.checkpointer import get_checkpointer_sync
from src.langgraph_engine.step_executor import (
    is_skip_step_response,
    normalize_interrupt_action,
    extract_interrupt_message,
    extract_follow_up_question,
)
from datetime import datetime
import json

logger = get_logger(__name__)


class DynamicGraphBuilder:
    """Builds dynamic execution graphs from playbook task definitions."""

    def __init__(self, checkpointer: Optional[BaseCheckpointSaver] = None):
        self.checkpointer = checkpointer or get_checkpointer_sync()

    def _build_structured_context(
        self,
        task_id: str,
        task_config: TaskConfig,
        state: ExecutionState,
    ) -> tuple[str, list]:
        """Build context string from dependency results using structured routing.

        Uses typed port resolution (new path) when input_ports and
        artifacts_by_port are available.  Falls back to legacy input_keys /
        edge-walking for playbooks without ports.

        Returns:
            Tuple of (prompt_text, workspace_artifacts) where workspace_artifacts
            is a list of heavy artifacts (document, image, etc.) that should be
            injected into workspace_context for agent tool access.
        """
        prompt_parts: List[str] = []
        workspace_artifacts: list = []
        seen_source_ids: set[str] = set()

        # 1. Typed port resolution (new path)
        input_ports = {p["id"]: p for p in task_config.get("input_ports") or []}
        artifacts_by_port = state.get("artifacts_by_port") or {}

        if input_ports and artifacts_by_port:
            for edge in state.get("edges") or []:
                if edge.get("target_id") != task_id:
                    continue

                source_port_id = edge.get("source_output_port_id", "default")
                target_port_id = edge.get("target_input_port_id", "default")
                artifact_key = f"{edge['source_id']}:{source_port_id}"

                artifact = artifacts_by_port.get(artifact_key)
                if not artifact:
                    continue

                target_port = input_ports.get(target_port_id, {})
                label = target_port.get("name", target_port_id)
                seen_source_ids.add(edge["source_id"])

                artifact_kind = artifact.get("artifact_kind", "text")
                if artifact_kind in ("text", "code"):
                    prompt_parts.append(f"Input '{label}':\n{artifact.get('content', '')}")
                else:
                    workspace_artifacts.append(artifact)

        # 2. Legacy fallback — input_keys
        input_keys = task_config.get("input_keys") or []
        if input_keys and state.get("task_outputs"):
            for key in input_keys:
                value = state["task_outputs"].get(key)
                if value is not None:
                    prompt_parts.append(f"Input '{key}':\n{value}")

        # 3. Legacy fallback — walk edges for raw output
        if not prompt_parts and not seen_source_ids:
            for edge in state.get("edges") or []:
                if edge["target_id"] != task_id:
                    continue
                source_id = edge["source_id"]
                if source_id in seen_source_ids:
                    continue
                if source_id not in state["results"]:
                    continue

                source_task = next(
                    (t for t in state["tasks"] if t.get("id") == source_id),
                    None,
                )
                if not source_task:
                    continue

                output = state["results"][source_id].get("output", "")
                if output:
                    prompt_parts.append(f"\n\nPrevious task '{source_task['title']}' result:\n{output}")

        return "\n\n".join(prompt_parts), workspace_artifacts

    def _create_task_node(
        self,
        task_id: str,
        task: TaskConfig,
        on_step_update: StepCallback = NoopStepCallback,
    ) -> Callable:
        """Create a node function for a specific task."""

        async def task_node(state: ExecutionState, config: RunnableConfig) -> Dict[str, Any]:
            from langchain_openai import ChatOpenAI
            from langgraph.types import interrupt
            from src.config.settings import get_settings
            import time

            settings = get_settings()
            task_config = task
            playbook_id = state.get("playbook_id", "")
            thread_id = state.get("thread_id")
            agent_id = task_config.get("assigned_agent_id")

            if not agent_id or agent_id not in state["agents"]:
                error_msg = f"No agent assigned to task {task_id}"
                logger.error(f"[{task_id}] {error_msg}")
                return {
                    "completed_task_ids": [task_id],
                    "results": {task_id: {"error": error_msg}},
                    "error": error_msg,
                    "status": "failed",
                }

            agent = state["agents"][agent_id]

            start_time = time.time()
            started_at = datetime.utcnow().isoformat() + "Z"

            logger.info(f"[{task_id}] Starting task", title=task_config.get("title"))

            async def _push_step_update(status, result=None, interrupt_data=None):
                update: StepUpdate = {
                    "task_id": task_id,
                    "task_title": task_config.get("title", ""),
                    "status": status,
                }
                if result is not None:
                    update["result"] = result
                if interrupt_data is not None:
                    update["interrupt"] = interrupt_data
                try:
                    await on_step_update(update)
                except Exception:
                    logger.warning(f"[{task_id}] step_update callback failed", exc_info=True)

            try:
                await _push_step_update("in_progress")
                task_for_execution = task_config
                clarification_transcript: List[Dict[str, str]] = []
                review_transcript: List[Dict[str, str]] = []

                def _build_interrupt_payload(
                    interrupt_type: str,
                    message: str,
                    *,
                    task_description: str = "",
                    result_text: str = "",
                    round_number: int = 1,
                    transcript: Optional[List[Dict[str, str]]] = None,
                    resumable_actions: Optional[List[str]] = None,
                ) -> Dict[str, Any]:
                    transcript_data = transcript or []
                    return {
                        "type": interrupt_type,
                        "task_id": task_id,
                        "task_title": task_config.get("title", ""),
                        "task_description": task_description,
                        "result": result_text,
                        "message": message,
                        "thread_id": thread_id,
                        "interrupt_id": f"{thread_id}:{task_id}:{interrupt_type}:{round_number}",
                        "round": round_number,
                        "conversation_json": json.dumps(transcript_data),
                        "resumable_actions": resumable_actions or ["reply"],
                    }

                # === STEP 1: Clarification check ===
                if task_config.get("allow_clarification", False):
                    model_name = agent.get("model") or "gpt-4.1"
                    llm = ChatOpenAI(
                        base_url=settings.LITELLM_API_BASE_URL,
                        api_key=settings.LITELLM_API_SECRET_KEY,
                        model=model_name,
                        temperature=0.0,
                    )

                    from langchain_core.messages import HumanMessage
                    clarification_limit = max(int(task_config.get("max_clarifications") or 0), 0)
                    clarification_resolved = False
                    for round_number in range(1, clarification_limit + 1):
                        prior_turns = "\n".join(
                            f"{turn.get('role', 'user')}: {turn.get('content', '')}"
                            for turn in clarification_transcript
                        )
                        clarification_prompt = task_config.get("clarification_prompt") or (
                            "Review the task below and determine if you have enough information to complete it.\n"
                            f"Task: {task_config['title']}\n"
                            f"Description: {task_for_execution['description']}\n"
                            "If you need clarification, respond with one clear question only. "
                            "If everything is clear, respond with exactly 'CLEAR'."
                        )
                        if prior_turns:
                            clarification_prompt += f"\n\nPrior clarification turns:\n{prior_turns}"

                        check_result = await llm.ainvoke([HumanMessage(content=clarification_prompt)])
                        check_text = check_result.content.strip()

                        if check_text.upper() == "CLEAR":
                            clarification_resolved = True
                            break

                        clarification_transcript.append({"role": "assistant", "content": check_text})
                        clarification_payload = _build_interrupt_payload(
                            "clarification",
                            check_text,
                            round_number=round_number,
                            transcript=clarification_transcript,
                            resumable_actions=["reply", "skip"],
                        )
                        await _push_step_update("suspended", interrupt_data=clarification_payload)
                        response = interrupt(clarification_payload)
                        action = normalize_interrupt_action(response, "clarification")

                        if action == "skip":
                            completed_at = datetime.utcnow().isoformat() + "Z"
                            duration_ms = int((time.time() - start_time) * 1000)
                            skipped_result = {
                                "task_id": task_id,
                                "status": "skipped",
                                "output": "",
                                "error": "",
                                "duration_ms": duration_ms,
                                "components": [],
                                "usage": {},
                                "tool_trace": [],
                                "llm_prompt_trace": [],
                                "semantic_match": None,
                            }
                            await _push_step_update("skipped", result=skipped_result)
                            return {
                                "completed_task_ids": [task_id],
                                "results": {task_id: {"status": "skipped", "output": ""}},
                                "node_timings": {
                                    task_id: {
                                        "started_at": started_at,
                                        "completed_at": completed_at,
                                        "duration_ms": duration_ms,
                                    }
                                },
                            }

                        user_reply = extract_interrupt_message(response)
                        if not user_reply:
                            return {
                                "completed_task_ids": [task_id],
                                "results": {task_id: {"error": "Clarification response was empty"}},
                                "error": "Clarification response was empty",
                                "status": "failed",
                            }

                        clarification_transcript.append({"role": "user", "content": user_reply})
                        task_for_execution = {
                            **task_for_execution,
                            "description": f"{task_for_execution['description']}\n\nClarification from user: {user_reply}",
                        }

                    if clarification_limit == 0:
                        clarification_resolved = True
                    if not clarification_resolved:
                        return {
                            "completed_task_ids": [task_id],
                            "results": {task_id: {"error": "Clarification limit exceeded"}},
                            "error": "Clarification limit exceeded",
                            "status": "failed",
                        }

                # === STEP 2: interrupt_before (approval) ===
                if task_config.get("interrupt_before", False):
                    logger.info(f"[{task_id}] Requires approval before execution")

                    approval_payload = _build_interrupt_payload(
                        "approval_request",
                        f"Task '{task_config.get('title', '')}' requires approval before execution.",
                        task_description=task_for_execution.get("description", ""),
                        round_number=1,
                        transcript=[],
                        resumable_actions=["approve", "reject", "skip"],
                    )
                    await _push_step_update("suspended", interrupt_data=approval_payload)
                    approval_response = interrupt(approval_payload)

                    logger.info(f"[{task_id}] Approval response received", response=approval_response)

                    if is_skip_step_response(approval_response):
                        completed_at = datetime.utcnow().isoformat() + "Z"
                        duration_ms = int((time.time() - start_time) * 1000)
                        skipped_result = {
                            "task_id": task_id,
                            "status": "skipped",
                            "output": "",
                            "error": "",
                            "duration_ms": duration_ms,
                            "components": [],
                            "usage": {},
                            "tool_trace": [],
                            "llm_prompt_trace": [],
                            "semantic_match": None,
                        }
                        await _push_step_update("skipped", result=skipped_result)
                        return {
                            "completed_task_ids": [task_id],
                            "results": {task_id: {"status": "skipped", "output": ""}},
                            "node_timings": {
                                task_id: {
                                    "started_at": started_at,
                                    "completed_at": completed_at,
                                    "duration_ms": duration_ms,
                                }
                            },
                        }

                    approval_action = normalize_interrupt_action(approval_response, "approval_request")

                    if approval_action == "reject":
                        error_msg = extract_interrupt_message(approval_response) or "Task rejected by human"
                        return {
                            "completed_task_ids": [task_id],
                            "results": {task_id: {"error": error_msg}},
                            "error": error_msg,
                            "status": "failed",
                        }

                    feedback_message = extract_interrupt_message(approval_response)
                    if feedback_message and approval_action == "approve":
                        task_for_execution = {
                            **task_for_execution,
                            "description": f"{task_for_execution['description']}\n\nHuman Feedback: {feedback_message}",
                        }

                # === STEP 3: Build context from dependency results ===
                context, workspace_artifacts = self._build_structured_context(task_id, task_config, state)

                def _build_user_prompt(current_task_for_execution: Dict[str, Any]) -> str:
                    prompt = (
                        f"Task: {current_task_for_execution['title']}\n\n"
                        f"Description:\n{current_task_for_execution['description']}"
                    )

                    if context:
                        prompt += f"\n\nContext from previous tasks:{context}"

                    if state.get("query"):
                        prompt += f"\n\nUser query: {state['query']}"

                    if workspace_filenames:
                        visible_files = workspace_filenames[:12]
                        suffix = ""
                        if len(workspace_filenames) > 12:
                            suffix = f" (+{len(workspace_filenames) - 12} more)"
                        prompt += (
                            "\n\nWorkspace files already available in the sandbox:\n"
                            f"{', '.join(visible_files)}{suffix}\n"
                            "Do not ask the user to upload these files again."
                        )

                    prompt += "\n\nPlease complete this task and provide a clear output."
                    return prompt

                agent_instructions = agent.get("instructions") or agent.get("prompt", "")
                system_prompt = (
                    f"You are {agent['name']}.\n\n"
                    f"Your instructions:\n{agent_instructions}\n\n"
                    f"You are working on a task as part of a larger playbook execution."
                )

                workspace_filenames = []
                seen_workspace_files = set()

                effective_workspace_context = list(state.get("workspace_context") or [])
                if workspace_artifacts:
                    artifact_workspace = {
                        "workspace_id": "playbook_artifacts",
                        "documents": [
                            {
                                "_id": a.get("url", ""),
                                "filename": a.get("filename", "artifact"),
                                "filepath": a.get("url", ""),
                                "in_memory": False,
                                "language": "fr",
                                "indexing_token": 1200,
                                "workspace_id": "playbook_artifacts",
                            }
                            for a in workspace_artifacts
                        ],
                    }
                    effective_workspace_context.append(artifact_workspace)
                    logger.info(
                        f"[{task_id}] Injected workspace artifacts",
                        artifact_count=len(workspace_artifacts),
                    )

                for workspace in effective_workspace_context:
                    for doc in workspace.get("documents", []):
                        filename = str(doc.get("filename", "")).strip()
                        if filename and filename not in seen_workspace_files:
                            workspace_filenames.append(filename)
                            seen_workspace_files.add(filename)

                user_prompt = _build_user_prompt(task_for_execution)

                async def _execute_task_once(
                    current_task_for_execution: Dict[str, Any],
                    current_user_prompt: str,
                ) -> tuple[Dict[str, Any], str]:
                    model_name = agent.get("model") or "gpt-4.1"
                    agent_params = agent.get("agent_params") or {}
                    temperature = float(agent_params.get("temperature", 0.7))

                    from src.langgraph_engine.playbook_tool_factory import create_langchain_tools
                    from src.langgraph_engine.step_executor import _execute_with_tools, _execute_replay_tool_calls

                    input_files = task_config.get("input_files")

                    logger.info(
                        f"[{task_id}] INPUT_FILES_DEBUG",
                        has_input_files=input_files is not None,
                        input_files_count=len(input_files) if input_files else 0,
                    )

                    lc_tools, collector = create_langchain_tools(
                        agent,
                        workspace_context=state.get("workspace_context"),
                        input_files=input_files,
                    )
                    components: List[Dict[str, Any]] = []
                    tool_trace: List[Dict[str, Any]] = []
                    llm_prompt_trace: List[Dict[str, Any]] = []
                    step_execution_modes = state.get("step_execution_modes") or {}
                    execution_mode = step_execution_modes.get(task_id) or state.get("execution_mode", "live")
                    validated_replay = (state.get("validated_replays_by_task") or {}).get(task_id)
                    logger.info(
                        f"[{task_id}] EXECUTION_MODE_DECISION",
                        execution_mode=execution_mode,
                        has_validated_replay=bool(validated_replay),
                        replay_id=(validated_replay or {}).get("replay_id"),
                        replay_tool_calls=len((validated_replay or {}).get("tool_calls", []) or []),
                        available_tools=[tool.name for tool in lc_tools],
                    )

                    if execution_mode in ("replay_strict", "replay_flex", "replay_adaptive") and validated_replay:
                        if not lc_tools:
                            raise ValueError(f"Validated replay for task {task_id} cannot run because no tools are configured")
                        logger.info(
                            f"[{task_id}] Executing replay mode",
                            mode=execution_mode,
                            replay_id=validated_replay.get("replay_id"),
                            tool_calls=len(validated_replay.get("tool_calls", []) or []),
                        )
                        strict_response, components, tool_trace, synthesis_context = await _execute_replay_tool_calls(
                            lc_tools,
                            collector,
                            validated_replay,
                            prompt_trace=llm_prompt_trace,
                            adaptive=execution_mode == "replay_adaptive",
                            adaptation_context={
                                "task_id": task_id,
                                "task_title": current_task_for_execution.get("title", ""),
                                "task_description": current_task_for_execution.get("description", ""),
                                "current_query": state.get("query", ""),
                                "dependency_context": context,
                                "reference_task_title": validated_replay.get("task_title", ""),
                                "reference_task_description": validated_replay.get("reference_task_description", ""),
                            },
                            settings=settings,
                            model_name=model_name,
                        )
                        if execution_mode in ("replay_flex", "replay_adaptive"):
                            format_guide = (validated_replay.get("output_format_guide") or "").strip()
                            format_instruction = ""
                            if validated_replay.get("preserve_output_format") and format_guide:
                                format_instruction = (
                                    f"""\n\n#Output Furmat guidelines
                                    Preserve the validated output format.\n
                                    {format_guide}\n\n
                                    Keep the structure and presentation style, but refresh the content from the current replay evidence only."""
                                )
                            replay_user_prompt = (
                                f"{current_user_prompt}\n\n"
                                "Use the following replayed tool execution results to produce the final answer.\n\n"
                                f"{synthesis_context}"
                                f"{format_instruction}"
                            )
                            response, usage = await self._llm_direct_call(
                                settings,
                                model_name,
                                system_prompt,
                                replay_user_prompt,
                                temperature=temperature,
                                prompt_trace=llm_prompt_trace,
                                stage="replay_final_synthesis",
                            )
                        else:
                            response = strict_response
                            usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "model": ""}
                    elif lc_tools:
                        logger.info(f"[{task_id}] Executing with real tools", count=len(lc_tools), tools=[t.name for t in lc_tools])
                        response, components, usage, tool_trace, llm_prompt_trace = await _execute_with_tools(
                            settings,
                            model_name,
                            system_prompt,
                            current_user_prompt,
                            lc_tools,
                            collector,
                            temperature=temperature,
                        )
                    else:
                        response, usage = await self._llm_direct_call(
                            settings,
                            model_name,
                            system_prompt,
                            current_user_prompt,
                            temperature=temperature,
                            prompt_trace=llm_prompt_trace,
                            stage="task_direct_completion",
                        )
                        components = []
                        tool_trace = []

                    is_visualizer = (
                        agent.get("agent_type") == "visualizer"
                        or agent["name"] == "Visualizer Agent"
                        or "visualizer_agent" in agent["name"].lower()
                    )
                    if is_visualizer and response:
                        components.insert(0, {
                            "type": "web_preview",
                            "data": {"content": response},
                        })

                    return ({
                        "output": "" if is_visualizer else response,
                        "task_id": task_id,
                        "task_title": task_config["title"],
                        "agent_name": agent["name"],
                        "components": components,
                        "usage": usage,
                        "tool_trace": tool_trace,
                        "llm_prompt_trace": llm_prompt_trace,
                    }, response)

                review_round = 0
                while True:
                    task_result, response = await _execute_task_once(task_for_execution, user_prompt)

                    if task_config.get("allow_clarification", False):
                        clarification_limit = max(int(task_config.get("max_clarifications") or 0), 0)
                        clarification_round = sum(
                            1 for turn in clarification_transcript if turn.get("role") == "assistant"
                        ) + 1
                        follow_up_question = extract_follow_up_question(task_result.get("output", ""))

                        if (
                            follow_up_question
                            and clarification_limit > 0
                            and clarification_round <= clarification_limit
                        ):
                            clarification_transcript.append({
                                "role": "assistant",
                                "content": task_result.get("output", ""),
                            })
                            clarification_payload = _build_interrupt_payload(
                                "clarification",
                                follow_up_question,
                                result_text=task_result.get("output", ""),
                                round_number=clarification_round,
                                transcript=clarification_transcript,
                                resumable_actions=["reply", "skip"],
                            )
                            await _push_step_update("suspended", interrupt_data=clarification_payload)
                            response = interrupt(clarification_payload)
                            action = normalize_interrupt_action(response, "clarification")

                            if action == "skip":
                                completed_at = datetime.utcnow().isoformat() + "Z"
                                duration_ms = int((time.time() - start_time) * 1000)
                                skipped_result = {
                                    "task_id": task_id,
                                    "status": "skipped",
                                    "output": "",
                                    "error": "",
                                    "duration_ms": duration_ms,
                                    "components": task_result.get("components", []),
                                    "usage": task_result.get("usage", {}),
                                    "tool_trace": task_result.get("tool_trace", []),
                                    "llm_prompt_trace": task_result.get("llm_prompt_trace", []),
                                    "semantic_match": task_result.get("semantic_match"),
                                }
                                await _push_step_update("skipped", result=skipped_result)
                                return {
                                    "completed_task_ids": [task_id],
                                    "results": {task_id: skipped_result},
                                    "node_timings": {
                                        task_id: {
                                            "started_at": started_at,
                                            "completed_at": completed_at,
                                            "duration_ms": duration_ms,
                                        }
                                    },
                                }

                            user_reply = extract_interrupt_message(response)
                            if not user_reply:
                                return {
                                    "completed_task_ids": [task_id],
                                    "results": {task_id: {"error": "Clarification response was empty"}},
                                    "error": "Clarification response was empty",
                                    "status": "failed",
                                }

                            clarification_transcript.append({"role": "user", "content": user_reply})
                            task_for_execution = {
                                **task_for_execution,
                                "description": (
                                    f"{task_for_execution['description']}\n\n"
                                    "Continue the discussion with the user.\n\n"
                                    f"Previous assistant reply:\n{task_result.get('output', '')}\n\n"
                                    f"User reply:\n{user_reply}"
                                ),
                            }
                            user_prompt = _build_user_prompt(task_for_execution)
                            continue

                    if not task_config.get("interrupt_after", False):
                        break
                    logger.info(f"[{task_id}] Requires review after execution")
                    review_round += 1

                    review_payload = _build_interrupt_payload(
                        "review_request",
                        (
                            f"Task '{task_config.get('title', '')}' completed. Please review the result."
                            if review_round == 1
                            else f"Review the revised result for task '{task_config.get('title', '')}'."
                        ),
                        result_text=response,
                        round_number=review_round,
                        transcript=review_transcript,
                        resumable_actions=["reply", "approve", "reject", "skip"],
                    )
                    await _push_step_update("suspended", interrupt_data=review_payload)
                    review_response = interrupt(review_payload)
                    review_action = normalize_interrupt_action(review_response, "review_request")

                    if is_skip_step_response(review_response):
                        completed_at = datetime.utcnow().isoformat() + "Z"
                        duration_ms = int((time.time() - start_time) * 1000)
                        skipped_result = {
                            "task_id": task_id,
                            "status": "skipped",
                            "output": "",
                            "error": "",
                            "duration_ms": duration_ms,
                            "components": task_result.get("components", []),
                            "usage": task_result.get("usage", {}),
                            "tool_trace": task_result.get("tool_trace", []),
                            "llm_prompt_trace": task_result.get("llm_prompt_trace", []),
                            "semantic_match": None,
                        }
                        await _push_step_update("skipped", result=skipped_result)
                        return {
                            "completed_task_ids": [task_id],
                            "results": {task_id: skipped_result},
                            "node_timings": {
                                task_id: {
                                    "started_at": started_at,
                                    "completed_at": completed_at,
                                    "duration_ms": duration_ms,
                                }
                            },
                        }

                    if review_action == "reject":
                        error_msg = extract_interrupt_message(review_response) or "Task result rejected by human"
                        failed_result = {
                            "task_id": task_id,
                            "status": "failed",
                            "output": task_result.get("output", ""),
                            "error": error_msg,
                            "duration_ms": int((time.time() - start_time) * 1000),
                            "components": task_result.get("components", []),
                            "usage": task_result.get("usage", {}),
                            "tool_trace": task_result.get("tool_trace", []),
                            "llm_prompt_trace": task_result.get("llm_prompt_trace", []),
                            "semantic_match": task_result.get("semantic_match"),
                        }
                        await _push_step_update("failed", result=failed_result)
                        return {
                            "completed_task_ids": [task_id],
                            "results": {task_id: failed_result},
                            "error": error_msg,
                            "status": "failed",
                        }

                    if review_action == "approve":
                        break

                    feedback_message = extract_interrupt_message(review_response)
                    if not feedback_message:
                        break

                    review_transcript.append({"role": "assistant", "content": response})
                    review_transcript.append({"role": "user", "content": feedback_message})
                    task_for_execution = {
                        **task_for_execution,
                        "description": f"{task_for_execution['description']}\n\nHuman Review Feedback: {feedback_message}",
                    }
                    user_prompt = _build_user_prompt(task_for_execution)

                completed_at = datetime.utcnow().isoformat() + "Z"
                duration_ms = int((time.time() - start_time) * 1000)

                new_node_timings = {
                    task_id: {
                        "started_at": started_at,
                        "completed_at": completed_at,
                        "duration_ms": duration_ms,
                    }
                }

                logger.info(f"[{task_id}] Completed", duration_ms=duration_ms)

                await _push_step_update("completed", result={
                    "task_id": task_id,
                    "status": "completed",
                    "output": task_result.get("output", ""),
                    "error": "",
                    "duration_ms": duration_ms,
                    "components": task_result.get("components", []),
                    "usage": task_result.get("usage", {}),
                    "tool_trace": task_result.get("tool_trace", []),
                    "llm_prompt_trace": task_result.get("llm_prompt_trace", []),
                    "semantic_match": task_result.get("semantic_match"),
                })

                output_text = task_result.get("output", "")
                output_key = task_config.get("output_key")

                state_update: Dict[str, Any] = {
                    "completed_task_ids": [task_id],
                    "results": {task_id: task_result},
                    "node_timings": new_node_timings,
                }
                if output_key and output_text:
                    state_update["task_outputs"] = {output_key: output_text}

                raw_artifacts = task_result.get("artifacts") or []
                if raw_artifacts:
                    port_artifacts: Dict[str, Dict[str, Any]] = {}
                    for art in raw_artifacts:
                        port_id = art.get("port_id", "default")
                        art_key = f"{task_id}:{port_id}"
                        port_artifacts[art_key] = art
                    state_update["artifacts_by_port"] = port_artifacts

                return state_update

            except Exception as e:
                if "GraphInterrupt" in type(e).__name__:
                    raise

                completed_at = datetime.utcnow().isoformat() + "Z"
                duration_ms = int((time.time() - start_time) * 1000)
                error_msg = str(e)

                logger.error(f"[{task_id}] Failed", error=error_msg, duration_ms=duration_ms)

                await _push_step_update("failed", result={
                    "task_id": task_id,
                    "status": "failed",
                    "output": "",
                    "error": error_msg,
                    "duration_ms": duration_ms,
                    "components": components,
                    "tool_trace": tool_trace,
                    "llm_prompt_trace": llm_prompt_trace,
                })

                return {
                    "completed_task_ids": [task_id],
                    "results": {
                        task_id: {
                            "task_id": task_id,
                            "status": "failed",
                            "output": "",
                            "error": error_msg,
                            "duration_ms": duration_ms,
                            "components": components,
                            "tool_trace": tool_trace,
                            "llm_prompt_trace": llm_prompt_trace,
                            "semantic_match": None,
                        }
                    },
                    "error": error_msg,
                    "status": "failed",
                    "node_timings": {
                        task_id: {
                            "started_at": started_at,
                            "completed_at": completed_at,
                            "duration_ms": duration_ms,
                        }
                    },
                }

        task_node.__name__ = f"task_{task_id}"
        return task_node

    @staticmethod
    async def _llm_direct_call(
        settings,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        prompt_trace: Optional[List[Dict[str, Any]]] = None,
        stage: str = "llm_call",
    ) -> tuple:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        from src.langgraph_engine.step_executor import _extract_usage, _append_prompt_trace

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

    def _find_entry_tasks(self, tasks: List[TaskConfig], edges: List[EdgeConfig]) -> List[str]:
        all_task_ids = {t["id"] for t in tasks if t.get("id")}
        target_ids = {e["target_id"] for e in edges}
        entry_ids = list(all_task_ids - target_ids)

        if not entry_ids and all_task_ids:
            entry_ids = [
                min(
                    all_task_ids,
                    key=lambda tid: next(
                        (t.get("execution_order", 999) for t in tasks if t.get("id") == tid),
                        999,
                    ),
                )
            ]

        return entry_ids

    def _find_exit_tasks(self, tasks: List[TaskConfig], edges: List[EdgeConfig]) -> List[str]:
        all_task_ids = {t["id"] for t in tasks if t.get("id")}
        source_ids = {e["source_id"] for e in edges}
        exit_ids = list(all_task_ids - source_ids)

        if not exit_ids and all_task_ids:
            exit_ids = list(all_task_ids)

        return exit_ids

    def build_execution_graph(
        self,
        tasks: List[TaskConfig],
        edges: List[EdgeConfig],
        playbook_id: str,
        on_step_update: StepCallback = NoopStepCallback,
    ) -> Dict[str, Any]:
        """Build a dynamic execution graph with one node per task.

        Returns:
            Dict with keys ``compiled``, ``playbook_id``, ``task_count``,
            ``edge_count`` — the compiled graph and its metadata kept in a
            plain dict instead of monkey-patching the compiled graph object.
        """
        workflow = StateGraph(ExecutionState)

        for task in tasks:
            task_id = task.get("id")
            if not task_id:
                continue

            node_func = self._create_task_node(task_id, task, on_step_update)
            node_name = f"task_{task_id}"
            workflow.add_node(node_name, node_func)
            logger.info("[DynamicGraphBuilder] Added node", node=node_name, title=task.get("title"))

        entry_task_ids = self._find_entry_tasks(tasks, edges)
        logger.info("[DynamicGraphBuilder] Entry tasks", entry_ids=entry_task_ids)

        if len(entry_task_ids) == 1:
            workflow.set_entry_point(f"task_{entry_task_ids[0]}")
        else:
            async def start_node(state: ExecutionState) -> Dict[str, Any]:
                return {}

            workflow.add_node("__start_parallel__", start_node)
            workflow.set_entry_point("__start_parallel__")

            for tid in entry_task_ids:
                workflow.add_edge("__start_parallel__", f"task_{tid}")

        incoming_by_target: Dict[str, List[str]] = {}
        for edge in edges:
            source_id = edge["source_id"]
            target_id = edge["target_id"]
            if not source_id or not target_id:
                continue
            incoming_by_target.setdefault(target_id, []).append(source_id)

        for target_id, source_ids in incoming_by_target.items():
            target_node = f"task_{target_id}"
            source_nodes = [f"task_{source_id}" for source_id in source_ids]

            if len(source_nodes) == 1:
                workflow.add_edge(source_nodes[0], target_node)
                logger.info("[DynamicGraphBuilder] Added edge", source=source_nodes[0], target=target_node)
                continue

            workflow.add_edge(source_nodes, target_node)
            logger.info("[DynamicGraphBuilder] Added barrier edge", sources=source_nodes, target=target_node)

        exit_task_ids = self._find_exit_tasks(tasks, edges)
        logger.info("[DynamicGraphBuilder] Exit tasks", exit_ids=exit_task_ids)

        async def completion_node(state: ExecutionState) -> Dict[str, Any]:
            logger.info("[completion_node] All tasks completed")
            return {"status": "completed"}

        workflow.add_node("__completion__", completion_node)

        exit_nodes = [f"task_{tid}" for tid in exit_task_ids]
        if len(exit_nodes) == 1:
            workflow.add_edge(exit_nodes[0], "__completion__")
        elif exit_nodes:
            workflow.add_edge(exit_nodes, "__completion__")

        workflow.add_edge("__completion__", END)

        compiled = workflow.compile(checkpointer=self.checkpointer)

        logger.info(
            "[DynamicGraphBuilder] Compiled graph",
            playbook_id=playbook_id,
            tasks=len(tasks),
            edges=len(edges),
        )

        return {
            "compiled": compiled,
            "playbook_id": playbook_id,
            "task_count": len(tasks),
            "edge_count": len(edges),
        }

    def build_single_step_graph(
        self,
        task: TaskConfig,
        agent: Dict[str, Any],
        on_step_update: StepCallback = NoopStepCallback,
    ) -> Dict[str, Any]:
        """Build a single-task graph for RunStep gRPC compatibility.

        Reuses the same ``_create_task_node`` machinery so that the
        single-step path and the full-workflow path share identical
        HITL / interrupt / resume behaviour.
        """
        task_id = task.get("id", "single_step")

        workflow = StateGraph(ExecutionState)

        node_func = self._create_task_node(task_id, task, on_step_update)
        workflow.add_node("execute", node_func)
        workflow.set_entry_point("execute")

        async def completion_node(state: ExecutionState) -> Dict[str, Any]:
            return {"status": "completed"}

        workflow.add_node("__completion__", completion_node)
        workflow.add_edge("execute", "__completion__")
        workflow.add_edge("__completion__", END)

        compiled = workflow.compile(checkpointer=self.checkpointer)

        return {
            "compiled": compiled,
            "playbook_id": task_id,
            "task_count": 1,
            "edge_count": 0,
        }
