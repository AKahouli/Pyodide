from src.guardrails.adapters.google_adk import append_callback, apply_guardrail_callbacks


def test_append_callback_preserves_existing_order() -> None:
    first = lambda *_args: None
    second = lambda *_args: None
    assert append_callback(first, second) == [first, second]
    assert append_callback([first], second) == [first, second]


def test_apply_guardrail_callbacks_composes_every_native_phase() -> None:
    existing = lambda *_args: None
    kwargs = {"before_model_callback": existing, "before_tool_callback": existing}
    result = apply_guardrail_callbacks(kwargs, {})
    assert result["before_model_callback"][0] is existing
    assert result["before_tool_callback"][0] is existing
    assert len(result["before_model_callback"]) == 2
    assert len(result["after_model_callback"]) == 1
    assert len(result["before_tool_callback"]) == 2
