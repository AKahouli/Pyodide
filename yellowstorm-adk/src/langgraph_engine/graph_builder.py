"""Dynamic LangGraph execution graph builder.

Creates unique graphs per playbook where each task becomes its own node.
Supports parallel execution, HITL via interrupt(), and dependency-based routing.

Step updates are emitted via a callback (``on_step_update``) instead of a
side-channel asyncio queue so that the graph stays serialisable and the
single streaming path (LangGraph ``astream``) is the only mechanism in use.
"""

from typing import Any, Callable, Dict, List, Optional
from difflib import SequenceMatcher
from pathlib import Path

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
    _task_requires_structured_output_synthesis,
    _synthesize_structured_outputs,
    _build_task_artifacts_from_structured_outputs,
    _collect_generated_artifacts,
)
from src.langgraph_engine.port_resolution import (
    resolve_task_inputs,
    build_task_prompt,
    build_tool_scope,
    format_workspace_file_hint,
    select_output_workspace_id,
    load_prompt_registry,
    resolve_prompt_template,
)
from src.skills.runtime import inject_skill_catalog
from datetime import datetime
import json

logger = get_logger(__name__)


def _normalize_clarification_turn(turn: Dict[str, Any]) -> Dict[str, str]:
    return {
        "role": str(turn.get("role", "user") or "user").strip() or "user",
        "content": str(turn.get("content", "") or "").strip(),
    }


def _get_clarification_context(
    state: ExecutionState,
    task_id: str,
) -> tuple[List[Dict[str, str]], str]:
    transcripts_by_task = state.get("clarification_transcripts_by_task") or {}
    description_overrides_by_task = (
        state.get("task_description_overrides_by_task") or {}
    )

    transcript = [
        _normalize_clarification_turn(turn)
        for turn in transcripts_by_task.get(task_id, [])
        if isinstance(turn, dict)
    ]
    task_description_override = str(
        description_overrides_by_task.get(task_id) or ""
    ).strip()
    return transcript, task_description_override


def _store_clarification_context(
    state: ExecutionState,
    task_id: str,
    transcript: List[Dict[str, str]],
    task_description: str,
) -> None:
    # Persist the conversation through LangGraph checkpoints so resumed runs
    # can rebuild the exact clarification context instead of starting over.
    transcripts_by_task = dict(state.get("clarification_transcripts_by_task") or {})
    description_overrides_by_task = dict(
        state.get("task_description_overrides_by_task") or {}
    )
    artifacts_by_port = dict(state.get("artifacts_by_port") or {})
    task_outputs = dict(state.get("task_outputs") or {})
    transcripts_by_task[task_id] = list(transcript)
    description_overrides_by_task[task_id] = task_description
    state["clarification_transcripts_by_task"] = transcripts_by_task
    state["task_description_overrides_by_task"] = description_overrides_by_task

    normalized_description = str(task_description or "").strip()
    if normalized_description:
        artifacts_by_port[f"{task_id}:default"] = [
            {
                "port_id": "default",
                "artifact_kind": "text",
                "content": normalized_description,
            }
        ]
        task_outputs[f"{task_id}_output"] = normalized_description

    state["artifacts_by_port"] = artifacts_by_port
    state["task_outputs"] = task_outputs


_ARTIFACT_KIND_BY_EXTENSION = {
    ".pdf": "document",
    ".doc": "document",
    ".docx": "document",
    ".odt": "document",
    ".rtf": "document",
    ".txt": "text",
    ".md": "text",
    ".py": "code",
    ".js": "code",
    ".ts": "code",
    ".tsx": "code",
    ".jsx": "code",
    ".java": "code",
    ".kt": "code",
    ".go": "code",
    ".rs": "code",
    ".c": "code",
    ".cpp": "code",
    ".h": "code",
    ".cs": "code",
    ".rb": "code",
    ".php": "code",
    ".sh": "code",
    ".bat": "code",
    ".sql": "code",
    ".r": "code",
    ".lua": "code",
    ".swift": "code",
    ".csv": "data",
    ".xlsx": "data",
    ".xls": "data",
    ".json": "data",
    ".xml": "data",
    ".yaml": "data",
    ".yml": "data",
    ".tsv": "data",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".bmp": "image",
    ".svg": "image",
    ".webp": "image",
    ".pptx": "document",
    ".ppt": "document",
    ".odp": "document",
}

_ARTIFACT_KIND_BY_MIME = {
    "application/pdf": "document",
    "application/msword": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
    "text/plain": "text",
    "text/markdown": "text",
    "text/csv": "data",
    "application/json": "data",
    "application/xml": "data",
    "text/xml": "data",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "data",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/svg+xml": "image",
    "image/webp": "image",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
}


def _normalize_port_id(value: Any) -> str:
    raw = str(value or "default").strip() or "default"
    if raw.startswith(("in-", "out-")):
        return raw.split("-", 1)[1] or "default"
    return raw


def _infer_artifact_kind(filename: str = "", mime_type: str = "") -> str | None:
    lower_filename = str(filename or "").strip().lower()
    if "." in lower_filename:
        extension = lower_filename[lower_filename.rfind(".") :]
        inferred = _ARTIFACT_KIND_BY_EXTENSION.get(extension)
        if inferred:
            return inferred

    normalized_mime = str(mime_type or "").strip().lower()
    if normalized_mime:
        return _ARTIFACT_KIND_BY_MIME.get(normalized_mime)

    return None


