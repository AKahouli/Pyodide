"""Plan -> a scheduler-driven Functional-API executor (not a StateGraph loop).

The plan lives in the entrypoint's persisted state as an ordered list of step
dicts. A single `@entrypoint` runs a plain async scheduler loop: find the READY
steps (deps' results present), launch each as a `@task` (durable, memoized),
`asyncio.wait(FIRST_COMPLETED)`, commit each result, recompute readiness, launch
newly-ready work. Progress is driven by which future completes — NOT by a global
super-step barrier — so an independent fast branch advances without waiting for a
slow sibling in the same wave (the StateGraph tick/Send/worker BSP model could
not: `worker -> tick` was a JOIN that blocked the next round on the slowest task;
see langchain-ai/langgraph#6320). A worker inserts runtime work by returning new
steps, which the loop merges into the plan and picks up on the next pass.

No `interrupt()` anywhere: both pauses are STATE-DRIVEN. An `ask` step is not
ready until its answer is in `answers`; an `await_reply` step is not ready until
its reply is in `replies`. Until then the step is simply "not launched", the
entrypoint returns cleanly, and the runner marks it blocked in the read model.
A new answer/reply is a re-drive that advances only that branch — parallel waits
never block each other, and there is no whole-graph halt to resume by id-map.

Step kind routes inside the worker: ask -> the answer IS the result (no LLM);
await_reply -> an LLM acts on the reply (can spawn); else an LLM execute step.
"""
from __future__ import annotations

import asyncio
from typing import Callable, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.func import entrypoint, task

from ..plan import Step
from .graph_types import ProjectFn, merge_plan, merge_results

# an object with .ainvoke([messages]) -> message-with-.content (a chat model or a fake)
ChatModel = object
# tools_for(step) -> list of langchain BaseTool (or []). None = no tools anywhere.
ToolsFor = Callable[[Step], List]

_EXEC_INSTRUCTION = ("Tu es un exécutant. Réalise l'étape demandée en utilisant "
                     "les outils disponibles si besoin, puis renvoie son résultat, "
                     "rien d'autre.")
_MAX_TOOL_STEPS = 6  # ponytail: cap the tool loop; raise if real plans need deeper


# --------------------------------------------------------------------------- #
# state <-> Step round-trip (state must hold JSON-safe dicts for the checkpoint)
# --------------------------------------------------------------------------- #
def _to_state_step(step: Step) -> dict:
    return step.model_dump(mode="json")


def _from_state_step(d: dict) -> Step:
    return Step(**d)


# --------------------------------------------------------------------------- #
# prompt assembly (unchanged from the topology build — facts only, no behavior)
# --------------------------------------------------------------------------- #
def _assignee_fact(step: Step) -> str:
    """FACTUAL context only (no behavior guidance — that lives in the agentstore
    prompt): who this step is assigned to. How to behave for a persona is the
    executor prompt's job, never hardcoded here."""
    if not step.is_persona or not step.assignee_name:
        return ""
    role = f" ({step.assignee_role})" if step.assignee_role else ""
    return f"[Étape assignée à : {step.assignee_name}{role}]\n\n"


def _context_for(step: Step, results: Dict[str, str]) -> str:
    """Render every upstream result provided (route passes the transitive-ancestor
    closure, not just direct deps — so a step deep in a chain still sees the ticket
    id / data an early step produced). `results` is already ordered by plan order."""
    blocks = [f"— « {d} » :\n{results[d]}" for d in results
              if (results.get(d) or "").strip()]
    if not blocks:
        return ""
    return ("Résultats des étapes précédentes dont dépend la tienne "
            "(sers-t'en, ne les refais pas) :\n\n" + "\n\n".join(blocks))


def _exec_human(step: Step, ctx: Dict[str, str]) -> str:
    ctxtext = _context_for(step, ctx)
    human = f"Étape : {step.title}\n{step.description}"
    return (ctxtext + "\n\n" + human) if ctxtext else human


