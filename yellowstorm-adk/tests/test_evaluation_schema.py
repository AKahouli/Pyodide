from src.schema.evaluation_schema import SemanticMatchRequest


def test_semantic_match_request_accepts_optional_task_context():
    request = SemanticMatchRequest(baseline_output="baseline", current_output="current")

    assert request.task_title is None
    assert request.task_description is None

    with_context = SemanticMatchRequest(
        baseline_output="baseline",
        current_output="current",
        task_title="Task title",
        task_description="Task description",
    )

    assert with_context.task_title == "Task title"
    assert with_context.task_description == "Task description"
