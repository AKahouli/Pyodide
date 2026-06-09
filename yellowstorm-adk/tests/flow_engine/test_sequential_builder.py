import operator
from typing import Any
from typing_extensions import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from src.flow_engine.builder.sequential import add_sequential_edges


class GraphState(TypedDict):
    visited: Annotated[list[str], operator.add]


class FakeGraph:
    def __init__(self) -> None:
        self.edges: list[tuple[str | list[str], str]] = []

    def add_edge(self, source: str | list[str], target: str) -> None:
        self.edges.append((source, target))


def test_converging_sequential_edges_are_wired_as_fan_in() -> None:
    graph = FakeGraph()
    nodes = [
        {"id": "diagnostic"},
        {"id": "recommendations"},
        {"id": "impacts"},
        {"id": "presentation"},
    ]
    edges: list[dict[str, Any]] = [
        {"kind": "sequential", "source": "diagnostic", "target": "presentation"},
        {"kind": "sequential", "source": "recommendations", "target": "presentation"},
        {"kind": "sequential", "source": "impacts", "target": "presentation"},
    ]

    add_sequential_edges(graph, edges, nodes)

    assert graph.edges == [(["diagnostic", "recommendations", "impacts"], "presentation")]


def test_single_sequential_edge_keeps_single_source_wiring() -> None:
    graph = FakeGraph()
    nodes = [{"id": "start"}, {"id": "next"}]
    edges = [{"kind": "sequential", "source": "start", "target": "next"}]

    add_sequential_edges(graph, edges, nodes)

    assert graph.edges == [("start", "next")]


def test_duplicate_sequential_edges_are_ignored() -> None:
    graph = FakeGraph()
    nodes = [{"id": "start"}, {"id": "next"}]
    edges = [
        {"kind": "sequential", "source": "start", "target": "next"},
        {"kind": "sequential", "source": "start", "target": "next"},
    ]

    add_sequential_edges(graph, edges, nodes)

    assert graph.edges == [("start", "next")]


def test_converging_sequential_edges_execute_target_once() -> None:
    graph = StateGraph(GraphState)
    for node_id in ["diagnostic", "recommendations", "impacts", "presentation"]:
        graph.add_node(node_id, lambda state, node_id=node_id: {"visited": [node_id]})

    graph.add_edge(START, "diagnostic")
    graph.add_edge(START, "recommendations")
    graph.add_edge(START, "impacts")
    add_sequential_edges(
        graph,
        [
            {"kind": "sequential", "source": "diagnostic", "target": "presentation"},
            {"kind": "sequential", "source": "recommendations", "target": "presentation"},
            {"kind": "sequential", "source": "impacts", "target": "presentation"},
        ],
        [
            {"id": "diagnostic"},
            {"id": "recommendations"},
            {"id": "impacts"},
            {"id": "presentation"},
        ],
    )
    graph.add_edge("presentation", END)

    result = graph.compile().invoke({"visited": []})

    assert result["visited"].count("presentation") == 1