def _normalize_port_text(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "-")


_FILENAME_PORT_HINTS = {
    ".docx": ["docx", "doc"],
    ".pptx": ["pptx", "ppt"],
    ".xlsx": ["xlsx", "xls", "excel"],
    ".doc": ["doc"],
    ".ppt": ["ppt"],
    ".xls": ["xls", "excel"],
    ".pdf": ["pdf"],
    ".md": ["md", "markdown"],
    ".txt": ["txt", "text"],
}

_FUZZY_MATCH_THRESHOLD = 0.5


def _fuzzy_score(query: str, text: str) -> float:
    normalized_query = _normalize_port_text(query)
    normalized_text = _normalize_port_text(text)
    if not normalized_query or not normalized_text:
        return 0.0
    return SequenceMatcher(None, normalized_query, normalized_text).ratio()


def _infer_output_port_id_from_filename(
    filename: str, output_ports: List[Dict[str, Any]]
) -> str:
    for candidate in _filename_tokens(filename):
        for port in output_ports:
            port_id = _normalize_port_id(port.get("id"))
            if port_id and _port_matches_filename_token(port, candidate):
                return port_id

    stem = _normalize_port_text(Path(str(filename or "").strip()).stem)
    if stem and output_ports:
        best_score = 0.0
        best_port_id = ""
        for port in output_ports:
            port_id = _normalize_port_id(port.get("id"))
            if not port_id:
                continue
            for field in ("id", "name", "description"):
                score = _fuzzy_score(stem, str(port.get(field) or ""))
                if score > best_score:
                    best_score = score
                    best_port_id = port_id
        if best_port_id and best_score >= _FUZZY_MATCH_THRESHOLD:
            return best_port_id

    return ""


def _filename_tokens(filename: str) -> List[str]:
    normalized_filename = str(filename or "").strip().lower()
    if not normalized_filename:
        return []

    tokens = []
    stem = Path(normalized_filename).stem
    for candidate in [
        stem,
        stem.split("-", 1)[1] if stem.startswith(("out-", "in-")) else "",
    ]:
        token = _normalize_port_text(candidate)
        if token and token not in tokens:
            tokens.append(token)

    suffix = Path(normalized_filename).suffix.lower()
    for candidate in [
        suffix[1:] if suffix else "",
        *(_FILENAME_PORT_HINTS.get(suffix, [])),
    ]:
        token = _normalize_port_text(candidate)
        if token and token not in tokens:
            tokens.append(token)

    return tokens


def _port_matches_filename_token(port: Dict[str, Any], token: str) -> bool:
    normalized_token = _normalize_port_text(token)
    if not normalized_token:
        return False

    for candidate in [port.get("id"), port.get("name")]:
        normalized_candidate = _normalize_port_text(candidate)
        if normalized_candidate and (
            normalized_candidate == normalized_token
            or normalized_token in normalized_candidate
        ):
            return True
    return False


def _infer_output_port_id_from_filename(
    filename: str, output_ports: List[Dict[str, Any]]
) -> str:
    for candidate in _filename_tokens(filename):
        for port in output_ports:
            port_id = _normalize_port_id(port.get("id"))
            if port_id and _port_matches_filename_token(port, candidate):
                return port_id

    return ""


def _resolve_output_port(
    task_config: TaskConfig,
    output_ports: List[Dict[str, Any]],
    *,
    preferred_kind: str = "",
    explicit_port_id: str = "",
    filename: str = "",
    skip_if_no_compatible: bool = False,
    component_label: str,
) -> Dict[str, Any] | None:
    if not output_ports:
        return None

    task_id = str(task_config.get("id") or "unknown").strip() or "unknown"
    normalized_port_id = (
        _normalize_port_id(explicit_port_id) if explicit_port_id else ""
    )
    normalized_kind = str(preferred_kind or "").strip()

    if normalized_port_id:
        selected_port = next(
            (
                port
                for port in output_ports
                if _normalize_port_id(port.get("id")) == normalized_port_id
            ),
            None,
        )
        if selected_port is None:
            raise ValueError(
                f"Task '{task_id}' produced {component_label} targeting unknown output port '{normalized_port_id}'"
            )
        port_kind = str(selected_port.get("artifact_kind") or "").strip()
        if normalized_kind and port_kind and port_kind != normalized_kind:
            raise ValueError(
                f"Task '{task_id}' produced {component_label} for output port '{normalized_port_id}' with incompatible kind '{normalized_kind}'"
            )
        return selected_port

    candidates = [
        port
        for port in output_ports
        if not normalized_kind
        or str(port.get("artifact_kind") or "").strip() == normalized_kind
    ]
    if len(candidates) == 1:
        return candidates[0]
    if filename:
        inferred_port_id = _infer_output_port_id_from_filename(filename, candidates)
        if inferred_port_id:
            selected_port = next(
                (
                    port
                    for port in candidates
                    if _normalize_port_id(port.get("id")) == inferred_port_id
                ),
                None,
            )
            if selected_port is not None:
                return selected_port
    if len(candidates) > 1:
        query = (
            _normalize_port_text(filename)
            if filename
            else _normalize_port_text(component_label)
        )
        if query:
            ranked = sorted(
                candidates,
                key=lambda p: max(
                    _fuzzy_score(query, str(p.get(f) or ""))
                    for f in ("id", "name", "description")
                ),
                reverse=True,
            )
            top_score = max(
                _fuzzy_score(query, str(ranked[0].get(f) or ""))
                for f in ("id", "name", "description")
            )
            if top_score >= _FUZZY_MATCH_THRESHOLD:
                return ranked[0]
    if not candidates and skip_if_no_compatible:
        return None
    if not candidates:
        raise ValueError(
            f"Task '{task_id}' produced {component_label} with no compatible output port for kind '{normalized_kind or 'unknown'}"
        )

    default_port = next(
        (
            port
            for port in candidates
            if _normalize_port_id(port.get("id")) == "default"
        ),
        None,
    )
    if default_port is not None:
        logger.warning(
            f"Task '{task_id}' produced {component_label} without output_port_id; "
            f"falling back to 'default' port out of {len(candidates)} candidates",
        )
        return default_port

    logger.warning(
        f"Task '{task_id}' produced {component_label} without output_port_id; "
        f"falling back to first compatible port out of {len(candidates)} candidates",
    )
    return candidates[0]


