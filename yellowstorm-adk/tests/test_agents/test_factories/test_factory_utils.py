"""Unit tests for delegation factory utils."""

from unittest.mock import MagicMock

from src.smart_rag.agents.factories.utils import (
    add_function_execution_event,
    create_enhanced_prompt,
    determine_execution_success,
    get_error_count,
    process_execution_step,
    process_execution_summary,
    update_span_with_execution_result,
)


class TestFactoryUtils:
    def test_create_enhanced_prompt(self):
        tool_provider = MagicMock()
        tool_provider.get_tools_description.return_value = "\nTools"
        prompt = create_enhanced_prompt(
            tool_provider,
            MagicMock(),
            {"prompt": "Base", "html": False},
            ["search"],
        )
        assert prompt.startswith("Base")
        assert "Tools" in prompt

    def test_process_execution_summary_and_steps(self):
        span = MagicMock()
        summary = {
            "execution_flow": [
                {
                    "step_type": "function_execution",
                    "input": {"function_name": "search"},
                    "output": "ok",
                },
                {"step_type": "text_generation", "content": "hello"},
                {"step_type": "error", "error_message": "boom"},
                {"step_type": "custom", "output": "x"},
            ]
        }
        process_execution_summary(summary, span)
        assert span.event.call_count == 4

    def test_add_function_execution_event_without_output(self):
        span = MagicMock()
        add_function_execution_event(
            {"input": {"function_name": "calc"}},
            span,
        )
        span.event.assert_called_once()

    def test_update_span_with_execution_result(self):
        span = MagicMock()
        update_span_with_execution_result(
            span,
            "ok",
            {"execution_statistics": {"execution_success": True}},
            "Agent",
        )
        span.update.assert_called_once()

    def test_determine_execution_success_and_error_count(self):
        assert determine_execution_success(None) is True
        assert determine_execution_success(
            {"execution_statistics": {"execution_success": False}}
        ) is False
        assert get_error_count({"execution_statistics": {"errors_count": 2}}) == 2
