"""Run/resume a Plan on the LangGraph executor loop.

The graph is plan-INDEPENDENT (one fixed tick/worker loop); the plan lives in
checkpointed state. So resume/continue just recompile the same loop and re-enter
the checkpoint — no rebuild-from-snapshot, no event replay, no replay barrier.

thread_id = session_id. The checkpointer is passed in (caller owns its lifecycle):
AsyncPostgresSaver in prod, AsyncSqliteSaver/MemorySaver in tests.

HITL: on a parked interrupt the runner sets the step BLOCKED, stores the interrupt
id (plan_steps.interrupt_id) and, for await_reply, binds the mail_waits row so
DeliverMailReply can claim it. A worker that spawns follow-up work upserts the new
rows live (on_insert) because set_step_status is UPDATE-only.
"""
from __future__ import annotations

from typing import List, Optional

from langgraph.types import Command

from ..plan import Plan, Status, Step
from .graph import build_graph, _to_state_step
from .graph_types import ProjectFn

_RECURSION_LIMIT = 250  # ponytail: fixed backstop (also caps runaway spawning); raise if huge plans need it


def build_chat_model(model_name: str, *, temperature: float = 0.0):
    """A langchain chat model on the SAME litellm proxy the ADK path uses
    (nodes.build_llm). The proxy is OpenAI-compatible, so ChatOpenAI routes the
    custom model names (gpt-6-luna, …) straight through.

    Temperature is normalized the same way build_llm does: a reasoning model
    (gpt-5/gpt-6/kimi) rejects temperature=0 and requires 1 — see
    normalize_temperature_for_model. Skipping this 400s the whole turn."""
    from langchain_openai import ChatOpenAI
    from src.config.settings import get_settings
    from src.smart_rag.infrastructure.model_parameters import normalize_temperature_for_model
    s = get_settings()
    temp = normalize_temperature_for_model(model_name, temperature)
    kwargs = {"model": model_name, "base_url": s.LITELLM_API_BASE_URL,
              "api_key": s.LITELLM_API_SECRET_KEY}
    if temp is not None:
        kwargs["temperature"] = temp
    return ChatOpenAI(**kwargs)


def plan_from_snapshot(snap: dict) -> Plan:
    """Rebuild a Plan from a read-model snapshot (used by converse/amend which
    reason over the current plan). Execution no longer needs this — the plan is
    in checkpoint state — but the amend planner does."""
    p = snap.get("plan") or {}
    steps = []
    for row in snap.get("steps") or []:
        deps = [d for d in (row.get("depends_on") or "").split(",") if d]
        steps.append(Step(
            id=row["step_id"], title=row.get("title") or "",
            description=row.get("description") or "",
            kind=row.get("kind") or "execute", question=row.get("question"),
            depends_on=deps, status=Status(row["status"]),
            wave=row.get("wave") or 0, result=row.get("result"),
            assignee=row.get("assignee"), assignee_name=row.get("assignee_name"),
            assignee_role=row.get("assignee_role"), is_persona=bool(row.get("is_persona")),
            is_dynamic_delegate=bool(row.get("is_dynamic_delegate")),
            interrupt_id=row.get("interrupt_id")))
    return Plan(id=p.get("id") or "", title=p.get("title") or "",
                goal=p.get("goal") or "", status=Status(p.get("status") or "running"),
                steps=steps, executor_id=p.get("executor_id"),
                executor_name=p.get("executor_name"))


# 14-field row contract of ReadModel.upsert_steps (readmodel.py:267).
def _dict_to_row(d: dict):
    deps = d.get("depends_on") or []
    return (d["id"], d.get("ordinal", 0), d.get("wave", 0),
            d.get("status", "pending"), d.get("kind", "execute"),
            d.get("question") or "", d.get("title") or "", d.get("description") or "",
            ",".join(deps), d.get("assignee") or "", d.get("assignee_name") or "",
            d.get("assignee_role") or "", bool(d.get("is_persona")),
            bool(d.get("is_dynamic_delegate")))


def _state_plan(plan: Plan) -> List[dict]:
    """Plan -> the state list the loop runs on. Ordinal = list position (Step has
    no ordinal field); carried in the dict so re-upserts keep read-model order."""
    out = []
    for i, s in enumerate(plan.steps):
        d = _to_state_step(s)
        d["ordinal"] = i
        out.append(d)
    return out


