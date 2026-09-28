"""Generate the checkpoint fixture with the pre-migration dependency stack."""

import asyncio
import operator
import sys
from pathlib import Path
from typing import Annotated

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from typing_extensions import TypedDict


class FixtureState(TypedDict):
    task_outputs: Annotated[dict[tuple[str, int], str], operator.or_]
    events: Annotated[list[str], operator.add]


async def seed(_: FixtureState) -> dict:
    return {"task_outputs": {("seed", 0): "complete"}, "events": ["seed"]}


async def approval(_: FixtureState) -> dict:
    decision = interrupt({"node_id": "approval", "iteration": 0, "prompt": "Approve?"})
    return {"task_outputs": {("approval", 0): decision}, "events": ["approval"]}


async def finish(_: FixtureState) -> dict:
    return {"task_outputs": {("finish", 0): "complete"}, "events": ["finish"]}


def build_graph(saver):
    graph = StateGraph(FixtureState)
    graph.add_node("seed", seed)
    graph.add_node("approval", approval)
    graph.add_node("finish", finish)
    graph.add_edge(START, "seed")
    graph.add_edge("seed", "approval")
    graph.add_edge("approval", "finish")
    graph.add_edge("finish", END)

    return graph.compile(checkpointer=saver)


async def generate(output_path: str) -> None:
    output = Path(output_path)
    output.unlink(missing_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(output)) as saver:
        compiled = build_graph(saver)
        config = {"configurable": {"thread_id": "langgraph-1.0.1-fixture"}}
        result = await compiled.ainvoke({"task_outputs": {}, "events": []}, config)
        assert "__interrupt__" in result


async def resume(output_path: str) -> None:
    async with AsyncSqliteSaver.from_conn_string(output_path) as saver:
        compiled = build_graph(saver)
        config = {"configurable": {"thread_id": "langgraph-1.0.1-fixture"}}
        result = await compiled.ainvoke(Command(resume={"decision": "approved"}), config)
        assert result["events"] == ["seed", "approval", "finish"]


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in {"generate", "resume"}:
        raise SystemExit(
            "usage: generate_langgraph_1_0_1_checkpoint.py generate|resume OUTPUT_PATH"
        )
    asyncio.run(generate(sys.argv[2]) if sys.argv[1] == "generate" else resume(sys.argv[2]))