def _await_human(step: Step, reply: str, ctx: Dict[str, str]) -> str:
    """Factual framing only: the reply + the task. How to handle it (respond /
    delegate / spawn / STEP_FAILED) is the agentstore executor prompt's job."""
    ctxtext = _context_for(step, ctx)
    return (ctxtext + "\n\n" if ctxtext else "") + (
        f"Réponse reçue pour cette étape :\n{reply}\n\n"
        f"Étape : {step.title}\n{step.description or ''}")


# --------------------------------------------------------------------------- #
# artifacts + spawn tools (kept; spawns now become plan edits, see _spawn_ops)
# --------------------------------------------------------------------------- #
async def _emit_artifacts(res, step_id, on_artifact) -> None:
    import json
    from ..adk.nodes import artifacts_from_tool_result
    payload = res
    if isinstance(res, str):
        try:
            payload = json.loads(res)
        except (ValueError, TypeError):
            return
    for art in artifacts_from_tool_result(payload):
        try:
            await on_artifact(step_id, art)
        except Exception:  # an artifact-projection failure must not fail the step
            pass


_SPAWN_TOOLS = ("create_task", "delegate_to_human_agent")


def _spawn_tools(caller_id: str) -> List:
    """Tools that let the executor spawn follow-up work. They RECORD a request the
    worker turns into a plan edit (a new step inserted before the caller's
    dependents) — they do NOT reshape the running graph."""
    from langchain_core.tools import StructuredTool

    def create_task(title: str, description: str, kind: str = "execute",
                    depends_on: str = "") -> str:
        """Spawn a follow-up step, run AFTER this one, ONLY for genuinely NEW work a
        result/reply revealed that the plan doesn't already cover. kind is
        'execute' or 'await_reply'."""
        return f"Noté : « {title} » s'exécutera comme une étape distincte."

    def delegate_to_human_agent(agent_name: str, task: str) -> str:
        """Ask another named human colleague to handle something (becomes its own
        step; their reply arrives there, not here). Use only when the work is
        genuinely that person's call."""
        return f"Noté : {agent_name} sera sollicité(e) dans une étape distincte."

    return [StructuredTool.from_function(func=create_task, name="create_task"),
            StructuredTool.from_function(func=delegate_to_human_agent,
                                         name="delegate_to_human_agent")]


class _AskSuspend(Exception):
    """Raised by the ask_user tool when the step needs a clarification the user
    hasn't answered yet. Propagates out of the tool loop so the worker suspends the
    step IN PLACE (no interrupt(), so sibling branches keep running); the step
    re-runs on the answer re-drive with ask_user now returning the answer."""
    def __init__(self, question: str):
        super().__init__(question)
        self.question = question


def _ask_user_tool(answer: Optional[str]) -> "object":
    """A step-scoped clarification tool. `answer` is the stored answer for THIS
    step (answers[step_id]): None on the first pass -> raise to suspend; present on
    the re-drive -> return it so the LLM continues. Distinct from
    create_task(kind='ask'), which plans a DOWNSTREAM ask for a later step."""
    from langchain_core.tools import StructuredTool

    def ask_user(question: str) -> str:
        """Ask the human user a clarifying question you NEED to finish THIS step
        (e.g. a missing recipient/value). Call it BEFORE any send or irreversible
        action. The step pauses; the user's answer comes back here and you continue."""
        if answer is None:
            raise _AskSuspend(question)
        return answer

    return StructuredTool.from_function(func=ask_user, name="ask_user")


async def _run_tool_calls(tool_map: dict, tool_calls: list, step_id=None,
                          on_artifact=None, spawns=None) -> List[ToolMessage]:
    out = []
    for tc in tool_calls:
        if spawns is not None and tc["name"] in _SPAWN_TOOLS:
            spawns.append({"tool": tc["name"], "caller_id": step_id, **dict(tc["args"])})
        t = tool_map.get(tc["name"])
        try:
            res = (await t.ainvoke(tc["args"])) if t is not None else f"unknown tool {tc['name']}"
        except _AskSuspend:                # not a tool error — bubble up to suspend
            raise
        except Exception as exc:  # a tool failure is data for the model, not a crash
            res = f"tool error: {exc}"
        if on_artifact is not None and step_id is not None:
            await _emit_artifacts(res, step_id, on_artifact)
        out.append(ToolMessage(content=str(res), tool_call_id=tc["id"]))
    return out


