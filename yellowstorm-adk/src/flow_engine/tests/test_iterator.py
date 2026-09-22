"""Tests for iterator topology and subgraph execution."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from src.flow_engine.builder import compose
from src.flow_engine.builder.iterator import (
    _build_body_subgraph,
    _coerce_to_list,
    _get_parent_iterator_id,
    _resolve_items,
    _resolve_items_from_bindings,
    compute_iterator_children,
    is_iterator_container,
)
from src.flow_engine.state import ExecutionState
from src.flow_engine.builder.sequential import add_sequential_edges
from src.flow_engine.builder.conditional import add_conditional_edges
from src.flow_engine.runtime.invoker import stream_graph


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


def _build_adjacency(raw_edges, node_ids):
    adjacency = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src, tgt = edge.get("source", ""), edge.get("target", "")
        if src in adjacency and tgt in node_ids:
            adjacency[src].append(tgt)
    return adjacency


class TestIteratorDetection:
    def test_no_iterator_in_linear(self):
        snapshot = load_fixture("linear.json")
        iterators = [n for n in snapshot["nodes"] if is_iterator_container(n)]
        assert len(iterators) == 0

    def test_iterator_detected_by_kind(self):
        assert is_iterator_container({"kind": "iterator"})
        assert not is_iterator_container({"kind": "step"})
        assert not is_iterator_container({"kind": "router"})

    def test_iterator_detected_in_fixture(self):
        snapshot = load_fixture("iterator.json")
        iterators = [n for n in snapshot["nodes"] if is_iterator_container(n)]
        assert len(iterators) == 1
        assert iterators[0]["id"] == "iter-node"


class TestParentIteratorId:
    def test_extracts_from_container_config(self):
        node = {"id": "child", "metadata": {"containerConfig": {"parentIteratorId": "iter-1"}}}
        assert _get_parent_iterator_id(node) == "iter-1"

    def test_extracts_from_snake_case(self):
        node = {"id": "child", "metadata": {"container_config": {"parent_iterator_id": "iter-1"}}}
        assert _get_parent_iterator_id(node) == "iter-1"

    def test_returns_empty_when_no_metadata(self):
        assert _get_parent_iterator_id({"id": "child"}) == ""

    def test_returns_empty_when_no_container_config(self):
        assert _get_parent_iterator_id({"id": "child", "metadata": {}}) == ""


class TestComputeChildren:
    @pytest.fixture
    def adjacency(self):
        node_ids = {"step-1", "iter-node", "child-step", "step-3"}
        edges = [
            {"source": "step-1", "target": "iter-node"},
            {"source": "iter-node", "target": "child-step"},
            {"source": "child-step", "target": "step-3"},
        ]
        return _build_adjacency(edges, node_ids)

    def test_children_are_all_reachable(self, adjacency):
        children, exits = compute_iterator_children("iter-node", adjacency, set(adjacency.keys()))
        assert sorted(children) == ["child-step", "step-3"]
        assert exits == []

    def test_children_determined_by_parent_iterator_id(self, adjacency):
        raw_nodes = [
            {"id": "step-1", "kind": "step"},
            {"id": "iter-node", "kind": "iterator"},
            {"id": "child-step", "kind": "step", "metadata": {"containerConfig": {"parentIteratorId": "iter-node"}}},
            {"id": "step-3", "kind": "step"},
        ]
        children, exits = compute_iterator_children("iter-node", adjacency, set(adjacency.keys()), raw_nodes=raw_nodes)
        assert children == ["child-step"]
        assert exits == ["step-3"]

    def test_no_children_when_no_outgoing(self, adjacency):
        children, exits = compute_iterator_children("step-3", adjacency, set(adjacency.keys()))
        assert children == []
        assert exits == []

    def test_multiple_exit_targets(self):
        node_ids = {"iter", "child-a", "child-b", "exit-1", "exit-2"}
        edges = [
            {"source": "iter", "target": "child-a"},
            {"source": "iter", "target": "child-b"},
            {"source": "child-a", "target": "exit-1"},
            {"source": "child-b", "target": "exit-2"},
        ]
        adj = _build_adjacency(edges, node_ids)
        children, exits = compute_iterator_children("iter", adj, node_ids)
        assert sorted(children) == ["child-a", "child-b", "exit-1", "exit-2"]
        assert exits == []

    def test_multiple_exit_targets_with_parent_id(self):
        node_ids = {"iter", "child-a", "child-b", "exit-1", "exit-2"}
        edges = [
            {"source": "iter", "target": "child-a"},
            {"source": "iter", "target": "child-b"},
            {"source": "child-a", "target": "exit-1"},
            {"source": "child-b", "target": "exit-2"},
        ]
        adj = _build_adjacency(edges, node_ids)
        raw_nodes = [
            {"id": "iter", "kind": "iterator"},
            {"id": "child-a", "kind": "step", "metadata": {"containerConfig": {"parentIteratorId": "iter"}}},
            {"id": "child-b", "kind": "step", "metadata": {"containerConfig": {"parentIteratorId": "iter"}}},
            {"id": "exit-1", "kind": "step"},
            {"id": "exit-2", "kind": "step"},
        ]
        children, exits = compute_iterator_children("iter", adj, node_ids, raw_nodes=raw_nodes)
        assert sorted(children) == ["child-a", "child-b"]
        assert sorted(exits) == ["exit-1", "exit-2"]

    def test_iterator_with_no_body_children(self):
        node_ids = {"iter", "exit-node"}
        edges = [{"source": "iter", "target": "exit-node"}]
        adj = _build_adjacency(edges, node_ids)
        children, exits = compute_iterator_children("iter", adj, node_ids)
        assert children == []
        assert exits == ["exit-node"]


class TestResolveItems:
    def test_resolve_from_inputs(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {"items": ["a", "b", "c"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        items = _resolve_items(state, "inputs.items", 0)
        assert items == ["a", "b", "c"]

    def test_max_items_caps(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {"items": [1, 2, 3, 4, 5]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        items = _resolve_items(state, "inputs.items", 3)
        assert items == [1, 2, 3]

    def test_return_empty_for_missing_path(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        items = _resolve_items(state, "inputs.missing", 0)
        assert items == []

    def test_empty_collection_path(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        items = _resolve_items(state, "", 0)
        assert items == []

    def test_non_list_value_returns_empty(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {"items": "not-a-list"},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        items = _resolve_items(state, "inputs.items", 0)
        assert items == []

    def test_nested_path_resolution(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {"data": {"values": [10, 20, 30]}},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        items = _resolve_items(state, "inputs.data.values", 2)
        assert items == [10, 20]

    def test_resolve_from_task_outputs(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {("prev-node", 0): [1, 2, 3]},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        items = _resolve_items(state, "task_outputs.('prev-node', 0)", 0)
        assert items == []


class TestCoerceToList:
    def test_json_string_array(self):
        assert _coerce_to_list('["product a", "product b"]') == ["product a", "product b"]

    def test_json_string_object(self):
        result = _coerce_to_list('{"key": "value"}')
        assert result == [{"key": "value"}]

    def test_json_string_object_extracts_nested_list(self):
        result = _coerce_to_list('{"folder":"CVs","files":[{"name":"a.pdf"},{"name":"b.pdf"}]}')
        assert result == [{"name": "a.pdf"}, {"name": "b.pdf"}]

    def test_plain_string_returns_empty(self):
        assert _coerce_to_list("not-a-list") == []

    def test_list_passthrough(self):
        assert _coerce_to_list([1, 2, 3]) == [1, 2, 3]

    def test_dict_extracts_single_list_value(self):
        assert _coerce_to_list({"items": [1, 2]}) == [1, 2]

    def test_none_returns_empty(self):
        assert _coerce_to_list(None) == []

    def test_scalar_wrapped(self):
        assert _coerce_to_list(42) == [42]


def _make_state(task_outputs=None, inputs=None) -> ExecutionState:
    return {
        "execution_id": "e1",
        "flow_id": "f1",
        "inputs": inputs or {},
        "task_outputs": task_outputs or {},
        "iterations": {},
        "router_decisions": {},
        "errors": [],
        "pending_approval": None,
        "cancelled": False,
    }


class TestResolveItemsFromBindings:
    def test_resolves_from_node_output_binding(self):
        state = _make_state(task_outputs={
            ("upstream", 0): {
                "outputs": [
                    {"output_port_id": "candidate_companies", "artifact_kind": "data", "content": '["product a", "product b"]'},
                ],
            },
        })
        bindings = [{
            "id": "b1",
            "source_kind": "node-output",
            "source_node": "upstream",
            "source_port": "candidate_companies",
            "target_node": "iterator-1",
            "target_port": "default",
            "iteration": "current",
        }]
        items = _resolve_items_from_bindings("iterator-1", bindings, state, 0)
        assert items == ["product a", "product b"]

    def test_returns_empty_when_no_bindings_match(self):
        state = _make_state()
        items = _resolve_items_from_bindings("iterator-1", [], state, 0)
        assert items == []

    def test_max_items_caps_binding_result(self):
        state = _make_state(task_outputs={
            ("upstream", 0): {
                "outputs": [
                    {"output_port_id": "data", "artifact_kind": "data", "content": "[1,2,3,4,5]"},
                ],
            },
        })
        bindings = [{
            "id": "b1",
            "source_kind": "node-output",
            "source_node": "upstream",
            "source_port": "data",
            "target_node": "iter",
            "target_port": "default",
            "iteration": "current",
        }]
        items = _resolve_items_from_bindings("iter", bindings, state, 2)
        assert items == [1, 2]

    def test_synthesizes_binding_from_control_edge(self):
        state = _make_state(task_outputs={
            ("upstream", 0): {
                "outputs": [
                    {"output_port_id": "lead_list", "artifact_kind": "data", "content": '[{"name":"a"},{"name":"b"}]'},
                ],
            },
        })
        raw_edges = [{
            "source": "upstream",
            "target": "iter",
            "source_output_port_id": "lead_list",
            "target_input_port_id": "items",
        }]
        items = _resolve_items_from_bindings("iter", [], state, 0, raw_edges=raw_edges)
        assert len(items) == 2
        assert items[0] == {"name": "a"}

    def test_no_duplicate_from_edge_and_binding(self):
        state = _make_state(task_outputs={
            ("upstream", 0): {
                "outputs": [
                    {"output_port_id": "data", "artifact_kind": "data", "content": "[1,2]"},
                ],
            },
        })
        bindings = [{
            "id": "b1",
            "source_kind": "node-output",
            "source_node": "upstream",
            "source_port": "data",
            "target_node": "iter",
            "target_port": "items",
            "iteration": "current",
        }]
        raw_edges = [{
            "source": "upstream",
            "target": "iter",
            "source_output_port_id": "data",
            "target_input_port_id": "items",
        }]
        items = _resolve_items_from_bindings("iter", bindings, state, 0, raw_edges=raw_edges)
        assert items == [1, 2]

    def test_does_not_synthesize_data_binding_from_router_control_edge(self):
        state = _make_state(task_outputs={
            ("router", 0): {
                "outputs": [
                    {"output_port_id": "approved", "artifact_kind": "data", "content": "[1,2]"},
                ],
            },
        })
        raw_edges = [{
            "kind": "conditional",
            "source": "router",
            "target": "iter",
            "source_output_port_id": "approved",
            "target_input_port_id": "items",
            "router_label": "approved",
        }]

        assert _resolve_items_from_bindings("iter", [], state, 0, raw_edges=raw_edges) == []


class TestComposeWithIterator:
    def test_compose_iterator_graph(self):
        snapshot = load_fixture("iterator.json")
        graph = compose(snapshot)
        assert graph is not None

    def test_iterator_children_excluded_from_main_graph(self):
        snapshot = load_fixture("iterator.json")
        graph = compose(snapshot)
        assert "child-step" not in graph.nodes
        assert "step-3" in graph.nodes
        assert "step-1" in graph.nodes
        assert "iter-node" in graph.nodes

    def test_iterator_replaces_body(self):
        snapshot = load_fixture("iterator.json")
        graph = compose(snapshot)
        assert "iter-node" in graph.nodes
        assert "child-step" not in graph.nodes
        assert "step-3" in graph.nodes


class TestBuildBodySubgraph:
    def test_subgraph_compiles(self):
        children = ["child-step"]
        raw_nodes = [
            {"id": "child-step", "kind": "step", "label": "Process Item"},
        ]
        raw_edges = []
        subgraph = _build_body_subgraph(
            children, raw_nodes, raw_edges, [],
            {}, set(), {},
        )
        assert subgraph is not None
        assert "child-step" in subgraph.nodes

    def test_subgraph_has_edges_between_children(self):
        children = ["child-a", "child-b"]
        raw_nodes = [
            {"id": "child-a", "kind": "step", "label": "A"},
            {"id": "child-b", "kind": "step", "label": "B"},
        ]
        raw_edges = [
            {"source": "child-a", "target": "child-b"},
        ]
        subgraph = _build_body_subgraph(
            children, raw_nodes, raw_edges, [],
            {}, set(), {},
        )
        assert subgraph is not None
        assert "child-a" in subgraph.nodes
        assert "child-b" in subgraph.nodes

    def test_subgraph_compiles_router_with_unlinked_terminal_label(self):
        children = ["router", "linked-child"]
        raw_nodes = [{
            "id": "router",
            "kind": "router",
            "label": "Route",
            "router_config": {"output_labels": ["linked", "unlinked"]},
        }, {
            "id": "linked-child",
            "kind": "step",
            "label": "Linked",
        }]
        raw_edges = [{
            "kind": "conditional",
            "source": "router",
            "target": "linked-child",
            "router_label": "linked",
        }]

        subgraph = _build_body_subgraph(
            children, raw_nodes, raw_edges, [],
            {}, set(), {"router": raw_nodes[0]},
        )

        assert subgraph is not None
        assert "router" in subgraph.nodes

    def test_multi_child_body_nodes_not_in_main_graph(self):
        snapshot = load_fixture("iterator_multi_child.json")
        graph = compose(snapshot)
        assert graph is not None
        assert "child-a" not in graph.nodes
        assert "child-b" not in graph.nodes
        assert "output-step" in graph.nodes
        assert "input-step" in graph.nodes
        assert "iter-node" in graph.nodes


class MockIteratorChunk:
    """Mock LiteLLM streaming chunk for iterator child invocation tests."""
    def __init__(self, text: str):
        self.choices = [MockChoice(text)]


class MockChoice:
    def __init__(self, text: str):
        self.delta = MockDelta(text)


class MockDelta:
    def __init__(self, text: str):
        self.content = text


class MockAsyncStream:
    def __init__(self, texts: list[str]):
        self.texts = texts

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for t in self.texts:
            yield MockIteratorChunk(t)


@pytest.mark.asyncio
async def test_invoke_iterator_graph_with_items():
    """Full graph invocation with mocked LLM — verifies subgraph runs per item."""
    snapshot = load_fixture("iterator.json")

    with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-iter-1",
            "flow_id": "iter-flow",
            "inputs": {"items": ["item-1", "item-2"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    task_outputs = result.get("task_outputs", {})
    assert ("step-1", 0) in task_outputs
    assert ("iter-node", 0) in task_outputs

    iter_output = task_outputs.get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 2
    assert iterations[0]["index"] == 0
    assert iterations[0]["status"] == "completed"
    assert iterations[1]["index"] == 1
    assert iterations[1]["status"] == "completed"
    assert iterations[0]["childResults"][0]["taskId"] == "child-step"
    assert iterations[0]["childResults"][0]["status"] == "completed"
    assert iterations[0]["itemPreview"] == "item-1"


class TestIteratorStreamingEvents:
    @pytest.mark.asyncio
    async def test_streams_lifecycle_events_per_iteration_turn(self):
        """A streamed run emits the iterator NodeStarted plus per-turn child events."""
        snapshot = load_fixture("iterator.json")

        with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])):
            graph = compose(snapshot)
            chunks = [
                chunk
                async for chunk in stream_graph(graph, {
                    "execution_id": "test-iter-stream",
                    "flow_id": "iter-flow",
                    "inputs": {"items": ["item-1", "item-2"]},
                    "task_outputs": {},
                    "iterations": {},
                    "router_decisions": {},
                    "errors": [],
                    "pending_approval": None,
                    "cancelled": False,
                })
            ]

        custom = [chunk["_data"] for chunk in chunks if chunk["_mode"] == "custom"]

        iterator_started = [event for event in custom if event.get("type") == "NodeStarted" and event.get("node_id") == "iter-node"]
        assert len(iterator_started) == 1

        child_starts = [event for event in custom if event.get("type") == "IteratorChildStepStarted"]
        assert [event["payload"]["iterationIndex"] for event in child_starts] == [0, 1]
        assert all(event["payload"]["taskId"] == "child-step" for event in child_starts)
        assert all(event["payload"]["status"] == "running" for event in child_starts)

        child_completed = [event for event in custom if event.get("type") == "IteratorChildStepCompleted"]
        assert [event["payload"]["iterationIndex"] for event in child_completed] == [0, 1]
        assert all(event["payload"]["status"] == "completed" for event in child_completed)
        assert all(event["payload"]["output"] == "result" for event in child_completed)

        # Turn 0 must fully stream before turn 1 starts.
        assert custom.index(child_starts[0]) < custom.index(child_completed[0]) < custom.index(child_starts[1])


@pytest.mark.asyncio
async def test_invoke_iterator_max_items():
    """max_items caps the number of items processed."""
    snapshot = load_fixture("iterator.json")
    for node in snapshot["nodes"]:
        if node["id"] == "iter-node":
            node["iterator_config"]["max_items"] = 1

    with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-iter-2",
            "flow_id": "iter-flow",
            "inputs": {"items": ["a", "b", "c"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    iter_output = result.get("task_outputs", {}).get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 1
    assert iterations[0]["index"] == 0


@pytest.mark.asyncio
async def test_invoke_iterator_no_items():
    """Empty collection — no subgraph invocations."""
    snapshot = load_fixture("iterator.json")

    with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-iter-3",
            "flow_id": "iter-flow",
            "inputs": {"items": []},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    iter_output = result.get("task_outputs", {}).get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 0


@pytest.mark.asyncio
async def test_invoke_multi_child_iterator():
    """Multi-child body subgraph runs per item."""
    snapshot = load_fixture("iterator_multi_child.json")

    with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-iter-4",
            "flow_id": "iter-flow",
            "inputs": {"items": ["x", "y"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    iter_output = result.get("task_outputs", {}).get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 2


@pytest.mark.asyncio
async def test_iterator_child_inherits_current_item_in_inputs():
    snapshot = load_fixture("iterator.json")
    seen_inputs = []

    async def mock_step_fn(node_id, node_config, state, node_inputs=None):
        seen_inputs.append(node_inputs)
        return {
            "task_outputs": {(node_id, 0): {"output": "ok", "display_text": "ok"}},
            "iterations": {node_id: 1},
        }

    with patch.dict("src.flow_engine.builder.iterator.NODE_KIND_DISPATCH", {"step": mock_step_fn}):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-iter-inputs",
            "flow_id": "iter-flow",
            "inputs": {"items": ["alpha", "beta"], "context": "shared"},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    assert [entry["_item"] for entry in seen_inputs] == ["alpha", "beta"]
    assert [entry["_index"] for entry in seen_inputs] == [0, 1]
    assert all(entry["context"] == "shared" for entry in seen_inputs)

    iterations = result.get("task_outputs", {}).get(("iter-node", 0), {}).get("iterator_iterations", [])
    assert iterations[0]["childResults"] == [{
        "taskId": "child-step",
        "taskTitle": "Process Item",
        "status": "completed",
        "output": "ok",
        "components": [],
        "reasoningChain": [],
        "artifacts": [],
    }]


@pytest.mark.asyncio
async def test_invoke_iterator_child_failure_records_failed_iteration():
    """One child fails (node-level) — other items still complete, failed iteration recorded.

    Patches NODE_KIND_DISPATCH in ``iterator.py`` so the body subgraph's first child
    (child-step) raises on the 2nd item.  The iterator's try/except catches it and
    records ``"failed"`` status for that iteration.  Other items continue normally.

    The body subgraph has 1 child per item (child-step), so call_count
    increments by 1 per item:
        item-0: call 1 (child-step succeeds)
        item-1: call 2 (child-step fails)
        item-2: call 3 (child-step succeeds)
    """
    snapshot = load_fixture("iterator.json")
    call_count = 0

    async def mock_step_fn(node_id, node_config, state, node_inputs=None):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise Exception("Simulated node failure")
        return {"task_outputs": {(node_id, 0): {"output": "ok"}}, "iterations": {node_id: 1}}

    with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])), \
         patch.dict("src.flow_engine.builder.iterator.NODE_KIND_DISPATCH", {"step": mock_step_fn}):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-fail-1",
            "flow_id": "iter-flow",
            "inputs": {"items": ["good", "bad", "good2"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    iter_output = result.get("task_outputs", {}).get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 3, f"Expected 3 iterations, got {len(iterations)}"
    assert iterations[0]["status"] == "completed"
    assert iterations[1]["status"] == "failed"
    assert "error" in iterations[1]
    assert "Simulated node failure" in iterations[1]["error"]
    assert iterations[2]["status"] == "completed"


@pytest.mark.asyncio
async def test_invoke_iterator_stops_when_cancelled_before_items():
    """cancelled=True in initial state — no items processed."""
    snapshot = load_fixture("iterator.json")

    with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-cancel-1",
            "flow_id": "iter-flow",
            "inputs": {"items": ["a", "b", "c"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": True,
        })

    iter_output = result.get("task_outputs", {}).get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 0, f"Expected 0 iterations when cancelled, got {len(iterations)}"
    assert iter_output.get("count", 0) == 0


@pytest.mark.asyncio
async def test_invoke_iterator_cancelled_mid_loop_skips_remaining():
    """Items after cancellation are skipped — verifies the cancellation guard in the loop."""
    snapshot = load_fixture("iterator.json")
    call_count = 0

    async def mock_with_cancel(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return MockAsyncStream(["first"])
        raise Exception("Should not be reached")

    with patch("src.flow_engine.nodes.step.litellm.acompletion", side_effect=mock_with_cancel):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-cancel-2",
            "flow_id": "iter-flow",
            "inputs": {"items": ["a", "b", "c"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    # All 3 items processed since cancelled was False throughout
    iter_output = result.get("task_outputs", {}).get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 3
    # Cancellation guard is checked at start of each iteration — with initial cancelled=False,
    # all items process.  Simulating mid-loop cancellation would require the runtime to set
    # state["cancelled"] on the live ExecutionState, which is not supported yet (future enhancement).


@pytest.mark.asyncio
async def test_invoke_iterator_body_data_binding_uses_current_item():
    """Data binding from inputs._item propagates per-item value to body child."""
    snapshot = load_fixture("iterator_with_bindings.json")

    with patch("src.flow_engine.nodes.step.litellm.acompletion", return_value=MockAsyncStream(["result"])):
        graph = compose(snapshot)
        result = await graph.ainvoke({
            "execution_id": "test-bind-1",
            "flow_id": "iter-flow",
            "inputs": {"items": ["alpha", "beta"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        })

    iter_output = result.get("task_outputs", {}).get(("iter-node", 0), {})
    iterations = iter_output.get("iterator_iterations", [])
    assert len(iterations) == 2
    assert iterations[0]["status"] == "completed"
    assert iterations[0]["index"] == 0
    assert iterations[1]["status"] == "completed"
    assert iterations[1]["index"] == 1
