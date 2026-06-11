import sys
from types import SimpleNamespace

import pytest

if "src.smart_rag.tools.utilities.connector_tools" not in sys.modules:
    sys.modules[
        "src.smart_rag.tools.utilities.connector_tools"
    ] = SimpleNamespace(
        import_connector_items_to_workspace_request=lambda *a, **kw: None,
    )

from src.flow_engine.mcp import _log_payload, _normalize_mcp_response

try:
    from src.smart_rag.tools.utilities.connector_tools import (
        _register_connector_response_sources,
    )
except ImportError:
    _register_connector_response_sources = None  # type: ignore[assignment]


class DummyToolContext:
    def __init__(self) -> None:
        self.state = {}


def test_normalize_mcp_response_extracts_sources_and_citations_from_inline_text():
    payload = {
        "status": "success",
        "contentMode": "inline_text",
        "text": "Quarterly revenue increased by 18%.",
        "item": {
            "name": "Q1-report.txt",
            "itemId": "item-123",
            "webUrl": "https://contoso.sharepoint.com/q1-report.txt",
        },
    }

    normalized = _normalize_mcp_response(payload, "fallback")

    assert normalized["text"] == "Quarterly revenue increased by 18%."
    assert "sources" not in normalized
    assert "citation_sources" not in normalized


def test_normalize_mcp_response_uses_workspace_id_as_text_workspace_name():
    payload = [
        {
            "workspace_id": "699ec209f4340d089727f766",
            "file_name": "30-recettes-preferees-des-francais.pdf",
            "source": "30-recettes-preferees-des-francais.pdf",
            "content": "1 verre a the d'huile d'olive",
            "page_number": 10,
        }
    ]

    normalized = _normalize_mcp_response(
        payload,
        fallback_text=str(payload),
        action_key="logicalsearchtest_locate_answer_citations",
    )

    assert normalized["citation_sources"][0]["workspace_id"] == "699ec209f4340d089727f766"
    assert normalized["citation_sources"][0]["workspace_name"] == "699ec209f4340d089727f766"


@pytest.mark.skipif(
    _register_connector_response_sources is None,
    reason="connector_tools not available in collection order",
)
def test_register_connector_response_sources_assigns_references_and_updates_text():
    tool_context = DummyToolContext()
    response = {
        "text": "Quarterly revenue increased by 18%.",
        "citation_sources": [
            {
                "type": "text",
                "source": "Q1-report.txt",
                "file_name": "item-123",
                "page": "",
                "page_content": "Quarterly revenue increased by 18%.",
                "workspace_name": "",
                "reference": "",
            }
        ],
    }

    updated = _register_connector_response_sources(
        response,
        tool_context,
        action_key="logicalsearchtest_locate_answer_citations",
    )

    assert updated["citation_sources"][0]["reference"] == "1"
    assert "Use citation [1]" in updated["text"]
    assert tool_context.state["_connector_text_sources"][0]["reference"] == "1"


@pytest.mark.skipif(
    _register_connector_response_sources is None,
    reason="connector_tools not available in collection order",
)
def test_register_connector_response_sources_reuses_existing_reference():
    tool_context = DummyToolContext()
    response = {
        "text": "Quarterly revenue increased by 18%.",
        "citation_sources": [
            {
                "type": "text",
                "source": "Q1-report.txt",
                "file_name": "item-123",
                "page": "",
                "page_content": "Quarterly revenue increased by 18%.",
                "workspace_name": "",
                "reference": "",
            }
        ],
    }

    first = _register_connector_response_sources(
        dict(response),
        tool_context,
        action_key="logicalsearchtest_locate_answer_citations",
    )
    second = _register_connector_response_sources(
        dict(response),
        tool_context,
        action_key="logicalsearchtest_locate_answer_citations",
    )

    assert first["citation_sources"][0]["reference"] == "1"
    assert second["citation_sources"][0]["reference"] == "1"
    assert len(tool_context.state["_connector_text_sources"]) == 1


def test_normalize_mcp_response_suppresses_citations_from_searchv2_result_blocks():
    payload = {
        "result": """
        [
          {
            "workspace_name": "69e643ae25a48c9410bff159",
            "file_name": "69e643d725a48c9410bff182",
            "source": "https://yssametachatbotdev001.blob.core.windows.net/metachatbot/6992fc709968567dc766a12d/69e643ae25a48c9410bff159/69e643d725a48c9410bff182/SLA_Indicateurs_Performance.docx",
            "block_id": "p0_b0",
            "block_type": "text",
            "content": "Les indicateurs de performance sont utilisés pour évaluer la qualité des services rendus.",
            "page_number": 0
          },
          {
            "workspace_name": "69e643ae25a48c9410bff159",
            "block_id": "p0_b6",
            "block_type": "paragraph_title",
            "content": "1. Objectifs de Niveau de Service (SLA)",
            "page_number": 0
          }
        ]
        """
    }

    normalized = _normalize_mcp_response(
        payload,
        "fallback",
        action_key="searchv2_search_document_blocks",
    )

    assert "citation_sources" not in normalized
    assert "sources" not in normalized


def test_normalize_mcp_response_extracts_citations_from_top_level_list_payload():
    payload = [
        {
            "workspace_name": "69e7a3d5f884ead008992093",
            "file_name": "69e7a3d9f884ead0089920a8",
            "source": "https://example.com/Contrat_Fourniture_Chantier_Caterpillar_Demonstration_(2).docx",
            "block_id": "p1_b0",
            "block_type": "text",
            "content": "Garantie constructeur standard de 2 ans.",
        },
        {
            "workspace_name": "69e7a3d5f884ead008992093",
            "file_name": "69e7a3d9f884ead0089920a8",
            "source": "https://example.com/Contrat_Fourniture_Chantier_Caterpillar_Demonstration_(2).docx",
            "block_id": "p1_b1",
            "block_type": "text",
            "content": "Penalites de 0,5 % par jour de retard.",
        },
    ]

    normalized = _normalize_mcp_response(
        payload,
        fallback_text=str(payload),
        action_key="get_page_blocks",
    )

    assert normalized["result"] == payload
    assert "citation_sources" not in normalized


def test_normalize_mcp_response_does_not_synthesize_read_section_citations():
    payload = {
        "source": "contract.pdf",
        "file_name": "contract.pdf",
        "content": "Warranty is two years.",
        "blocks": [
            {
                "content": "Warranty is two years.",
                "page_number": 4,
                "file_name": "contract.pdf",
                "source": "contract.pdf",
            }
        ],
    }

    normalized = _normalize_mcp_response(
        payload,
        fallback_text="fallback",
        action_key="sharepoint_read_section",
    )

    assert normalized["file_name"] == "contract.pdf"
    assert normalized["blocks"] == payload["blocks"]
    assert "citation_sources" not in normalized


def test_log_payload_redacts_image_base64_values():
    logged = _log_payload(
        {
            "images": [
                {
                    "image_id": "img-1",
                    "image_base64": "abc123",
                }
            ]
        }
    )

    assert "abc123" not in logged
    assert "[redacted base64 length=6]" in logged
