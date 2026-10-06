"""One bounded delegation operation exposed to an enrolled root (WP04, plan §6.5).

The dispatcher exposes a FunctionTool bridge to a replayable Workflow.
When the root calls it, trusted code
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

import hashlib
from copy import copy, deepcopy
from dataclasses import replace
from typing import Any, Dict, List, Optional

from google.adk.workflow import FunctionNode, START, Workflow
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types
from pydantic import BaseModel

from src.logger.logging import get_logger
from src.root_runtime.contracts import ExecutionRole, InvocationLifecycleState
from src.root_runtime.compiler import compile_worker
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


def _failed(agent_id: str, safe_error: str, execution_id: Optional[str] = None,
            status: str = "failed") -> Dict[str, Any]:
    return {
        "status": status,
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


async def _compile_candidate(team: Any, user_request: Any, candidate: Any, scope: Any, authorize=None) -> Any:
    """Compile one candidate through the existing factory path (lazy: only the
    specialist the root chose is materialized; other candidates stay data)."""
    from src.smart_rag.agents.core.document_helpers import DocumentHelpers

    agent_data = team.agent_helper._prepare_agent_data(
        deepcopy(DocumentHelpers.agent_to_dict(candidate)), user_request, team,
        inherit_request_context=False,
    )
    team.agent_repository.add_agent(agent_data)
    agent_name = str(agent_data.get("name") or "")
    normalized_name = team.agent_helper.normalize_agent_name(agent_name)
    factory = copy(team.delegation_factory)
    if hasattr(factory, "agent_factory"):
        from src.smart_rag.agents.factories.base_factory import AgentFactory

        source_factory = factory.agent_factory
        factory.agent_factory = AgentFactory(
            source_factory.prompt_processor, source_factory.llm_factory,
            source_factory.citation_manager,
        )
    if hasattr(factory, "config"):
        # Factory fallbacks must never expand the selected worker's capabilities
        # with root documents, attachments, conversation skills or connectors.
        factory.config = copy(factory.config)
        for field in ("brain_ids", "workspace_names", "brain_documents"):
            setattr(factory.config, field, deepcopy(agent_data.get(field) or []))
        for field in ("doc_tree", "brain_tree", "attached_files", "attached_images",
                      "previous_attached_files", "connector_repo", "skills", "attachment_context"):
            setattr(factory.config, field, None)
        factory.chatbot_name = agent_data.get("chatbot_name")
        factory.config.chatbot_name = factory.chatbot_name
        factory._image_input = None
    compiled = await compile_worker(
        agent_data, agent_name, normalized_name, scope,
        factory._create_agent_with_error_handling, team.citation_manager,
    )
    from src.root_runtime.background_sessions import FencedBackgroundSessionService
    if isinstance(getattr(user_request, 'session_service', None), FencedBackgroundSessionService):
        from src.root_runtime.background_items import validate_item
        from src.root_runtime.background_actions import install_background_action_guard
        await validate_item(user_request.session_service, scope)
        install_background_action_guard(compiled.agent, user_request.session_service, scope, authorize)
    return compiled.agent


def child_execution_id(parent_execution_id: str, native_branch: str) -> str:
    # FunctionNode loses function_call_id in ADK 2.11; its public branch keeps
    # the originating tool-call identity, including on native replay.
    if not parent_execution_id or not native_branch or not any(
            operation in native_branch for operation in ('delegate_to_agent@', 'spawn_temporary_worker@')):
        raise ValueError("Delegation requires a native tool-call branch")
    return hashlib.sha256(f"{parent_execution_id}:{native_branch}".encode()).hexdigest()[:24]


def build_worker_dispatcher(
    team: Any,
    user_request: Any,
    root_context: Dict[str, Any],
    delegate_candidates: Optional[List[Any]],
    root_scope: Any = None,
    temporary: bool = False,
    owned_adapter: Any = None,
) -> Optional[tuple]:
    """Build the replayable dispatcher Workflow for one root turn.

    Returns None when the context carries no catalog (the tool is not exposed).
    """
    if temporary and root_context.get('temporary_workers_enabled') is not True:
        return None
    catalog_entries = ([{'agent_id': root_context['root_agent_id'], 'name': 'Temporary worker',
        'snapshot_digest': root_scope.immutable_snapshot_ref if root_scope else None}]
        if temporary else root_context.get("catalog") or [])
    catalog = {
        str(entry.get("agent_id")): entry
        for entry in catalog_entries
        if isinstance(entry, dict) and entry.get("agent_id")
    }
    if not catalog:
        return None
    if root_scope is None or root_scope.role is not ExecutionRole.ROOT or root_scope.depth != 0:
        raise ValueError("Only a depth-zero ROOT can expose delegation")
    raw_depth = root_context.get("max_depth")
    max_depth = 1 if raw_depth is None else int(raw_depth)
    candidates_by_id = {
        str(getattr(candidate, "id", "") or ""): candidate
        for candidate in (delegate_candidates or [])
        if getattr(candidate, "id", None)
    }
    parent_execution_id = str(getattr(root_scope, "execution_id", "") or "")
    session_id = getattr(user_request, "session_id", "") or ""
    compiled: Dict[str, Any] = {}
    lazy = temporary or root_context.get("delegate_definition_mode") == "lazy"
    resolved_candidates: Dict[str, Any] = {}
    resolved_scopes: Dict[str, Any] = {}

    async def settle_child(execution_id, status, text=None, evidence=None):
        if owned_adapter is not None:
            return await owned_adapter.settle(execution_id, status, text, evidence)
        from src.root_runtime.delegate_resolver import settle_delegate
        return await settle_delegate(root_scope, execution_id, status, text, evidence)

    def _emit_lifecycle(lifecycle: InvocationLifecycleState, child_scope: Any, producer_agent_id: str) -> None:
        if owned_adapter is not None:
            # Owned item APIs persist leaf lifecycle; the coordinator sink must
            # only receive its own aggregate native invocation projection.
            return
        queue = getattr(team, "current_queue", None)
        if queue is None:
            return
        projector = ProducerEventProjector(child_scope, producer_agent_id=producer_agent_id)
        chunk = projector.stamp(
            {"action": "update", "metadata": {"message_id": session_id}},
            lifecycle,
        )
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
        try:
            execution_id = child_execution_id(parent_execution_id, getattr(ctx, "branch", ""))
        except ValueError:
            return _failed(agent_id, "The delegation call has no trusted native identity.")
        candidate = resolved_candidates.get(execution_id) if lazy else candidates_by_id.get(agent_id)
        if candidate is None:
            return _failed(agent_id, "The requested specialist definition was not provided for this turn.")
        producer_id = execution_id if temporary else agent_id
        child_scope = replace(root_scope, execution_id=execution_id,
                              role=ExecutionRole.TEMPORARY_WORKER if temporary else ExecutionRole.LIBRARY_WORKER,
                              parent_execution_id=parent_execution_id, depth=1,
                              native_invocation_id=getattr(ctx, 'invocation_id', None),
                              immutable_snapshot_ref=entry.get("snapshot_digest"))
        if owned_adapter is not None:
            child_scope = resolved_scopes[execution_id]
            await owned_adapter.validate(child_scope)
        logger.info(
            "[DELEGATE] start agent_id=%s execution_id=%s session_id=%s task_len=%s",
            agent_id, execution_id, session_id, len(task or ""),
        )
        _emit_lifecycle(InvocationLifecycleState.STARTED, child_scope, producer_id)
        child_started = False
        try:
            if execution_id not in compiled:
                if owned_adapter is not None:
                    compiled[execution_id] = await _compile_candidate(team, user_request, candidate, child_scope,
                        lambda: owned_adapter.validate(child_scope))
                else:
                    compiled[execution_id] = await _compile_candidate(team, user_request, candidate, child_scope)
            child_agent = compiled[execution_id]

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

            child_started = True
            try:
                result = await ctx.run_node(
                    child_agent,
                    node_input=types.Content(role="user", parts=[types.Part(text=packet)]),
                    run_id=f"execution_{execution_id}",
                    use_sub_branch=True,
                    raise_on_wait=True,
                )
            finally:
                # Native interruption propagates through ADK's public API;
                # report parking without converting it into a failed result.
                if ctx.interrupt_ids:
                    _emit_lifecycle(InvocationLifecycleState.WAITING, child_scope, producer_id)
                    if lazy:
                        from src.root_runtime.delegate_resolver import settle_delegate
                        try:
                            await settle_child(execution_id, "waiting")
                        except Exception:
                            # Preserve native interruption; a resumed bridge retries
                            # admission instead of manufacturing a completed result.
                            logger.warning("[DELEGATE] could not persist child waiting lifecycle")
            text = result if isinstance(result, str) else ("" if result is None else str(result))
            settled = {}
            if lazy:
                from src.root_runtime.delegate_resolver import settle_delegate
                from src.root_runtime.evidence_capture import collect_evidence
                settled = await settle_child(execution_id, "completed", text,
                    collect_evidence(ctx.state.to_dict(), execution_id))
            _emit_lifecycle(InvocationLifecycleState.COMPLETED, child_scope, producer_id)
            logger.info("[DELEGATE] completed agent_id=%s execution_id=%s text_len=%s", agent_id, execution_id, len(text))
            return {
                "status": "completed",
                "agent_id": producer_id,
                "execution_id": execution_id,
                "text": text[:MAX_RESULT_TEXT_CHARS],
                "result_ref": execution_id if lazy else None,
                "citation_refs": settled.get('citationRefs', []),
                "artifact_refs": settled.get('artifactRefs', []),
                "safe_error": None,
            }
        except Exception as exc:  # noqa: BLE001 — a child failure is a typed result, not a root crash
            logger.exception("[DELEGATE] failed agent_id=%s execution_id=%s", agent_id, execution_id)
            _emit_lifecycle(InvocationLifecycleState.FAILED, child_scope, producer_id)
            status = "outcome_unknown" if child_started else "failed"
            if lazy:
                from src.root_runtime.delegate_resolver import settle_delegate
                try:
                    await settle_child(execution_id, status)
                except Exception:
                    logger.warning("[DELEGATE] could not persist child interruption lifecycle")
            return _failed(
                agent_id,
                ("The specialist outcome could not be confirmed. Do not repeat actions or claim they completed."
                 if child_started else "The specialist could not complete the task. Continue without its result."),
                execution_id=execution_id,
                status=status,
            )

    node = FunctionNode(func=dispatch, name="dispatch", parameter_binding="node_input", rerun_on_resume=True)
    workflow = Workflow(
        name="delegate_to_agent",
        description=(
            "Delegate exactly one bounded task to an authorized specialist agent and get its "
            "result back. agent_id must be one of the ids in <authorized_specialists>."
        ),
        edges=[(START, node)],
        input_schema=DelegateToAgentRequest,
    )

    async def execute_selected(
        tool_context: Any, call_id: str, branch: str, agent_id: str, task: str,
        expected_output: str = "", context_refs: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        if not call_id:
            return _failed(agent_id, "The delegation call has no trusted native identity.")
        execution_id = child_execution_id(parent_execution_id, branch)
        async def admit():
            if not lazy:
                return None
            # This precedes Workflow replay/cache lookup: current authorization
            # and fresh credential bindings are required on every native call.
            if agent_id not in catalog:
                return _failed(agent_id, "The requested specialist is not in the authorized delegation catalog.")
            from src.root_runtime.delegate_resolver import resolve_delegate_definition, resolve_temporary_definition
            try:
                resolved = (await owned_adapter.resolve(execution_id) if owned_adapter is not None else
                    await resolve_temporary_definition(root_scope, call_id, branch,
                    task, expected_output, context_refs or []) if temporary else
                    await resolve_delegate_definition(root_scope, call_id, branch,
                        agent_id, task, expected_output, context_refs or []))
                candidate = resolved["candidate"]
                if resolved.get("executionId") != execution_id or candidate.id != (execution_id if temporary else agent_id):
                    raise ValueError("Resolved worker identity mismatch")
                if resolved.get("result"):
                    result = resolved["result"]
                    return {"status": result["status"], "agent_id": candidate.id if temporary else agent_id, "execution_id": execution_id,
                        "text": result.get("text"), "result_ref": execution_id if result.get("fullText") is not None else None,
                        "citation_refs": result.get("citationRefs", []),
                        "artifact_refs": result.get("artifactRefs", []), "safe_error": result.get("safeError")}
                resolved_candidates[execution_id] = candidate
                if owned_adapter is not None:
                    resolved_scopes[execution_id] = resolved['scope']
                compiled.pop(execution_id, None)
            except Exception:
                logger.warning("[DELEGATE] selected worker admission denied or unavailable")
                return _failed(agent_id, "The specialist is no longer authorized or available.", execution_id)
        terminal = await admit()
        if terminal is not None:
            return terminal

        async def run_selected():
            # Explicit identity prevents native scheduler dedup from merging
            # different model calls or immutable fan-out items.
            return await tool_context.run_node(
                workflow, node_input={"agent_id": agent_id, "task": task,
                                      "expected_output": expected_output, "context_refs": context_refs or []},
                run_id=f"call_{execution_id}", override_branch=branch,
                use_sub_branch=False, raise_on_wait=True,
            )

        if root_context.get('worker_permit_version') == 1:
            from src.root_runtime.worker_permits import worker_permit
            async with worker_permit(root_scope, execution_id, getattr(user_request, 'abort_signal', None),
                post=owned_adapter.permit if owned_adapter is not None else None) as waited:
                if waited:
                    terminal = await admit()  # Refresh authority/credentials after queueing.
                    if terminal is not None:
                        return terminal
                return await run_selected()
        return await run_selected()

    async def delegate_to_agent(
        agent_id: str, task: str, tool_context: ToolContext,
        expected_output: str = "", context_refs: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Delegate one bounded task to an authorized specialist."""
        call_id = tool_context.function_call_id
        segment = f"{'spawn_temporary_worker' if temporary else 'delegate_to_agent'}@{call_id}"
        branch = f"{tool_context.branch}.{segment}" if tool_context.branch else segment
        return await execute_selected(tool_context, call_id, branch, agent_id, task, expected_output, context_refs)

    if temporary:
        async def spawn_temporary_worker(task: str, tool_context: ToolContext,
                expected_output: str = '', context_refs: Optional[List[str]] = None) -> Dict[str, Any]:
            """Run a focused temporary task using your authorized ROOT profile.

            context_refs may contain only your configured workspace IDs; omit
            them to use the profile's own sources. Parent attachments and
            writable files are not inherited. Simple answers need no worker.
            """
            return await delegate_to_agent(root_context['root_agent_id'], task, tool_context, expected_output, context_refs)
        return FunctionTool(func=spawn_temporary_worker), execute_selected
    return FunctionTool(func=delegate_to_agent), execute_selected


def build_delegate_dispatcher(team: Any, user_request: Any, root_context: Dict[str, Any],
        delegate_candidates: Optional[List[Any]], root_scope: Any = None, temporary: bool = False) -> Optional[FunctionTool]:
    dispatcher = build_worker_dispatcher(team, user_request, root_context, delegate_candidates, root_scope, temporary)
    return dispatcher[0] if dispatcher else None
