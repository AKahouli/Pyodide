"""PostgreSQL checkpointer configuration and persistence tests."""

from __future__ import annotations

import operator
import os
import uuid
import asyncio
from pathlib import Path
from typing import Annotated

import pytest
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from psycopg import AsyncConnection, sql
from typing_extensions import TypedDict

from scripts.migrate_sqlite_checkpoints_to_postgres import migrate
from src.flow_engine.runtime.checkpointer import (
    close_checkpointer,
    init_checkpointer,
    normalize_postgres_connection_string,
    validate_checkpoint_schema,
)
from src.flow_engine.runtime.checkpoint_fork import (
    CheckpointForkService,
    ForkResult,
    ReplayForkConflictError,
    ReplayTarget,
    find_replay_checkpoint,
)
from tests.flow_engine.fixtures.generate_langgraph_1_0_1_checkpoint import (
    build_graph as build_fixture_graph,
)


def test_normalize_postgres_connection_string():
    assert (
        normalize_postgres_connection_string(
            "postgresql+asyncpg://user:p%40ss@db.example/app?sslmode=require"
        )
        == "postgresql://user:p%40ss@db.example/app?sslmode=require"
    )
    assert (
        normalize_postgres_connection_string("postgresql://user@db/app")
        == "postgresql://user@db/app"
    )


@pytest.mark.parametrize(
    "value",
    ["Public", "schema-name", "schema.name", "1schema", "a" * 64, "schema;drop"],
)
def test_validate_checkpoint_schema_rejects_unsafe_identifiers(value):
    with pytest.raises(ValueError, match="lowercase PostgreSQL identifier"):
        validate_checkpoint_schema(value)


def test_normalize_rejects_non_postgres_urls():
    with pytest.raises(ValueError, match="require a PostgreSQL"):
        normalize_postgres_connection_string("sqlite:///checkpoints.db")


class ApprovalState(TypedDict):
    events: Annotated[list[str], operator.add]