def _extract_artifacts_from_components(
    components: List[Dict[str, Any]],
    task_config: TaskConfig,
) -> List[Dict[str, Any]]:
    """Derive port-routed artifacts from task components.

    Mirrors the NestJS ``extractArtifactsFromResult`` logic so that the ADK
    ``artifacts_by_port`` state is populated correctly for downstream tasks.
    """
    artifacts: List[Dict[str, Any]] = []
    if not components:
        return artifacts

    output_ports = task_config.get("output_ports") or []

    for comp in components:
        comp_type = comp.get("type", "")
        data = comp.get("data") or {}

        if comp_type == "artifact":
            file_path = str(data.get("file_path") or data.get("filePath") or "").strip()
            filename = str(data.get("filename", "")).strip()
            mime_type = str(data.get("mime_type") or data.get("mimeType") or "").strip()
            if not file_path or not filename:
                continue
            preferred_kind = (
                str(
                    data.get("artifact_kind")
                    or data.get("artifactKind")
                    or _infer_artifact_kind(filename, mime_type)
                    or "document"
                ).strip()
                or "document"
            )
            selected_port = _resolve_output_port(
                task_config,
                output_ports,
                preferred_kind=preferred_kind,
                explicit_port_id=str(
                    data.get("output_port_id") or data.get("outputPortId") or ""
                ).strip(),
                filename=filename,
                component_label=f"artifact '{filename or file_path or 'unnamed'}'",
            )
            port_id = selected_port.get("id", "default") if selected_port else "default"
            artifact_kind = (
                str(
                    selected_port.get("artifact_kind")
                    if selected_port
                    else preferred_kind
                )
                or preferred_kind
            )
            artifacts.append(
                {
                    "port_id": port_id,
                    "artifact_kind": artifact_kind,
                    "url": file_path,
                    "filename": filename,
                    "mime_type": mime_type,
                }
            )

        elif comp_type == "text":
            text_content = str(data.get("content", "")).strip()
            if not text_content:
                continue
            explicit_text_port_id = str(
                data.get("output_port_id") or data.get("outputPortId") or ""
            ).strip()
            if not explicit_text_port_id:
                text_ports = [
                    p for p in output_ports if p.get("artifact_kind") == "text"
                ]
                if len(text_ports) > 1:
                    continue
            text_port = _resolve_output_port(
                task_config,
                output_ports,
                preferred_kind="text",
                explicit_port_id=explicit_text_port_id,
                skip_if_no_compatible=True,
                component_label="text component",
            )
            if text_port is None:
                continue
            port_id = text_port.get("id", "default")
            artifacts.append(
                {
                    "port_id": port_id,
                    "artifact_kind": "text",
                    "content": text_content,
                }
            )

        elif comp_type == "code":
            code_content = str(data.get("code") or data.get("content") or "").strip()
            if not code_content:
                continue
            code_port = _resolve_output_port(
                task_config,
                output_ports,
                preferred_kind="code",
                explicit_port_id=str(
                    data.get("output_port_id") or data.get("outputPortId") or ""
                ).strip(),
                component_label="code component",
            )
            if code_port is None:
                code_port = {"id": "default"}
            port_id = code_port.get("id", "default")
            artifacts.append(
                {
                    "port_id": port_id,
                    "artifact_kind": "code",
                    "content": code_content,
                }
            )

    text_output = ""
    for comp in components:
        comp_type = comp.get("type", "")
        data = comp.get("data") or {}
        if comp_type == "text":
            text_output = str(data.get("content", "")).strip()
            if text_output:
                break

    has_text_artifact = any(a.get("artifact_kind") == "text" for a in artifacts)
    text_ports = [p for p in output_ports if p.get("artifact_kind") == "text"]
    text_port = text_ports[0] if len(text_ports) == 1 else None
    if (
        text_output
        and not has_text_artifact
        and (text_port is not None or not output_ports)
    ):
        port_id = text_port.get("id", "default") if text_port else "default"
        artifacts.append(
            {
                "port_id": port_id,
                "artifact_kind": "text",
                "content": text_output,
            }
        )

    return artifacts


