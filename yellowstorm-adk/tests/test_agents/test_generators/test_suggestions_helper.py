"""Unit tests for suggestions helper utilities."""

import json
import re as stdlib_re
from types import SimpleNamespace
from unittest.mock import patch

from src.smart_rag.agents.generators.suggestions_helper import (
    extract_json_from_text,
    model_supports_structured_output,
    parse_suggestions_response,
)


class TestSuggestionsHelper:
    def test_model_supports_structured_output_false_for_unsupported(self):
        assert model_supports_structured_output("gpt-5-chat") is False
        assert model_supports_structured_output("") is False

    def test_model_supports_structured_output_true_for_modern_models(self):
        assert model_supports_structured_output("gpt-4o") is True

    def test_parse_suggestions_response_json(self):
        response = SimpleNamespace(text=json.dumps([{"name": "A"}]))
        assert parse_suggestions_response(response) == [{"name": "A"}]

    @patch("src.smart_rag.agents.generators.suggestions_helper.extract_json_from_text")
    def test_parse_suggestions_response_fallback(self, mock_extract):
        mock_extract.return_value = {"suggestions": [{"name": "B"}]}
        response = SimpleNamespace(text="not-json")
        assert parse_suggestions_response(response) == {"suggestions": [{"name": "B"}]}

    @patch("src.smart_rag.agents.generators.suggestions_helper.re", stdlib_re)
    def test_extract_json_from_text_success(self):
        text = '{"available_agent_ids": [], "suggestions": []}'
        parsed = extract_json_from_text(text)
        assert parsed["suggestions"] == []
        assert parsed["available_agent_ids"] == []

    @patch("src.smart_rag.agents.generators.suggestions_helper.re", stdlib_re)
    @patch("src.smart_rag.agents.generators.suggestions_helper.logger")
    def test_extract_json_from_text_empty_on_failure(self, _logger):
        parsed = extract_json_from_text("no json here")
        assert parsed == {"suggestions": [], "available_agent_ids": []}