async def _run_llm(step: Step, model: ChatModel, tools: Optional[List],
                   instruction: Optional[str], on_artifact, human: str,
                   answer: Optional[str] = None):
    """Shared tool-calling loop: build the prompt (persona-aware + spawn/ask_user
    tools), run the model until it stops calling tools. Returns (text, spawns).
    May raise _AskSuspend (the LLM called ask_user with no answer yet) — the worker
    catches it and suspends the step."""
    tools = (tools or []) + _spawn_tools(step.id) + [_ask_user_tool(answer)]
    tool_map = {getattr(t, "name", None): t for t in tools}
    sys_instruction = instruction or _EXEC_INSTRUCTION  # agentstore prompt drives behavior
    human = _assignee_fact(step) + human                # factual only
    msgs = [SystemMessage(content=sys_instruction), HumanMessage(content=human)]
    bound = model.bind_tools(tools) if (tools and hasattr(model, "bind_tools")) else model
    text, spawns = "", []
    for _ in range(_MAX_TOOL_STEPS):
        resp = await bound.ainvoke(msgs)
        msgs.append(resp)
        tcs = getattr(resp, "tool_calls", None) or []
        if not tcs:
            text = resp.content if isinstance(resp.content, str) else str(resp.content)
            break
        msgs += await _run_tool_calls(tool_map, tcs, step.id, on_artifact, spawns)
    return text, spawns


# --------------------------------------------------------------------------- #
# spawn requests -> plan edits (insert + re-parent = "slot between the steps")
# --------------------------------------------------------------------------- #
def _spawn_to_step(sp: dict, caller_id: str, ordinal: int) -> dict:
    """One recorded spawn -> a new step dict, depending on its caller."""
    if sp.get("tool") == "delegate_to_human_agent":
        name = sp.get("agent_name") or "un collègue"
        step = Step(title=f"Demander à {name}", description=sp.get("task") or "",
                    kind="execute", is_persona=True, assignee_name=name,
                    is_dynamic_delegate=True, depends_on=[caller_id] if caller_id else [])
    else:
        step = Step(title=sp.get("title") or "Étape", description=sp.get("description") or "",
                    kind=sp.get("kind") or "execute",
                    depends_on=[caller_id] if caller_id else [])
    d = _to_state_step(step)
    d["ordinal"] = ordinal
    return d


def _spawn_ops(caller_id: str, spawns: list, dependents: List[dict], base_ordinal: int):
    """Turn recorded spawns into (new_steps, updated_dependents).

    Default is a BLOCKING insert: the new work is placed AFTER the caller and
    BEFORE the caller's dependents — i.e. each dependent is re-pointed FROM the
    caller TO the new step, so it waits for (and can see) the spawned result.
    The direct caller->dependent edge is dropped: the new step already depends
    on the caller, so the chain stays intact (mirrors insert_before) instead of
    leaving a redundant edge on the graph.
    That is the "put it between the steps" case (e.g. a manager validation must
    land before the ticket update). ponytail: blocking is the common need; add a
    `parallel`/`branch` flag on the tool if a non-blocking branch is ever wanted.
    """
    if not spawns:
        return [], []
    new_steps = [_spawn_to_step(sp, caller_id, base_ordinal + i)
                 for i, sp in enumerate(spawns)]
    new_ids = [s["id"] for s in new_steps]
    updated = []
    for dep in dependents:
        orig = list(dep.get("depends_on") or [])
        kept = [i for i in orig if i != caller_id]  # route the edge through the new step
        merged = kept + [i for i in new_ids if i not in kept]
        if merged != orig:
            d = dict(dep)
            d["depends_on"] = merged
            updated.append(d)
    return new_steps, updated


