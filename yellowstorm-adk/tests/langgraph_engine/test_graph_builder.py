import asyncio

from src.langgraph_engine.graph_builder import DynamicGraphBuilder, _extract_artifacts_from_components


def test_extract_artifacts_assigns_same_kind_file_outputs_in_port_order() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "https://example.com/report.pdf",
                    "filename": "report.pdf",
                },
            },
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "https://example.com/deck.pptx",
                    "filename": "deck.pptx",
                },
            }
        ],
        {
            "output_ports": [
                {"id": "out-pdf", "name": "PDF", "artifact_kind": "document"},
                {"id": "out-pptx", "name": "pptx", "artifact_kind": "document"},
            ]
        },
    )

    assert artifacts == [
        {
            "port_id": "out-pdf",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
        },
        {
            "port_id": "out-pptx",
            "artifact_kind": "document",
            "url": "https://example.com/deck.pptx",
            "filename": "deck.pptx",
        }
    ]


def test_task_without_assigned_agent_emits_failed_step_update() -> None:
    updates = []

    async def on_step_update(update):
        updates.append(update)

    builder = DynamicGraphBuilder.__new__(DynamicGraphBuilder)
    node = builder._create_task_node(
        "task-1",
        {"id": "task-1", "title": "Task 1", "assigned_agent_id": "missing-agent"},
        on_step_update,
    )

    result = asyncio.run(node({"agents": {}, "playbook_id": "pb-1", "thread_id": "th-1"}, {}))

    assert result["status"] == "failed"
    assert updates
    assert updates[0]["status"] == "failed"
    assert updates[0]["result"]["error"] == "No agent assigned to task task-1"
