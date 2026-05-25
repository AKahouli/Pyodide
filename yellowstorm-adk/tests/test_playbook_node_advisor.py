from src.flow_engine.advisor.playbook_node_advisor import advise_playbook_node
from src.flow_engine.advisor.playbook_node_advisor import (
    advise_playbook_node as advise_playbook_node_shim,
)


def test_advise_playbook_node_flags_missing_agent() -> None:
    result = advise_playbook_node(
        {
            "playbook_id": "pb-1",
            "task_id": "task-1",
            "target_task": {
                "title": "Review contract",
                "description": "Check clauses.",
                "assigned_agent_id": "",
                "input_ports": [],
            },
        }
    )

    assert result["task_id"] == "task-1"
    assert any(item["type"] == "agent_selection" for item in result["suggestions"])


def test_langgraph_playbook_node_advisor_shim_delegates() -> None:
    result = advise_playbook_node_shim(
        {
            "task_id": "task-1",
            "target_task": {"title": "Review contract"},
        }
    )

    assert result["task_id"] == "task-1"