# --------------------------------------------------------------------------- #
# the worker (one @task handles any step)
# --------------------------------------------------------------------------- #
def make_worker_fn(model: ChatModel, project: Optional[ProjectFn],
                   tools_for: Optional[ToolsFor], instruction: Optional[str],
                   on_artifact, on_insert):
    """Run ONE step. Returns {step, result, new_steps, updated} — a plain dict the
    entrypoint loop folds into plan+results. Runs to completion (no interrupt), so
    once memoized by the checkpoint a resume/crash-restart never re-fires its
    sends/spawns; only an in-flight (never-completed) worker re-runs — same
    at-least-once as the ADK engine."""
    async def worker(payload: dict) -> dict:
        step = _from_state_step(payload["step"])
        d = payload["step"]
        ctx = payload.get("ctx", {})
        dependents = payload.get("dependents", [])
        base_ordinal = payload.get("next_ordinal", 1000)
        text_reply = ""

        # ---- ask: state-driven — the answer is already in state (the loop only
        # launches this step once answers[step.id] exists), so no LLM, no interrupt.
        # The user's typed answer IS the result. ----
        if step.kind == "ask":
            if project:
                await project(step.id, "running")
            answer = payload.get("answer")
            text = answer if isinstance(answer, str) else str(answer)
            if project:
                await project(step.id, "completed", result=text)
            return {"step": {**d, "status": "completed", "result": text},
                    "result": text, "new_steps": [], "updated": []}

        # ---- await_reply: state-driven — the reply is already in state (the loop
        # only launches this step once replies[step.id] exists). An LLM then acts on
        # the reply (may spawn). ----
        if step.kind == "await_reply":
            if project:
                await project(step.id, "running")
            reply = payload.get("reply")
            text_reply = reply if isinstance(reply, str) else str(reply)
            human = _await_human(step, text_reply, ctx)
        else:
            if project:
                await project(step.id, "running")
            human = _exec_human(step, ctx)

        tools = tools_for(step) if tools_for else None
        try:
            text, spawns = await _run_llm(step, model, tools, instruction,
                                          on_artifact, human, payload.get("answer"))
        except _AskSuspend as sus:
            # The step needs a clarification the user hasn't answered yet. Suspend
            # IN PLACE: no result, stay pending. The loop keeps driving siblings; the
            # runner surfaces the question; the answer re-drive re-runs this worker
            # with the answer, ask_user returns it, and the step finishes here.
            return {"suspended": True, "step_id": step.id, "question": sus.question}
        failed = text.lstrip().upper().startswith("STEP_FAILED")
        status = "failed" if failed else "completed"

        # An await step's REPLY is data the downstream depends on ("update the ticket
        # from Firas's return"); the LLM text is only its handling note. Persist the
        # reply too (unless the note already contains it) so downstream sees the
        # answer, not just "delegated to X". Data only — no behavior guidance here.
        stored = text
        if step.kind == "await_reply" and text_reply and text_reply not in text:
            stored = (f"{text}\n\n— Réponse reçue —\n{text_reply}"
                      if text.strip() else text_reply)
        if project:
            await project(step.id, status, result=stored)

        new_steps, updated = _spawn_ops(step.id, spawns, dependents, base_ordinal)
        if (new_steps or updated) and on_insert:
            # Upsert BEFORE the loop runs/updates them — set_step_status is
            # UPDATE-only, so a spawned step must have its row first.
            await on_insert(new_steps + updated)
        return {"step": {**d, "status": status, "result": stored},
                "result": stored, "new_steps": new_steps, "updated": updated}

    return worker


def _ready(plan: List[dict], results: Dict[str, str], replies: Dict[str, str],
           answers: Dict[str, str]) -> List[dict]:
    """Steps whose deps are all done and whose state-driven wait (if any) is
    satisfied. An await_reply is ready only once its reply is in state; an ask only
    once its answer is. Until then a step is simply not launched — the entrypoint
    returns cleanly and the runner parks it, so parallel branches never block."""
    out = []
    for s in plan:
        if s.get("status", "pending") != "pending":
            continue
        if not all(dep in results for dep in (s.get("depends_on") or [])):
            continue
        kind = s.get("kind")
        if kind == "await_reply" and s["id"] not in replies:
            continue
        if kind == "ask" and s["id"] not in answers:
            continue
        out.append(s)
    return out


