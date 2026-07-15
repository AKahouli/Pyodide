from src.temporary_child_summary import (
    pop_temporary_child_summary,
    record_temporary_child_start,
    record_temporary_child_tool_call,
)


def test_temporary_child_tool_call_summary_includes_child_name():
    session_id = "summary-child-tool-call-test"
    pop_temporary_child_summary(session_id)
    record_temporary_child_start(
        session_id=session_id,
        parent="parent",
        child="child-1",
        task_description="task",
    )

    record_temporary_child_tool_call(
        session_id=session_id,
        child="child-1",
        tool_name="search",
        args={"query": "revenue"},
        result_preview="found",
    )

    summary = pop_temporary_child_summary(session_id)
    tool_call = summary["children"][0]["tool_calls"][0]
    assert tool_call["child"] == "child-1"
    assert tool_call["tool_name"] == "search"