class LgRunner:
    """read_model may be None (offline/tests): then nothing is projected."""

    def __init__(self, model_name: str, read_model=None, tools_for=None, instruction=None):
        self._model_name = model_name
        self._rm = read_model
        self._tools_for = tools_for  # tools_for(step) -> [langchain tools] | None
        self._instruction = instruction  # executor's agentstore prompt (or None)

    def _project_fn(self, session_id: str) -> Optional[ProjectFn]:
        rm = self._rm
        if rm is None:
            return None

        async def project(step_id: str, status: str, result: Optional[str] = None):
            await rm.set_step_status(session_id, step_id, status, result=result)

        return project

    def _artifact_fn(self, session_id: str):
        rm = self._rm
        if rm is None or not hasattr(rm, "add_step_artifact"):
            return None

        async def on_artifact(step_id: str, artifact: dict):
            await rm.add_step_artifact(session_id, step_id, **artifact)

        return on_artifact

    def _insert_fn(self, session_id: str):
        """Upsert runtime-spawned/re-parented steps into the read model NOW, so a
        subsequent set_step_status (UPDATE-only) on them lands."""
        rm = self._rm
        if rm is None:
            return None

        async def on_insert(step_dicts: List[dict]):
            await rm.upsert_steps(session_id, [_dict_to_row(d) for d in step_dicts])

        return on_insert

    def _compile(self, session_id: str, checkpointer, model):
        chat = model or build_chat_model(self._model_name)
        return build_graph(chat, self._project_fn(session_id),
                           tools_for=self._tools_for,
                           instruction=self._instruction,
                           on_artifact=self._artifact_fn(session_id),
                           on_insert=self._insert_fn(session_id)).compile(
                               checkpointer=checkpointer)

    async def _drive(self, app, session_id: str, inp) -> dict:
        """Invoke once, then reconcile parked interrupts into the read model.
        Returns {parked:[(interrupt_id, step_id, kind)], values, done}.

        Parked set comes from the invoke's `__interrupt__` (accurate for THIS
        drive). A re-parked sibling gets a NEW interrupt id every drive, so its
        mail wait is re-bound to the fresh id below — mandatory."""
        config = {"configurable": {"thread_id": session_id},
                  "recursion_limit": _RECURSION_LIMIT}
        out = await app.ainvoke(inp, config)
        snap = await app.aget_state(config)

        parked = []
        for it in (out.get("__interrupt__") or ()):
            payload = it.value or {}
            sid, kind = payload.get("step_id"), payload.get("kind")
            parked.append((it.id, sid, kind))
            if self._rm and sid:
                await self._rm.set_step_status(session_id, sid, "blocked",
                                               blocked_reason=kind, interrupt_id=it.id)
                if kind == "await_reply":
                    await self._rm.bind_mail_wait_interrupt(session_id, sid, it.id)

        if self._rm:
            if parked:
                # An ask makes the session `waiting` (chat-answerable) even when a
                # mail/Teams wait is also parked. Only mail waits => `blocked`.
                ask_iid = next((iid for iid, _, k in parked if k == "ask"), None)
                if ask_iid:
                    await self._rm.set_waiting(session_id, ask_iid)
                else:
                    await self._rm.set_session_status(session_id, "blocked")
            elif not snap.next:
                await self._rm.set_session_status(session_id, "completed")

        return {"parked": parked, "values": snap.values,
                "done": not snap.next and not parked}

    async def run(self, plan: Plan, session_id: str, checkpointer, *, model=None) -> dict:
        if self._rm is not None:
            await self._rm.upsert_plan(session_id, plan.id, plan.title, plan.goal,
                                       "running",
                                       executor_id=plan.executor_id,
                                       executor_name=plan.executor_name)
            await self._rm.upsert_steps(session_id,
                                        [_dict_to_row(d) for d in _state_plan(plan)])
        app = self._compile(session_id, checkpointer, model)
        return await self._drive(app, session_id,
                                 {"plan": _state_plan(plan), "results": {}})

    async def resume(self, session_id: str, interrupt_id: str, answer: str,
                     checkpointer, *, model=None) -> dict:
        """Resume the parked interrupt with `answer`. The plan is in checkpoint
        state, so this just re-enters the same loop."""
        app = self._compile(session_id, checkpointer, model)
        return await self._drive(app, session_id,
                                 Command(resume={interrupt_id: answer}))

    async def continue_run(self, session_id: str, checkpointer, *, model=None) -> dict:
        """Continue a paused plan from its checkpoint (no new input)."""
        app = self._compile(session_id, checkpointer, model)
        return await self._drive(app, session_id, None)

    async def inject_and_continue(self, session_id: str, new_steps: List[Step],
                                  checkpointer, *, model=None,
                                  start_ordinal: int = 1000,
                                  changed_steps: Optional[List[Step]] = None) -> dict:
        """Amend a live plan (converse): push the new steps AND any op-changed
        existing steps into the checkpointed plan state, then drive. merge_plan
        appends new ids and updates existing ones (deps/status/description) in place;
        the next tick runs whatever became ready — same mechanism as an executor
        spawn. Read-model rows were already synced by the caller (_inject_steps/
        _apply_ops); this only touches graph state."""
        app = self._compile(session_id, checkpointer, model)
        dicts = []
        for i, s in enumerate(new_steps or []):
            d = _to_state_step(s)
            d["ordinal"] = start_ordinal + i
            dicts.append(d)
        # Changed existing steps: no ordinal key -> merge_plan keeps their position,
        # updates only the changed fields (e.g. depends_on after insert_before).
        for s in (changed_steps or []):
            dicts.append(_to_state_step(s))
        if not dicts:
            return await self._drive(app, session_id, None)
        config = {"configurable": {"thread_id": session_id}}
        await app.aupdate_state(config, {"plan": dicts})
        return await self._drive(app, session_id, None)
