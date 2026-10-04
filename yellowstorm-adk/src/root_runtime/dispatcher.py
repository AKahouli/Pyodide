"""One bounded delegation operation exposed to an enrolled root (WP04, plan §6.5).

The dispatcher is a schema-declared replayable Workflow converted by ADK into
the root's ``delegate_to_agent`` tool. When the root calls it, trusted code
validates the requested specialist against the compact authorized catalog
(denied/unknown ids fail closed), lazily compiles ONLY that candidate through
the existing factory path, and runs it as a single-turn node in an isolated
sub-branch with a deterministic logical execution id. The typed result goes
back to the root as the tool response; the child never receives the dispatcher
itself, so delegation depth is structurally bounded to one.

Child events flow through the parent Runner like any other event; the runner
gates visible text on the root's author so only root text becomes the public
answer (producer activity still streams).
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from google.adk.workflow import FunctionNode, START, Workflow
from google.genai import types
from pydantic import BaseModel

from src.logger.logging import get_logger
from src.root_runtime.contracts import InvocationLifecycleState
from src.root_runtime.event_projector import ProducerEventProjector

logger = get_logger("root_runtime.dispatcher")

#: Bounded result text returned to the root; large outputs stay retrievable
#: through the conversation, not the prompt (plan §12.2).
MAX_RESULT_TEXT_CHARS = 8000

DELEGATION_INSTRUCTION = """

<root_delegation>
You may delegate a bounded task to one of the authorized specialists listed in
<authorized_specialists>. Call delegate_to_agent exactly once per task with:
- agent_id: the specialist's id from the catalog (never invent one),
- task: the self-contained task for the specialist,
- expected_output: what a good result looks like,
- context_refs: optional reference ids the specialist may use.
Simple questions you can answer directly must NOT be delegated. A denied or
unknown agent_id fails closed — do not retry it. Use the returned result
(never your own guess about what the specialist did) for your synthesis.
</root_delegation>
"""

_CATALOG_BLOCK_TEMPLATE = """

<authorized_specialists>
{entries}
</authorized_specialists>
"""


class DelegateToAgentRequest(BaseModel):
    """The one bounded delegation operation's input schema."""

    agent_id: str
    task: str
    expected_output: str = ""
    context_refs: List[str] = []


def _failed(agent_id: str, safe_error: str, execution_id: Optional[str] = None) -> Dict[str, Any]:
    return {
        "status": "failed",
        "agent_id": agent_id,
        "execution_id": execution_id,
        "text": None,
        "citation_refs": [],
        "artifact_refs": [],
        "safe_error": safe_error,
    }


def build_delegation_instruction(catalog: List[Dict[str, Any]]) -> str:
    """Catalog + usage instruction appended to the root's prompt."""
    entries = "\n".join(
        f"- id={entry.get('agent_id')} name={entry.get('name')} mode={entry.get('configuration_mode')}"
        f" :: {str(entry.get('description') or '')[:200]}"
        for entry in catalog
    )
    return DELEGATION_INSTRUCTION + _CATALOG_BLOCK_TEMPLATE.format(entries=entries)


async def _compile_candidate(team: Any, user_request: Any, candidate: Any) -> Any:
    """Compile one candidate through the existing factory path (lazy: only the
    specialist the root chose is materialized; other candidates stay data)."""
    from src.smart_rag.agents.core.document_helpers import DocumentHelpers

    agents = DocumentHelpers.merge_user_request_brain_documents_into_agents([candidate], user_request)
    agent_data = team.agent_helper._prepare_agent_data(agents[0], user_request, team)
    team.agent_repository.add_agent(agent_data)
    agent_name = str(agent_data.get("name") or "")
    normalized_name = team.agent_helper.normalize_agent_name(agent_name)
    agent, _toolkit = await team.delegation_factory._create_agent_with_error_handling(
        agent_data, agent_name, normalized_name, "", False, team.citation_manager
    )
    if agent is None:
        raise RuntimeError(f"Failed to compile specialist agent: {agent_name}")
    return agent


