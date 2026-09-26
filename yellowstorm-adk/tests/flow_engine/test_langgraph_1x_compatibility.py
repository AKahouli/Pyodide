"""Behavioral compatibility gates for the LangGraph 1.2 migration."""

from __future__ import annotations

import operator
import shutil
from pathlib import Path
from typing import Annotated, Any

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from typing_extensions import TypedDict

from src.flow_engine.runtime.invoker import stream_graph


class RuntimeState(TypedDict):
    task_outputs: Annotated[dict[tuple[str, int], Any], operator.or_]
    events: Annotated[list[str], operator.add]


async def _seed(_: RuntimeState) -> dict[str, Any]:
    get_stream_writer()({"type": "NodeStarted", "node_id": "seed"})
    return {"task_outputs": {("seed", 0): "complete"}, "events": ["seed"]}


async def _branch_a(_: RuntimeState) -> dict[str, Any]:
    return {"task_outputs": {("a", 0): "A"}, "events": ["a"]}


async def _branch_b(_: RuntimeState) -> dict[str, Any]:
    return {"task_outputs": {("b", 0): "B"}, "events": ["b"]}


async def _join(state: RuntimeState) -> dict[str, Any]:
    assert state["task_outputs"][("a", 0)] == "A"
    assert state["task_outputs"][("b", 0)] == "B"
    return {"task_outputs": {("join", 0): "complete"}, "events": ["join"]}


def _parallel_graph(*, checkpointer=None):
    graph = StateGraph(RuntimeState)
    graph.add_node("seed", _seed)
    graph.add_node("a", _branch_a)
    graph.add_node("b", _branch_b)
    graph.add_node("join", _join)
    graph.add_edge(START, "seed")
    graph.add_edge("seed", "a")
    graph.add_edge("seed", "b")
    graph.add_edge("a", "join")
    graph.add_edge("b", "join")
    graph.add_edge("join", END)
    return graph.compile(checkpointer=checkpointer)


@pytest.mark.asyncio
async def test_parallel_reducers_and_stream_envelope_remain_compatible():
    chunks = [
        chunk
        async for chunk in stream_graph(
            _parallel_graph(),
            {"task_outputs": {}, "events": []},
            max_parallelism=2,
        )
    ]

    assert {chunk["_mode"] for chunk in chunks} == {"custom", "updates"}
    custom = [chunk["_data"] for chunk in chunks if chunk["_mode"] == "custom"]
    assert custom == [{"type": "NodeStarted", "node_id": "seed"}]
    updates = [chunk["_data"] for chunk in chunks if chunk["_mode"] == "updates"]
    updated_nodes = {node_id for update in updates for node_id in update}
    assert {"seed", "a", "b", "join"} <= updated_nodes
    assert updates[-1]["join"]["task_outputs"] == {("join", 0): "complete"}


@pytest.mark.asyncio
async def test_tuple_keys_survive_sqlite_checkpoint_round_trip(tmp_path):
    db_path = tmp_path / "tuple-keys.db"
    config = {"configurable": {"thread_id": "tuple-keys"}}

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        graph = _parallel_graph(checkpointer=saver)
        await graph.ainvoke({"task_outputs": {}, "events": []}, config)

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        graph = _parallel_graph(checkpointer=saver)
        state = await graph.aget_state(config)

    assert state.values["task_outputs"] == {
        ("seed", 0): "complete",
        ("a", 0): "A",
        ("b", 0): "B",
        ("join", 0): "complete",
    }


@pytest.mark.asyncio
async def test_dynamic_and_interrupt_after_suspensions_remain_distinct(tmp_path):
    entries: list[str] = []

    async def approval(_: RuntimeState) -> dict[str, Any]:
        entries.append("approval")
        decision = interrupt({"node_id": "approval", "prompt": "Approve?"})
        return {"task_outputs": {("approval", 0): decision}, "events": ["approval"]}

    async def downstream(_: RuntimeState) -> dict[str, Any]:
        entries.append("downstream")
        return {"task_outputs": {("downstream", 0): "complete"}, "events": ["downstream"]}

    graph_builder = StateGraph(RuntimeState)
    graph_builder.add_node("approval", approval)
    graph_builder.add_node("downstream", downstream)
    graph_builder.add_edge(START, "approval")
    graph_builder.add_edge("approval", "downstream")
    graph_builder.add_edge("downstream", END)
    config = {"configurable": {"thread_id": "double-suspension"}}

    async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "interrupt.db")) as saver:
        graph = graph_builder.compile(checkpointer=saver, interrupt_after=["approval"])
        first = await graph.ainvoke({"task_outputs": {}, "events": []}, config)
        assert len(first["__interrupt__"]) == 1
        assert (await graph.aget_state(config)).next == ("approval",)

        second = await graph.ainvoke(Command(resume={"decision": "approved"}), config)
        assert "__interrupt__" not in second
        assert (await graph.aget_state(config)).next == ("downstream",)

        final = await graph.ainvoke(None, config)

    assert final["task_outputs"][("downstream", 0)] == "complete"
    assert entries == ["approval", "approval", "downstream"]


@pytest.mark.asyncio
async def test_langgraph_1_0_1_interrupted_checkpoint_resumes(tmp_path):
    fixture = Path(__file__).parent / "fixtures" / "langgraph_1_0_1_checkpoints.db"
    assert fixture.exists(), "Regenerate the fixture with its documented generator"
    db_path = tmp_path / fixture.name
    shutil.copyfile(fixture, db_path)
    config = {"configurable": {"thread_id": "langgraph-1.0.1-fixture"}}

    graph_builder = StateGraph(RuntimeState)
    graph_builder.add_node("seed", _seed)

    async def approval(_: RuntimeState) -> dict[str, Any]:
        decision = interrupt({"node_id": "approval", "iteration": 0, "prompt": "Approve?"})
        return {"task_outputs": {("approval", 0): decision}, "events": ["approval"]}

    async def finish(_: RuntimeState) -> dict[str, Any]:
        return {"task_outputs": {("finish", 0): "complete"}, "events": ["finish"]}

    graph_builder.add_node("approval", approval)
    graph_builder.add_node("finish", finish)
    graph_builder.add_edge(START, "seed")
    graph_builder.add_edge("seed", "approval")
    graph_builder.add_edge("approval", "finish")
    graph_builder.add_edge("finish", END)

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        graph = graph_builder.compile(checkpointer=saver)
        suspended = await graph.aget_state(config)
        checkpoint_tuple = await saver.aget_tuple(suspended.config)
        assert suspended.values["task_outputs"] == {("seed", 0): "complete"}
        assert suspended.next == ("approval",)
        assert checkpoint_tuple is not None
        assert checkpoint_tuple.pending_writes

        final = await graph.ainvoke(Command(resume={"decision": "approved"}), config)

    assert final["events"] == ["seed", "approval", "finish"]
    assert final["task_outputs"][("finish", 0)] == "complete"
