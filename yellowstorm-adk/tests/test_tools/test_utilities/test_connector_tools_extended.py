"""Extended unit tests for connector_tools helper functions."""

from src.smart_rag.tools.utilities.connector_tools import (
    ConnectorToolContext,
    _append_citation_guidance,
    _build_connector_source_signature,
    _is_locate_answer_citations_action,
    _keeps_citation_fields,
    _normalize_connector_action_description,
    _redact_log_payload,
    _strip_legacy_citation_fields,
)


class TestConnectorToolHelpers:
    def test_redact_log_payload_masks_base64(self):
        payload = {"image_base64": "abc" * 100, "query": "revenue"}
        redacted = _redact_log_payload(payload)
        assert "abc" not in str(redacted["image_base64"])

    def test_locate_answer_citation_flags(self):
        assert _is_locate_answer_citations_action("search_locate_answer_citations") is True
        assert _keeps_citation_fields("search_locate_answer_citations") is True
        assert _is_locate_answer_citations_action("read_section") is False

    def test_strip_legacy_citation_fields(self):
        response = _strip_legacy_citation_fields(
            {"text": "answer", "citation_sources": [], "sources": [], "citations": []}
        )
        assert response == {"text": "answer"}

    def test_normalize_connector_action_description(self):
        text = _normalize_connector_action_description(
            "Filter by workspace names and Workspace name"
        )
        assert "workspace IDs" in text
        assert "workspace name" not in text

    def test_build_connector_source_signature(self):
        sig = _build_connector_source_signature(
            {
                "type": "text",
                "source": "doc.pdf",
                "file_name": "doc.pdf",
                "page": "2",
                "page_content": "content",
            }
        )
        assert "doc.pdf" in sig

    def test_append_citation_guidance(self):
        text = _append_citation_guidance("Revenue grew", ["1", "2"])
        assert "[1]" in text
        assert "[2]" in text

    def test_connector_tool_context_defaults(self):
        ctx = ConnectorToolContext(workspace_id="w1", session_id="s1")
        assert ctx.workspace_id == "w1"
        assert ctx.brain_ids is None