def build_delegate_dispatcher(
    team: Any,
    user_request: Any,
    root_context: Dict[str, Any],
    delegate_candidates: Optional[List[Any]],
    root_scope: Any = None,
) -> Optional[Workflow]:
    """Build the replayable dispatcher Workflow for one root turn.

    Returns None when the context carries no catalog (the tool is not exposed).
    """
    catalog_entries = root_context.get("catalog") or []
    catalog = {
        str(entry.get("agent_id")): entry
        for entry in catalog_entries
        if isinstance(entry, dict) and entry.get("agent_id")
    }
    if not catalog:
        return None
    max_depth = int(root_context.get("max_depth") or 1)
    candidates_by_id = {
        str(getattr(candidate, "id", "") or ""): candidate
        for candidate in (delegate_candidates or [])
        if getattr(candidate, "id", None)
    }
    parent_execution_id = str(getattr(root_scope, "execution_id", "") or "")
    root_agent_id = str(getattr(root_scope, "immutable_snapshot_ref", "") or "") or str(
        root_context.get("root_agent_id") or ""
    )
    projector = ProducerEventProjector(root_scope, producer_agent_id=root_agent_id)
    session_id = getattr(user_request, "session_id", "") or ""
    compiled: Dict[str, Any] = {}

    def _emit_lifecycle(lifecycle: InvocationLifecycleState, execution_id: str, producer_agent_id: str) -> None:
        queue = getattr(team, "current_queue", None)
        if queue is None:
            return
        event = projector.event(lifecycle, source_event_id=execution_id)
        if event is None:
            return
        chunk = projector.stamp(
            {"action": "update", "metadata": {"message_id": session_id}},
            lifecycle,
        )
        chunk["execution_trace"]["execution_id"] = execution_id
        chunk["execution_trace"]["parent_execution_id"] = parent_execution_id
        chunk["execution_trace"]["producer_agent_id"] = producer_agent_id
        queue.put_nowait(chunk)

    async def dispatch(
        ctx: Any,
        agent_id: str,
        task: str,
        expected_output: str = "",
        context_refs: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        agent_id = str(agent_id or "")
        entry = catalog.get(agent_id)
        if entry is None:
            # Fail closed: unknown/denied ids never execute anything (plan §6.5).
            logger.warning(
                "[DELEGATE] denied unknown agent_id=%s session_id=%s", agent_id, session_id
            )
            return _failed(agent_id, "The requested specialist is not in the authorized delegation catalog.")
        if max_depth < 1:
            return _failed(agent_id, "The delegation depth limit is reached.")
        candidate = candidates_by_id.get(agent_id)
        if candidate is None:
            return _failed(agent_id, "The requested specialist definition was not provided for this turn.")

        # Deterministic logical execution id derived from (agent, task); on
        # replay the same request resolves to the same child branch (plan §6.5).
        execution_id = f"exec_{uuid.uuid5(uuid.NAMESPACE_URL, f'{agent_id}:{task}').hex[:12]}"
        logger.info(
            "[DELEGATE] start agent_id=%s execution_id=%s session_id=%s task_len=%s",
            agent_id, execution_id, session_id, len(task or ""),
        )
        _emit_lifecycle(InvocationLifecycleState.STARTED, execution_id, agent_id)
        try:
            if agent_id not in compiled:
                compiled[agent_id] = await _compile_candidate(team, user_request, candidate)
            child_agent = compiled[agent_id]

            packet_lines = [
                "<delegated_task>",
                f"<task>{task}</task>",
            ]
            if expected_output:
                packet_lines.append(f"<expected_output>{expected_output}</expected_output>")
            for ref in (context_refs or [])[:20]:
                packet_lines.append(f"<context_ref>{ref}</context_ref>")
            packet_lines.append("</delegated_task>")
            packet = "\n".join(packet_lines)

            result = await ctx.run_node(
                child_agent,
                node_input=types.Content(role="user", parts=[types.Part(text=packet)]),
                run_id=execution_id,
                use_sub_branch=True,
                raise_on_wait=True,
            )
            text = result if isinstance(result, str) else ("" if result is None else str(result))
            _emit_lifecycle(InvocationLifecycleState.COMPLETED, execution_id, agent_id)
            logger.info("[DELEGATE] completed agent_id=%s execution_id=%s text_len=%s", agent_id, execution_id, len(text))
            return {
                "status": "completed",
                "agent_id": agent_id,
                "execution_id": execution_id,
                "text": text[:MAX_RESULT_TEXT_CHARS],
                "citation_refs": [],
                "artifact_refs": [],
                "safe_error": None,
            }
        except Exception as exc:  # noqa: BLE001 — a child failure is a typed result, not a root crash
            logger.exception("[DELEGATE] failed agent_id=%s execution_id=%s", agent_id, execution_id)
            _emit_lifecycle(InvocationLifecycleState.FAILED, execution_id, agent_id)
            return _failed(
                agent_id,
                "The specialist could not complete the task. Continue without its result.",
                execution_id=execution_id,
            )

    node = FunctionNode(func=dispatch, name="dispatch", parameter_binding="node_input", rerun_on_resume=True)
    return Workflow(
        name="delegate_to_agent",
        description=(
            "Delegate exactly one bounded task to an authorized specialist agent and get its "
            "result back. agent_id must be one of the ids in <authorized_specialists>."
        ),
        edges=[(START, node)],
        input_schema=DelegateToAgentRequest,
    )