def _ctx_for(plan: List[dict], results: Dict[str, str], sid: str) -> Dict[str, str]:
    """Transitive-ancestor closure of `sid`, in plan order — so a step late in a
    chain still sees data an early step produced (e.g. a ticket id). ponytail: full
    closure is fine for worky's small chains; cap/window it if a plan gets huge."""
    dep_map = {x["id"]: (x.get("depends_on") or []) for x in plan}
    seen, stack = set(), list(dep_map.get(sid, []))
    while stack:
        a = stack.pop()
        if a in seen:
            continue
        seen.add(a)
        stack += dep_map.get(a, [])
    return {x["id"]: results[x["id"]] for x in plan
            if x["id"] in seen and x["id"] in results}


def build_executor(model: ChatModel, project: Optional[ProjectFn] = None,
                   tools_for: Optional[ToolsFor] = None,
                   instruction: Optional[str] = None,
                   on_artifact=None, on_insert=None, *, checkpointer):
    """Compile the plan-independent executor entrypoint (one per turn/resume; the
    plan+results+replies+answers live in the checkpoint via `previous`). Input
    merges into that state, so run seeds `plan`, deliver_reply adds a `reply`,
    resume adds an `answer`, converse merges new `plan` steps, continue passes
    None. Returns the compiled entrypoint (call .ainvoke/.aget_state on it)."""
    worker_fn = make_worker_fn(model, project, tools_for, instruction,
                               on_artifact, on_insert)
    worker_task = task(worker_fn, name="worky_worker")

    @entrypoint(checkpointer=checkpointer)
    async def run_plan(inp, *, previous=None) -> dict:
        prev = previous or {}
        inp = inp or {}
        plan = merge_plan(prev.get("plan"), inp.get("plan"))
        results = merge_results(prev.get("results"), inp.get("results"))
        replies = merge_results(prev.get("replies"), inp.get("replies"))
        answers = merge_results(prev.get("answers"), inp.get("answers"))

        # DURABLE parked-on-ask_user set (step_id -> question), carried across drives
        # in the checkpoint. A parked ask is NOT re-run until ITS answer arrives —
        # exactly like await_reply waits on its reply. This is what stops answering
        # one ask from re-running (and flickering/diverging) every OTHER parked ask.
        asked: dict = dict(prev.get("asked") or {})
        inflight: dict = {}   # step_id -> asyncio.Task wrapping the @task future

        async def _await(fut):
            return await fut

        while True:
            for s in _ready(plan, results, replies, answers):
                sid = s["id"]
                if sid in inflight or sid in results:
                    continue
                if sid in asked and sid not in answers:
                    continue   # parked on ask_user; wait for its own answer to re-run
                max_ord = max((x.get("ordinal", 0) for x in plan), default=0)
                payload = {"step": s, "ctx": _ctx_for(plan, results, sid),
                           "dependents": [dict(x) for x in plan
                                          if sid in (x.get("depends_on") or [])],
                           "next_ordinal": max_ord + 1,
                           "reply": replies.get(sid), "answer": answers.get(sid)}
                # wrap the langgraph future so asyncio.wait accepts it (task futures
                # aren't asyncio.Futures)
                t = asyncio.ensure_future(_await(worker_task(payload)))
                t._sid = sid  # type: ignore[attr-defined]
                inflight[sid] = t
            if not inflight:
                break
            done, _pending = await asyncio.wait(
                inflight.values(), return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                sid = t._sid  # type: ignore[attr-defined]
                res = await t
                del inflight[sid]
                if res.get("suspended"):     # ask_user, no answer yet -> park durably
                    asked[sid] = res["question"]
                    continue
                results[sid] = res["result"]
                asked.pop(sid, None)         # answered+done -> clear the parked marker
                plan = merge_plan(plan, [res["step"], *res["new_steps"], *res["updated"]])

        return {"plan": plan, "results": results, "replies": replies,
                "answers": answers, "asked": asked}

    return run_plan
