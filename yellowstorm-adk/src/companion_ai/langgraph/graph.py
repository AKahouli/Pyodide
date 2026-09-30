"""Plan -> a fixed executor LOOP (not a per-plan topology).

The plan lives in state as an ordered list of step dicts; `tick` looks at which
steps are READY (deps' results present) and fans them out to parallel `worker`
invocations via Send; each worker runs one step and writes its result back; the
loop repeats until nothing is ready. Because readiness is recomputed every tick,
a worker can insert new work at runtime (a delegate/create_task) simply by adding
a step to the plan and re-pointing the caller's dependents onto it — no graph
reshape, which is what the old `depends_on`->edges build could not do (a node
added after its parent finished never ran, and a spawn could only be a late
sibling). Send fan-out gives real parallelism; multiple await workers can park
multiple interrupts in one super-step (proven: no double post-interrupt run).

Step kind routes inside the worker: ask -> pure interrupt (answer IS the result);
await_reply -> interrupt then an LLM acts on the reply (can spawn); else an LLM
execute step.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send, interrupt

from ..plan import Step
from .graph_types import OrchState, ProjectFn

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


async def _run_tool_calls(tool_map: dict, tool_calls: list, step_id=None,
                          on_artifact=None, spawns=None) -> List[ToolMessage]:
    out = []
    for tc in tool_calls:
        if spawns is not None and tc["name"] in _SPAWN_TOOLS:
            spawns.append({"tool": tc["name"], "caller_id": step_id, **dict(tc["args"])})
        t = tool_map.get(tc["name"])
        try:
            res = (await t.ainvoke(tc["args"])) if t is not None else f"unknown tool {tc['name']}"
        except Exception as exc:  # a tool failure is data for the model, not a crash
            res = f"tool error: {exc}"
        if on_artifact is not None and step_id is not None:
            await _emit_artifacts(res, step_id, on_artifact)
        out.append(ToolMessage(content=str(res), tool_call_id=tc["id"]))
    return out


async def _run_llm(step: Step, model: ChatModel, tools: Optional[List],
                   instruction: Optional[str], on_artifact, human: str):
    """Shared tool-calling loop: build the prompt (persona-aware + spawn tools),
    run the model until it stops calling tools. Returns (text, spawns)."""
    tools = (tools or []) + _spawn_tools(step.id)
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
# the worker (one node handles any step) + the loop
# --------------------------------------------------------------------------- #
def make_worker(model: ChatModel, project: Optional[ProjectFn],
                tools_for: Optional[ToolsFor], instruction: Optional[str],
                on_artifact, on_insert):
    """Run ONE step (from the Send payload). Never has side effects before an
    interrupt(), so a re-run on resume (LangGraph re-runs pre-interrupt code each
    drive) fires sends/spawns exactly once — verified in the spike."""
    async def worker(payload: dict) -> dict:
        step = _from_state_step(payload["step"])
        d = payload["step"]
        ctx = payload.get("ctx", {})
        dependents = payload.get("dependents", [])
        base_ordinal = payload.get("next_ordinal", 1000)
        text_reply = ""

        # ---- ask: the user's typed answer IS the result (no LLM) ----
        if step.kind == "ask":
            answer = interrupt({"kind": "ask", "step_id": step.id,
                                "question": step.question or step.title})
            if project:
                await project(step.id, "running")
            text = answer if isinstance(answer, str) else str(answer)
            if project:
                await project(step.id, "completed", result=text)
            return {"results": {step.id: text},
                    "plan": [{**d, "status": "completed", "result": text}]}

        # ---- await_reply: state-driven — the reply is already in state (route only
        # dispatches this step once replies[step.id] exists), so no interrupt(). An
        # LLM then acts on the reply (may spawn). ----
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
        text, spawns = await _run_llm(step, model, tools, instruction, on_artifact, human)
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
        plan_ops = [{**d, "status": status, "result": stored}, *new_steps, *updated]
        return {"results": {step.id: stored}, "plan": plan_ops}

    return worker


def _ready(plan: List[dict], results: Dict[str, str],
           replies: Dict[str, str]) -> List[dict]:
    out = []
    for s in plan:
        if s.get("status", "pending") != "pending":
            continue
        if not all(dep in results for dep in (s.get("depends_on") or [])):
            continue
        # State-driven wait: an await_reply step is ready only once its reply is in
        # state. Until then it is simply "not ready" — no interrupt(), so the drive
        # ends cleanly and other branches keep going independently.
        if s.get("kind") == "await_reply" and s["id"] not in replies:
            continue
        out.append(s)
    return out


def build_graph(model: ChatModel, project: Optional[ProjectFn] = None,
                tools_for: Optional[ToolsFor] = None,
                instruction: Optional[str] = None,
                on_artifact=None, on_insert=None) -> StateGraph:
    """The plan-independent executor loop. Same graph for every plan; the plan is
    state. START -> tick -(Send per ready step)-> worker -> tick -> ... -> END."""
    worker = make_worker(model, project, tools_for, instruction, on_artifact, on_insert)

    async def tick(state: OrchState) -> dict:
        return {}  # no-op; the conditional edge does the fan-out

    def route(state: OrchState):
        plan = state["plan"]
        results = state.get("results", {})
        replies = state.get("replies", {})
        ready = _ready(plan, results, replies)
        if not ready:
            return END
        dep_map = {x["id"]: (x.get("depends_on") or []) for x in plan}

        def ancestors(sid: str) -> set:
            seen, stack = set(), list(dep_map.get(sid, []))
            while stack:
                a = stack.pop()
                if a in seen:
                    continue
                seen.add(a)
                stack += dep_map.get(a, [])
            return seen

        max_ord = max((s.get("ordinal", 0) for s in plan), default=0)
        sends = []
        for s in ready:
            # Transitive ancestors (not just direct deps), in plan order, so a step
            # late in a chain still sees data an early step produced (e.g. the ticket
            # id). ponytail: full closure is fine for worky's small chains; cap/window
            # it if a plan ever gets huge.
            anc = ancestors(s["id"])
            ctx = {x["id"]: results[x["id"]] for x in plan
                   if x["id"] in anc and x["id"] in results}
            dependents = [dict(x) for x in plan if s["id"] in (x.get("depends_on") or [])]
            sends.append(Send("worker", {"step": s, "ctx": ctx,
                                         "dependents": dependents,
                                         "next_ordinal": max_ord + 1,
                                         "reply": replies.get(s["id"])}))
        return sends

    g = StateGraph(OrchState)
    g.add_node("tick", tick)
    g.add_node("worker", worker)
    g.add_edge(START, "tick")
    g.add_conditional_edges("tick", route, ["worker", END])
    g.add_edge("worker", "tick")
    return g