class ReplayState(TypedDict):
    execution_id: str
    events: Annotated[list[str], operator.add]
    iterations: dict[str, int]


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("POSTGRES_CHECKPOINT_TEST_URL"),
    reason="requires an explicitly enabled PostgreSQL integration database",
)
async def test_postgres_checkpoint_survives_pool_restart():
    connection_string = os.environ["POSTGRES_CHECKPOINT_TEST_URL"]
    conninfo = normalize_postgres_connection_string(connection_string)
    schema = f"langgraph_test_{uuid.uuid4().hex}"
    thread_id = f"postgres-checkpoint-{uuid.uuid4()}"
    config = {"configurable": {"thread_id": thread_id}}

    async def approval(_: ApprovalState):
        decision = interrupt({"prompt": "Approve?"})
        return {"events": [decision["decision"]]}

    async def finish(_: ApprovalState):
        return {"events": ["finish"]}

    builder = StateGraph(ApprovalState)
    builder.add_node("approval", approval)
    builder.add_node("finish", finish)
    builder.add_edge(START, "approval")
    builder.add_edge("approval", "finish")
    builder.add_edge("finish", END)

    try:
        saver = await init_checkpointer(
            connection_string,
            schema=schema,
            pool_min_size=1,
            pool_max_size=2,
        )
        graph = builder.compile(checkpointer=saver)
        suspended = await graph.ainvoke({"events": []}, config)
        assert len(suspended["__interrupt__"]) == 1
        await close_checkpointer()

        saver = await init_checkpointer(
            connection_string,
            schema=schema,
            pool_min_size=1,
            pool_max_size=2,
        )
        graph = builder.compile(checkpointer=saver)
        final = await graph.ainvoke(
            Command(resume={"decision": "approved"}), config
        )
        assert final["events"] == ["approved", "finish"]
        assert (await graph.aget_state(config)).next == ()

        async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
            rows = await (
                await conn.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = %s ORDER BY table_name",
                    (schema,),
                )
            ).fetchall()
        assert {row[0] for row in rows} == {
            "checkpoint_blobs",
            "checkpoint_migrations",
            "checkpoint_writes",
            "checkpoints",
        }
    finally:
        await close_checkpointer()
        async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
            await conn.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                    sql.Identifier(schema)
                )
            )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("POSTGRES_CHECKPOINT_TEST_URL"),
    reason="requires an explicitly enabled PostgreSQL integration database",
)
async def test_sqlite_checkpoint_fixture_migrates_to_postgres():
    connection_string = os.environ["POSTGRES_CHECKPOINT_TEST_URL"]
    conninfo = normalize_postgres_connection_string(connection_string)
    schema = f"langgraph_test_{uuid.uuid4().hex}"
    fixture = (
        Path(__file__).parent / "fixtures" / "langgraph_1_0_1_checkpoints.db"
    )

    try:
        checkpoint_count, write_count = await migrate(
            fixture,
            schema,
            connection_string,
        )
        assert checkpoint_count > 0
        assert write_count > 0

        async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
            row = await (
                await conn.execute(
                    sql.SQL(
                        "SELECT "
                        "(SELECT COUNT(*) FROM {}.checkpoints), "
                        "(SELECT COUNT(*) FROM {}.checkpoint_writes)"
                    ).format(sql.Identifier(schema), sql.Identifier(schema))
                )
            ).fetchone()
        first_counts = tuple(row)
        assert first_counts == (checkpoint_count, write_count)

        repeated_checkpoint_count, repeated_write_count = await migrate(
            fixture,
            schema,
            connection_string,
        )
        assert (repeated_checkpoint_count, repeated_write_count) == (
            checkpoint_count,
            write_count,
        )
        async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
            row = await (
                await conn.execute(
                    sql.SQL(
                        "SELECT "
                        "(SELECT COUNT(*) FROM {}.checkpoints), "
                        "(SELECT COUNT(*) FROM {}.checkpoint_writes)"
                    ).format(sql.Identifier(schema), sql.Identifier(schema))
                )
            ).fetchone()
        assert tuple(row) == first_counts

        saver = await init_checkpointer(connection_string, schema=schema)
        graph = build_fixture_graph(saver)
        final = await graph.ainvoke(
            Command(resume={"decision": "approved"}),
            {"configurable": {"thread_id": "langgraph-1.0.1-fixture"}},
        )
        assert final["events"] == ["seed", "approval", "finish"]
    finally:
        await close_checkpointer()
        async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
            await conn.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                    sql.Identifier(schema)
                )
            )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("POSTGRES_CHECKPOINT_TEST_URL"),
    reason="requires an explicitly enabled PostgreSQL integration database",
)
async def test_exact_checkpoint_fork_preserves_source_writes_and_is_retry_safe():
    connection_string = os.environ["POSTGRES_CHECKPOINT_TEST_URL"]
    conninfo = normalize_postgres_connection_string(connection_string)
    schema = f"langgraph_test_{uuid.uuid4().hex}"
    source_thread = f"replay-source-{uuid.uuid4()}"
    target_thread = f"replay-target-{uuid.uuid4()}"
    concurrent_target_thread = f"replay-concurrent-{uuid.uuid4()}"
    failed_target_thread = f"replay-failed-{uuid.uuid4()}"

    async def first(_: ReplayState):
        return {"events": ["first"], "iterations": {"first": 1}}

    async def target(_: ReplayState):
        return {"events": ["target"], "iterations": {"target": 1}}

    builder = StateGraph(ReplayState)
    builder.add_node("first", first)
    builder.add_node("target", target)
    builder.add_edge(START, "first")
    builder.add_edge("first", "target")
    builder.add_edge("target", END)

    try:
        saver = await init_checkpointer(
            connection_string,
            schema=schema,
            pool_min_size=1,
            pool_max_size=2,
        )
        graph = builder.compile(checkpointer=saver)
        source_config = {"configurable": {"thread_id": source_thread}}
        source_final = await graph.ainvoke(
            {"execution_id": source_thread, "events": [], "iterations": {}},
            source_config,
        )
        assert source_final["events"] == ["first", "target"]

        replay_target = ReplayTarget(
            source_execution_id=source_thread,
            target_execution_id=target_thread,
            target_node_id="target",
            target_iteration=0,
        )
        service = CheckpointForkService()
        replay_state = await find_replay_checkpoint(graph, replay_target)
        assert replay_state.values["events"] == ["first"]
        await saver.aput_writes(
            replay_state.config,
            [("yellowstorm_test_pending", {"value": "preserved"})],
            "yellowstorm-test-task",
        )
        source_history_before = [
            item.config async for item in saver.alist(source_config)
        ]
        source_tuple = await saver.aget_tuple(replay_state.config)
        assert source_tuple is not None

        forked = await service.fork(graph, saver, replay_target)
        target_tuple = await saver.aget_tuple(forked.config)
        assert target_tuple is not None
        assert target_tuple.pending_writes == source_tuple.pending_writes
        assert target_tuple.metadata["fork_mode"] == "yellowstorm_exact_replay"
        assert target_tuple.metadata["source_execution_id"] == source_thread
        assert target_tuple.metadata["target_execution_id"] == target_thread

        repeated = await service.fork(graph, saver, replay_target)
        assert repeated.reused is True
        assert repeated.config == forked.config

        normalized_config = await graph.aupdate_state(
            forked.config,
            {"execution_id": target_thread},
        )
        normalized_state = await graph.aget_state(normalized_config)
        assert normalized_state.values["execution_id"] == target_thread
        assert "first" in normalized_state.values["events"]
        continued = await graph.ainvoke(None, normalized_config)
        assert continued["execution_id"] == target_thread
        assert continued["events"] == ["first", "target"]
        with pytest.raises(ReplayForkConflictError, match="already has different lineage"):
            await service.fork(graph, saver, replay_target)

        concurrent_target = ReplayTarget(
            source_execution_id=source_thread,
            target_execution_id=concurrent_target_thread,
            target_node_id="target",
            target_iteration=0,
        )
        concurrent_results = await asyncio.gather(
            CheckpointForkService().prepare(
                graph,
                saver,
                concurrent_target,
                {"execution_id": concurrent_target_thread},
            ),
            CheckpointForkService().prepare(
                graph,
                saver,
                concurrent_target,
                {"execution_id": concurrent_target_thread},
            ),
            return_exceptions=True,
        )
        assert sum(isinstance(result, ForkResult) for result in concurrent_results) == 1
        assert sum(
            isinstance(result, ReplayForkConflictError)
            for result in concurrent_results
        ) == 1
        concurrent_history = [
            item async for item in saver.alist(
                {"configurable": {"thread_id": concurrent_target_thread}}
            )
        ]
        assert len(concurrent_history) == 2

        source_history_after = [
            item.config async for item in saver.alist(source_config)
        ]
        assert source_history_after == source_history_before

        class FailingWritesSaver:
            def __getattr__(self, name):
                return getattr(saver, name)

            async def aput_writes(self, *args, **kwargs):
                raise RuntimeError("injected pending-write failure")

        failing_target = ReplayTarget(
            source_execution_id=source_thread,
            target_execution_id=failed_target_thread,
            target_node_id="target",
            target_iteration=0,
        )
        with pytest.raises(RuntimeError, match="injected pending-write failure"):
            await service.fork(graph, FailingWritesSaver(), failing_target)
        assert await saver.aget_tuple(
            {"configurable": {"thread_id": failed_target_thread}}
        ) is None
        assert await saver.aget_tuple(replay_state.config) is not None
    finally:
        await close_checkpointer()
        async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
            await conn.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                    sql.Identifier(schema)
                )
            )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("POSTGRES_CHECKPOINT_TEST_URL"),
    reason="requires an explicitly enabled PostgreSQL integration database",
)
async def test_human_approval_resumes_after_servicer_restart_without_duplicate_request(
    monkeypatch,
):
    from src.flow_engine import builder as builder_module
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
    from src.grpc_generated import playbook_flow_pb2 as pb

    connection_string = os.environ["POSTGRES_CHECKPOINT_TEST_URL"]
    conninfo = normalize_postgres_connection_string(connection_string)
    schema = f"langgraph_test_{uuid.uuid4().hex}"
    execution_id = f"approval-restart-{uuid.uuid4()}"
    calls: list[str] = []

    async def fake_step(node_id, node_config, state, node_inputs=None):
        del node_config, node_inputs
        iteration = state["iterations"].get(node_id, 0)
        calls.append(node_id)
        return {
            "task_outputs": {(node_id, iteration): {"output": node_id}},
            "iterations": {node_id: iteration + 1},
        }

    monkeypatch.setitem(builder_module.NODE_KIND_DISPATCH, "step", fake_step)

    def request(*, resume: bool = False):
        value = pb.RunRequest(execution_id=execution_id, flow_id="approval-restart-flow")
        value.snapshot.nodes.add(id="before", kind="step", label="Before")
        approval = value.snapshot.nodes.add(id="approval", kind="human_approval", label="Approve")
        approval.human_approval_config.prompt_template = "Approve?"
        value.snapshot.nodes.add(id="after", kind="step", label="After")
        value.snapshot.control_edges.add(id="before-approval", kind="sequential", source="before", target="approval")
        value.snapshot.control_edges.add(id="approval-after", kind="sequential", source="approval", target="after")
        if resume:
            value.input_context.update({
                "__playbook_resume": {"decision": "approved", "payload": {}},
            })
        return value

    try:
        await init_checkpointer(connection_string, schema=schema, pool_min_size=1, pool_max_size=2)
        first_servicer = PlaybookFlowRuntimeServicer()
        first_stream = first_servicer.Run(request(), None)
        before_restart: list[str] = []
        async for event in first_stream:
            before_restart.append(event.event_type)
            if event.event_type == "ApprovalRequested":
                break
        checkpoint_progress = asyncio.create_task(anext(first_stream))
        await asyncio.sleep(0.2)
        checkpoint_progress.cancel()
        with pytest.raises((asyncio.CancelledError, StopAsyncIteration)):
            await checkpoint_progress
        await first_stream.aclose()
        assert before_restart.count("ApprovalRequested") == 1
        assert calls == ["before"]

        await close_checkpointer()
        await init_checkpointer(connection_string, schema=schema, pool_min_size=1, pool_max_size=2)
        restarted_servicer = PlaybookFlowRuntimeServicer()
        after_restart = [
            event.event_type async for event in restarted_servicer.Run(request(resume=True), None)
        ]

        assert "ApprovalRequested" not in after_restart
        assert after_restart.count("ApprovalResolved") == 1
        assert after_restart[-1] == "ExecutionCompleted"
        assert calls == ["before", "after"]
    finally:
        await close_checkpointer()
        async with await AsyncConnection.connect(conninfo, autocommit=True) as conn:
            await conn.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                    sql.Identifier(schema)
                )
            )