def _build_default_text_artifact(
    task_config: TaskConfig,
    output_text: str,
    fallback_text: str = "",
) -> Dict[str, Any] | None:
    normalized_output = str(output_text or "").strip()
    normalized_fallback = str(fallback_text or "").strip()
    content = normalized_output or normalized_fallback
    if not content:
        return None

    output_ports = list(task_config.get("output_ports") or [])
    selected_port: Dict[str, Any] | None = None

    if len(output_ports) == 1:
        selected_port = output_ports[0]
    else:
        selected_port = next(
            (
                port
                for port in output_ports
                if _normalize_port_id(port.get("id")) == "default"
            ),
            None,
        )

    port_id = (
        _normalize_port_id(selected_port.get("id")) if selected_port else "default"
    )
    artifact_kind = (
        str((selected_port or {}).get("artifact_kind") or "text").strip() or "text"
    )
    if artifact_kind not in {"text", "code"}:
        return None

    return {
        "port_id": port_id,
        "artifact_kind": artifact_kind,
        "content": content,
    }


class DynamicGraphBuilder:
    """Builds dynamic execution graphs from playbook task definitions."""

    def __init__(self, checkpointer: Optional[BaseCheckpointSaver] = None):
        self.checkpointer = checkpointer or get_checkpointer_sync()

    def _build_structured_context(
        self,
        task_id: str,
        task_config: TaskConfig,
        state: ExecutionState,
    ) -> tuple[str, Dict[str, Any], list]:
        """Build legacy dependency context and resolve the task inputs."""

        resolved_inputs = resolve_task_inputs(task_id, task_config, state)
        prompt_parts: List[str] = []

        # Legacy fallback — keep raw upstream outputs available for playbooks that
        # still rely on input_keys or edge-walk context.
        input_keys = task_config.get("input_keys") or []
        if input_keys and state.get("task_outputs"):
            for key in input_keys:
                value = state["task_outputs"].get(key)
                if value is not None:
                    prompt_parts.append(f"Input '{key}':\n{value}")

        seen_source_ids: set[str] = set()
        for edge in state.get("edges") or []:
            if edge.get("target_id") != task_id:
                continue
            source_id = edge.get("source_id")
            if source_id in seen_source_ids:
                continue
            if source_id not in state.get("results", {}):
                continue

            source_task = next(
                (t for t in state.get("tasks") or [] if t.get("id") == source_id),
                None,
            )
            if not source_task:
                continue

            output = state["results"][source_id].get("output", "")
            if output:
                prompt_parts.append(
                    f"\n\nPrevious task '{source_task['title']}' result:\n{output}"
                )
                seen_source_ids.add(source_id)

        workspace_artifacts: list = []
        for port_state in (resolved_inputs.get("ports") or {}).values():
            workspace_artifacts.extend(port_state.get("workspace_artifacts") or [])

        return "\n\n".join(prompt_parts), resolved_inputs, workspace_artifacts

    def _create_task_node(
        self,
        task_id: str,
        task: TaskConfig,
        on_step_update: StepCallback = NoopStepCallback,
    ) -> Callable:
        """Create a node function for a specific task."""

        async def task_node(
            state: ExecutionState, config: RunnableConfig
        ) -> Dict[str, Any]:
            from langchain_openai import ChatOpenAI
            from langgraph.types import interrupt
            from src.config.settings import get_settings
            import time

            settings = get_settings()
            task_config = task
            playbook_id = state.get("playbook_id", "")
            thread_id = state.get("thread_id")
            agent_id = task_config.get("assigned_agent_id")
            start_time = time.time()
            started_at = datetime.utcnow().isoformat() + "Z"

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
                    logger.warning(
                        f"[{task_id}] step_update callback failed", exc_info=True
                    )

            if not agent_id or agent_id not in state["agents"]:
                error_msg = f"No agent assigned to task {task_id}"
                logger.error(f"[{task_id}] {error_msg}")
                await _push_step_update(
                    "failed",
                    result={
                        "task_id": task_id,
                        "status": "failed",
                        "output": "",
                        "error": error_msg,
                        "duration_ms": int((time.time() - start_time) * 1000),
                        "components": [],
                        "tool_trace": [],
                        "llm_prompt_trace": [],
                    },
                )
                return {
                    "completed_task_ids": [task_id],
                    "results": {
                        task_id: {
                            "task_id": task_id,
                            "status": "failed",
                            "error": error_msg,
                        }
                    },
                    "error": error_msg,
                    "status": "failed",
                }

            agent = state["agents"][agent_id]

            logger.info(f"[{task_id}] Starting task", title=task_config.get("title"))

            components: List[Dict[str, Any]] = []
            tool_trace: List[Dict[str, Any]] = []
            llm_prompt_trace: List[Dict[str, Any]] = []

            try:
                await _push_step_update("in_progress")
                task_for_execution = task_config
                clarification_transcript, task_description_override = (
                    _get_clarification_context(state, task_id)
                )
                if task_description_override:
                    task_for_execution = {
                        **task_for_execution,
                        "description": task_description_override,
                    }
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

                    clarification_limit = max(
                        int(task_config.get("max_clarifications") or 0), 0
                    )
                    clarification_resolved = False
                    for round_number in range(1, clarification_limit + 1):
                        prior_turns = "\n".join(
                            f"{turn.get('role', 'user')}: {turn.get('content', '')}"
                            for turn in clarification_transcript
                        )
                        clarification_prompt = task_config.get(
                            "clarification_prompt"
                        ) or resolve_prompt_template(
                            prompt_registry,
                            "task.clarification",
                            field="systemTemplate",
                            fallback=(
                                "Review the task below and determine if you have enough information to complete it.\n"
                                f"Task: {task_config['title']}\n"
                                f"Description: {task_for_execution['description']}\n"
                                "If you need clarification, respond with one clear question only. "
                                "If everything is clear, respond with exactly 'CLEAR'."
                            ),
                        )
                        if prior_turns:
                            clarification_prompt += (
                                f"\n\nPrior clarification turns:\n{prior_turns}"
                            )

                        _store_clarification_context(
                            state,
                            task_id,
                            clarification_transcript,
                            task_for_execution["description"],
                        )
                        check_result = await llm.ainvoke(
                            [HumanMessage(content=clarification_prompt)]
                        )
                        check_text = check_result.content.strip()

                        if check_text.upper() == "CLEAR":
                            clarification_resolved = True
                            break

                        clarification_transcript.append(
                            {"role": "assistant", "content": check_text}
                        )
                        clarification_payload = _build_interrupt_payload(
                            "clarification",
                            check_text,
                            task_description=task_for_execution.get("description", ""),
                            round_number=round_number,
                            transcript=clarification_transcript,
                            resumable_actions=["reply", "skip"],
                        )
                        await _push_step_update(
                            "suspended", interrupt_data=clarification_payload
                        )
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
                                "results": {
                                    task_id: {"status": "skipped", "output": ""}
                                },
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
                                "results": {
                                    task_id: {
                                        "error": "Clarification response was empty"
                                    }
                                },
                                "error": "Clarification response was empty",
                                "status": "failed",
                            }

                        clarification_transcript.append(
                            {"role": "user", "content": user_reply}
                        )
                        task_description = f"{task_for_execution['description']}\n\nClarification from user: {user_reply}"
                        task_for_execution = {
                            **task_for_execution,
                            "description": task_description,
                        }
                        _store_clarification_context(
                            state, task_id, clarification_transcript, task_description
                        )
                        clarification_resolved = True
                        break

                    if clarification_limit == 0:
                        clarification_resolved = True
                    if not clarification_resolved:
                        return {
                            "completed_task_ids": [task_id],
                            "results": {
                                task_id: {"error": "Clarification limit exceeded"}
                            },
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
                    await _push_step_update(
                        "suspended", interrupt_data=approval_payload
                    )
                    approval_response = interrupt(approval_payload)

                    logger.info(
                        f"[{task_id}] Approval response received",
                        response=approval_response,
                    )

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

                    approval_action = normalize_interrupt_action(
                        approval_response, "approval_request"
                    )

                    if approval_action == "reject":
                        error_msg = (
                            extract_interrupt_message(approval_response)
                            or "Task rejected by human"
                        )
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

                # === STEP 3: Build prompt context from resolved inputs ===
                context, resolved_inputs, workspace_artifacts = (
                    self._build_structured_context(task_id, task_config, state)
                )
                prompt_registry = load_prompt_registry(
                    state.get("prompt_overrides") or {}
                )

                workspace_context_for_hint = (
                    state.get("workspace_context")
                    if not resolved_inputs.get("has_port_sources")
                    else None
                )
                workspace_file_hint = format_workspace_file_hint(
                    workspace_context_for_hint
                )

                def _build_user_prompt(
                    current_task_for_execution: Dict[str, Any],
                ) -> str:
                    return build_task_prompt(
                        current_task_for_execution,
                        resolved_inputs,
                        context_from_dependencies=context,
                        user_query=state.get("query", ""),
                        workspace_file_hint=workspace_file_hint,
                        trigger_context=state.get("trigger_context"),
                        prompt_overrides=state.get("prompt_overrides") or {},
                    )

                agent_instructions = inject_skill_catalog(
                    agent.get("instructions") or agent.get("prompt", ""),
                    agent.get("skills") or [],
                )
                system_prompt = resolve_prompt_template(
                    prompt_registry,
                    "task.system",
                    field="systemTemplate",
                    fallback=(
                        f"You are {agent['name']}.\n\n"
                        f"Your instructions:\n{agent_instructions}\n\n"
                        f"You are working on a task as part of a larger playbook execution."
                    ),
                )
                system_prompt = system_prompt.replace(
                    "{{agentName}}", agent["name"]
                ).replace("{{agentInstructions}}", agent_instructions)

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

                user_prompt = _build_user_prompt(task_for_execution)

                async def _execute_task_once(
                    current_task_for_execution: Dict[str, Any],
                    current_user_prompt: str,
                ) -> tuple[Dict[str, Any], str]:
                    nonlocal components, tool_trace, llm_prompt_trace
                    model_name = agent.get("model") or "gpt-4.1"
                    agent_params = agent.get("agent_params") or {}
                    temperature = float(agent_params.get("temperature", 0.7))
                    components = []
                    tool_trace = []
                    llm_prompt_trace = []

                    from src.langgraph_engine.playbook_tool_factory import (
                        create_langchain_tools,
                    )
                    from src.langgraph_engine.step_executor import (
                        _execute_with_tools,
                        _execute_replay_tool_calls,
                    )

                    tool_scope = build_tool_scope(resolved_inputs)
                    output_workspace_id = select_output_workspace_id(resolved_inputs)
                    code_interpreter_files = (
                        tool_scope["all_files"] or tool_scope["fallback_files"]
                    )
                    input_files = list(task_config.get("input_files") or [])
                    for doc_id in tool_scope["all_document_ids"]:
                        if doc_id not in input_files:
                            input_files.append(doc_id)

                    logger.info(
                        f"[{task_id}] INPUT_FILES_DEBUG",
                        has_input_files=bool(input_files),
                        input_files_count=len(input_files),
                        input_files_by_port_count=len(tool_scope["documents_by_port"]),
                        workspace_context_mode=tool_scope["workspace_context_mode"],
                    )

                    lc_tools, collector = create_langchain_tools(
                        agent,
                        workspace_context=effective_workspace_context,
                        input_files=input_files,
                        documents_by_port=tool_scope["documents_by_port"],
                        code_interpreter_files=code_interpreter_files,
                        output_workspace_id=output_workspace_id,
                        workspace_context_mode=tool_scope["workspace_context_mode"],
                        step_connector_bindings=task.get("tool_bindings"),
                    )
                    step_execution_modes = state.get("step_execution_modes") or {}
                    execution_mode = step_execution_modes.get(task_id) or state.get(
                        "execution_mode", "live"
                    )
                    validated_replay = (
                        state.get("validated_replays_by_task") or {}
                    ).get(task_id)
                    logger.info(
                        f"[{task_id}] EXECUTION_MODE_DECISION",
                        execution_mode=execution_mode,
                        has_validated_replay=bool(validated_replay),
                        replay_id=(validated_replay or {}).get("replay_id"),
                        replay_tool_calls=len(
                            (validated_replay or {}).get("tool_calls", []) or []
                        ),
                        available_tools=[tool.name for tool in lc_tools],
                    )

                    progress_state: Dict[str, Any] = {
                        "output": "",
                        "components": list(components),
                        "tool_trace": list(tool_trace),
                        "llm_prompt_trace": list(llm_prompt_trace),
                        "artifacts": [],
                    }

                    async def _on_execution_progress(progress: Dict[str, Any]) -> None:
                        nonlocal components, tool_trace, llm_prompt_trace

                        if progress.get("output") is not None:
                            progress_state["output"] = progress.get("output") or ""
                        if "components" in progress:
                            progress_state["components"] = list(
                                progress.get("components") or []
                            )
                            components = list(progress_state["components"])
                        if "tool_trace" in progress:
                            progress_state["tool_trace"] = list(
                                progress.get("tool_trace") or []
                            )
                            tool_trace = list(progress_state["tool_trace"])
                        if "llm_prompt_trace" in progress:
                            progress_state["llm_prompt_trace"] = list(
                                progress.get("llm_prompt_trace") or []
                            )
                            llm_prompt_trace = list(progress_state["llm_prompt_trace"])
                        if "artifacts" in progress:
                            progress_state["artifacts"] = list(
                                progress.get("artifacts") or []
                            )

                        has_progress = (
                            bool(progress_state["output"])
                            or bool(progress_state["components"])
                            or bool(progress_state["tool_trace"])
                            or bool(progress_state["llm_prompt_trace"])
                            or bool(progress_state["artifacts"])
                        )
                        if not has_progress:
                            return

                        await _push_step_update(
                            "in_progress",
                            result={
                                "task_id": task_id,
                                "status": "in_progress",
                                "output": progress_state["output"],
                                "error": "",
                                "duration_ms": int((time.time() - start_time) * 1000),
                                "components": progress_state["components"],
                                "tool_trace": progress_state["tool_trace"],
                                "llm_prompt_trace": progress_state["llm_prompt_trace"],
                                "artifacts": progress_state["artifacts"],
                            },
                        )

                    if (
                        execution_mode
                        in ("replay_strict", "replay_flex", "replay_adaptive")
                        and validated_replay
                    ):
                        if not lc_tools:
                            raise ValueError(
                                f"Validated replay for task {task_id} cannot run because no tools are configured"
                            )
                        logger.info(
                            f"[{task_id}] Executing replay mode",
                            mode=execution_mode,
                            replay_id=validated_replay.get("replay_id"),
                            tool_calls=len(
                                validated_replay.get("tool_calls", []) or []
                            ),
                        )
                        (
                            strict_response,
                            components,
                            tool_trace,
                            synthesis_context,
                        ) = await _execute_replay_tool_calls(
                            lc_tools,
                            collector,
                            validated_replay,
                            prompt_trace=llm_prompt_trace,
                            adaptive=execution_mode == "replay_adaptive",
                            adaptation_context={
                                "task_id": task_id,
                                "task_title": current_task_for_execution.get(
                                    "title", ""
                                ),
                                "task_description": current_task_for_execution.get(
                                    "description", ""
                                ),
                                "current_query": state.get("query", ""),
                                "dependency_context": context,
                                "reference_task_title": validated_replay.get(
                                    "task_title", ""
                                ),
                                "reference_task_description": validated_replay.get(
                                    "reference_task_description", ""
                                ),
                            },
                            settings=settings,
                            model_name=model_name,
                            on_progress=_on_execution_progress,
                            prompt_overrides=state.get("prompt_overrides") or {},
                        )
                        if execution_mode in ("replay_flex", "replay_adaptive"):
                            format_guide = (
                                validated_replay.get("output_format_guide") or ""
                            ).strip()
                            replay_system_prompt = resolve_prompt_template(
                                prompt_registry,
                                "replay.final_synthesis",
                                field="systemTemplate",
                                fallback=system_prompt,
                            )
                            replay_user_prefix = resolve_prompt_template(
                                prompt_registry,
                                "replay.final_synthesis",
                                field="userTemplate",
                                fallback="Use the following replayed tool execution results to produce the final answer.",
                            )
                            replay_user_prefix = replay_user_prefix.replace(
                                "{{synthesisContext}}", synthesis_context
                            )
                            format_instruction = ""
                            if (
                                validated_replay.get("preserve_output_format")
                                and format_guide
                            ):
                                format_instruction = f"""\n\n#Output Furmat guidelines
                                    Preserve the validated output format.\n
                                    {format_guide}\n\n
                                    Keep the structure and presentation style, but refresh the content from the current replay evidence only."""
                            replay_user_prompt = (
                                f"{current_user_prompt}\n\n"
                                f"{replay_user_prefix}"
                                f"{format_instruction}"
                            )
                            response, usage = await self._llm_direct_call(
                                settings,
                                model_name,
                                replay_system_prompt,
                                replay_user_prompt,
                                temperature=temperature,
                                prompt_trace=llm_prompt_trace,
                                stage="replay_final_synthesis",
                                on_progress=_on_execution_progress,
                            )
                        else:
                            response = strict_response
                            usage = {
                                "input_tokens": 0,
                                "output_tokens": 0,
                                "total_tokens": 0,
                                "model": "",
                            }
                    elif lc_tools:
                        logger.info(
                            f"[{task_id}] Executing with real tools",
                            count=len(lc_tools),
                            tools=[t.name for t in lc_tools],
                        )
                        (
                            response,
                            components,
                            usage,
                            tool_trace,
                            llm_prompt_trace,
                        ) = await _execute_with_tools(
                            settings,
                            model_name,
                            system_prompt,
                            current_user_prompt,
                            lc_tools,
                            collector,
                            temperature=temperature,
                            on_progress=_on_execution_progress,
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
                            on_progress=_on_execution_progress,
                        )
                        components = []
                        tool_trace = []

                    is_visualizer = (
                        agent.get("agent_type") == "visualizer"
                        or agent["name"] == "Visualizer Agent"
                        or "visualizer_agent" in agent["name"].lower()
                    )
                    if is_visualizer and response:
                        components.insert(
                            0,
                            {
                                "type": "web_preview",
                                "data": {"content": response},
                            },
                        )

                    artifacts: List[Dict[str, Any]] = []
                    if _task_requires_structured_output_synthesis(
                        current_task_for_execution
                    ):
                        structured_outputs = await _synthesize_structured_outputs(
                            settings,
                            model_name,
                            current_task_for_execution,
                            response,
                            components,
                            prompt_trace=llm_prompt_trace,
                            prompt_overrides=state.get("prompt_overrides") or {},
                        )
                        generated_artifacts = _collect_generated_artifacts(components)
                        if not structured_outputs and (
                            str(response or "").strip() or generated_artifacts
                        ):
                            raise ValueError(
                                f"Task '{task_id}' completed without structured output mappings for semantically ambiguous output ports"
                            )
                        artifacts = _build_task_artifacts_from_structured_outputs(
                            current_task_for_execution,
                            structured_outputs,
                            generated_artifacts,
                        )

                    return (
                        {
                            "output": "" if is_visualizer else response,
                            "task_id": task_id,
                            "task_title": task_config["title"],
                            "agent_name": agent["name"],
                            "components": components,
                            "usage": usage,
                            "tool_trace": tool_trace,
                            "llm_prompt_trace": llm_prompt_trace,
                            "artifacts": artifacts,
                        },
                        response,
                    )

                review_round = 0
                while True:
                    task_result, response = await _execute_task_once(
                        task_for_execution, user_prompt
                    )

                    if task_config.get("allow_clarification", False):
                        clarification_limit = max(
                            int(task_config.get("max_clarifications") or 0), 0
                        )
                        clarification_round = (
                            sum(
                                1
                                for turn in clarification_transcript
                                if turn.get("role") == "assistant"
                            )
                            + 1
                        )
                        follow_up_question = extract_follow_up_question(
                            task_result.get("output", "")
                        )

                        if (
                            follow_up_question
                            and clarification_limit > 0
                            and clarification_round <= clarification_limit
                        ):
                            clarification_transcript.append(
                                {
                                    "role": "assistant",
                                    "content": task_result.get("output", ""),
                                }
                            )
                            _store_clarification_context(
                                state,
                                task_id,
                                clarification_transcript,
                                task_for_execution["description"],
                            )
                            clarification_payload = _build_interrupt_payload(
                                "clarification",
                                follow_up_question,
                                task_description=task_for_execution.get(
                                    "description", ""
                                ),
                                result_text=task_result.get("output", ""),
                                round_number=clarification_round,
                                transcript=clarification_transcript,
                                resumable_actions=["reply", "skip"],
                            )
                            await _push_step_update(
                                "suspended", interrupt_data=clarification_payload
                            )
                            response = interrupt(clarification_payload)
                            action = normalize_interrupt_action(
                                response, "clarification"
                            )

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
                                    "llm_prompt_trace": task_result.get(
                                        "llm_prompt_trace", []
                                    ),
                                    "semantic_match": task_result.get("semantic_match"),
                                }
                                await _push_step_update(
                                    "skipped", result=skipped_result
                                )
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
                                    "results": {
                                        task_id: {
                                            "error": "Clarification response was empty"
                                        }
                                    },
                                    "error": "Clarification response was empty",
                                    "status": "failed",
                                }

                            clarification_transcript.append(
                                {"role": "user", "content": user_reply}
                            )
                            task_description = f"{task_for_execution['description']}\n\nClarification from user: {user_reply}"
                            task_for_execution = {
                                **task_for_execution,
                                "description": task_description,
                            }
                            _store_clarification_context(
                                state,
                                task_id,
                                clarification_transcript,
                                task_description,
                            )
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
                    review_action = normalize_interrupt_action(
                        review_response, "review_request"
                    )

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
                        error_msg = (
                            extract_interrupt_message(review_response)
                            or "Task result rejected by human"
                        )
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
                    review_transcript.append(
                        {"role": "user", "content": feedback_message}
                    )
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

                output_text = task_result.get("output", "")
                task_artifacts = list(task_result.get("artifacts") or [])
                if not task_artifacts:
                    task_artifacts = _extract_artifacts_from_components(
                        task_result.get("components") or [],
                        task_config,
                    )
                if not task_artifacts:
                    default_text_artifact = _build_default_text_artifact(
                        task_config,
                        output_text,
                        task_for_execution.get("description", ""),
                    )
                    if default_text_artifact is not None:
                        task_artifacts = [default_text_artifact]
                if task_artifacts:
                    task_result["artifacts"] = task_artifacts

                await _push_step_update(
                    "completed",
                    result={
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
                        "artifacts": task_result.get("artifacts", []),
                    },
                )

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
                    port_artifacts: Dict[str, List[Dict[str, Any]]] = {}
                    for art in raw_artifacts:
                        port_id = _normalize_port_id(art.get("port_id", "default"))
                        art_key = f"{task_id}:{port_id}"
                        port_artifacts.setdefault(art_key, []).append(art)
                    state_update["artifacts_by_port"] = port_artifacts

                return state_update

            except Exception as e:
                if "GraphInterrupt" in type(e).__name__:
                    raise

                completed_at = datetime.utcnow().isoformat() + "Z"
                duration_ms = int((time.time() - start_time) * 1000)
                error_msg = str(e)

                logger.error(
                    f"[{task_id}] Failed", error=error_msg, duration_ms=duration_ms
                )

                await _push_step_update(
                    "failed",
                    result={
                        "task_id": task_id,
                        "status": "failed",
                        "output": "",
                        "error": error_msg,
                        "duration_ms": duration_ms,
                        "components": components,
                        "tool_trace": tool_trace,
                        "llm_prompt_trace": llm_prompt_trace,
                    },
                )

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
        on_progress=None,
    ) -> tuple:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        from src.langgraph_engine.step_executor import (
            _extract_usage,
            _append_prompt_trace,
            _content_to_text,
            _stream_chat_response,
        )

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
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
        if on_progress is not None:
            result = await _stream_chat_response(llm, messages, on_progress)
            if result is None:
                result = await llm.ainvoke(messages)
        else:
            result = await llm.ainvoke(messages)
        return _content_to_text(result.content), _extract_usage(result)

    def _find_entry_tasks(
        self, tasks: List[TaskConfig], edges: List[EdgeConfig]
    ) -> List[str]:
        all_task_ids = {t["id"] for t in tasks if t.get("id")}
        target_ids = {
            e["target_id"] for e in edges if e.get("source_id") != "__trigger__"
        }
        entry_ids = list(all_task_ids - target_ids)

        if not entry_ids and all_task_ids:
            entry_ids = [
                min(
                    all_task_ids,
                    key=lambda tid: next(
                        (
                            t.get("execution_order", 999)
                            for t in tasks
                            if t.get("id") == tid
                        ),
                        999,
                    ),
                )
            ]

        return entry_ids

    def _find_exit_tasks(
        self, tasks: List[TaskConfig], edges: List[EdgeConfig]
    ) -> List[str]:
        all_task_ids = {t["id"] for t in tasks if t.get("id")}
        source_ids = {
            e["source_id"] for e in edges if e.get("source_id") != "__trigger__"
        }
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
            logger.info(
                "[DynamicGraphBuilder] Added node",
                node=node_name,
                title=task.get("title"),
            )

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
            if source_id == "__trigger__":
                continue
            incoming_by_target.setdefault(target_id, []).append(source_id)

        for target_id, source_ids in incoming_by_target.items():
            target_node = f"task_{target_id}"
            source_nodes = [f"task_{source_id}" for source_id in source_ids]

            if len(source_nodes) == 1:
                workflow.add_edge(source_nodes[0], target_node)
                logger.info(
                    "[DynamicGraphBuilder] Added edge",
                    source=source_nodes[0],
                    target=target_node,
                )
                continue

            workflow.add_edge(source_nodes, target_node)
            logger.info(
                "[DynamicGraphBuilder] Added barrier edge",
                sources=source_nodes,
                target=target_node,
            )

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
