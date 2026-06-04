from src.flow_engine.advisor.execution_advisor_service import evaluate_task_execution


def test_evaluate_task_execution_returns_expected_structure() -> None:
    result = evaluate_task_execution(
        {
            "execution_id": "exec-1",
            "owner_id": "user-1",
            "playbook_id": "playbook-1",
            "task_id": "task-1",
            "task_title": "Draft report",
            "task_description": "Draft the final report.",
            "expected_result": "final report",
            "output_format_guide": "# Executive Summary",
            "baseline_output": "",
            "task_output": "This final report includes an executive summary.",
            "task_error": "",
            "task_status": "completed",
            "tool_trace": [{"call_index": 1, "tool_name": "search", "args": {}, "output_summary": "Found evidence"}],
            "artifacts_json": "[]",
            "task_metadata": {},
        }
    )

    assert result["overall_score"] >= 0
    assert result["expected_result_source"] == "node_field"
    assert result["available_actions"] == {"optimize_step": True, "optimize_playbook": True}
    assert result["format_compliance_score"] >= 0
    assert isinstance(result["tool_usage_strengths"], list)


def test_evaluate_task_execution_flags_empty_output() -> None:
    result = evaluate_task_execution(
        {
            "execution_id": "exec-1",
            "owner_id": "user-1",
            "playbook_id": "playbook-1",
            "task_id": "task-1",
            "task_title": "Draft report",
            "task_description": "Draft the final report.",
            "expected_result": "",
            "output_format_guide": "",
            "baseline_output": "",
            "task_output": "",
            "task_error": "",
            "task_status": "completed",
            "tool_trace": [],
            "artifacts_json": "[]",
            "task_metadata": {},
        }
    )

    assert "Task output is empty." in result["missing_facts"]
    assert result["overall_score"] <= 20


def test_evaluate_task_execution_flags_error_and_missing_tool_summary() -> None:
    result = evaluate_task_execution(
        {
            "execution_id": "exec-1",
            "owner_id": "user-1",
            "playbook_id": "playbook-1",
            "task_id": "task-1",
            "task_title": "Draft report",
            "task_description": "Draft the final report.",
            "expected_result": "",
            "output_format_guide": "",
            "baseline_output": "",
            "task_output": "partial",
            "task_error": "timeout",
            "task_status": "failed",
            "tool_trace": [{"call_index": 1, "tool_name": "search", "args": {}, "output_summary": ""}],
            "artifacts_json": "[]",
            "task_metadata": {},
        }
    )

    assert any("Task ended with error" in item for item in result["incoherences"])
    assert result["overall_score"] <= 25
    assert any("no summarized output" in item.lower() for item in result["tool_output_use_issues"])


def test_evaluate_task_execution_caps_format_violations() -> None:
    result = evaluate_task_execution(
        {
            "execution_id": "exec-1",
            "owner_id": "user-1",
            "playbook_id": "playbook-1",
            "task_id": "task-1",
            "task_title": "Draft report",
            "task_description": "Draft the final report with a stable contract and clear evidence.",
            "expected_result": "",
            "output_format_guide": "# Executive Summary",
            "baseline_output": "",
            "task_output": "Brief note without the required heading.",
            "task_error": "",
            "task_status": "completed",
            "tool_trace": [{"call_index": 1, "tool_name": "search", "args": {}, "output_summary": "Found evidence"}],
            "artifacts_json": "[]",
            "task_metadata": {},
        }
    )

    assert result["format_compliance_score"] < 80
    assert result["overall_score"] <= 65
