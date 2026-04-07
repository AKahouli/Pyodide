from src.langgraph_engine.workflow_service import _build_resume_state_update


def test_build_resume_state_update_restores_clarification_context() -> None:
    update = _build_resume_state_update({
        "type": "clarification",
        "task_id": "step_1",
        "task_description": "Clarified task description",
        "conversation_json": '[{"role": "assistant", "content": "Need scope?"}, {"role": "user", "content": "France 90 days"}]',
    })

    assert update == {
        "clarification_transcripts_by_task": {
            "step_1": [
                {"role": "assistant", "content": "Need scope?"},
                {"role": "user", "content": "France 90 days"},
            ],
        },
        "task_description_overrides_by_task": {
            "step_1": "Clarified task description",
        },
    }


def test_build_resume_state_update_ignores_non_clarification_interrupts() -> None:
    assert _build_resume_state_update({"type": "approval_request", "task_id": "step_1"}) is None
