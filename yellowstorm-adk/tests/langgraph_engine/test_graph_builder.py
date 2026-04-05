from src.langgraph_engine.graph_builder import _extract_artifacts_from_components


def test_extract_artifacts_assigns_same_kind_file_outputs_in_port_order() -> None:
    artifacts = _extract_artifacts_from_components(
        [
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "https://example.com/report.pdf",
                    "filename": "report.pdf",
                },
            },
            {
                "type": "artifact",
                "data": {
                    "artifact_kind": "document",
                    "file_path": "https://example.com/deck.pptx",
                    "filename": "deck.pptx",
                },
            }
        ],
        {
            "output_ports": [
                {"id": "out-pdf", "name": "PDF", "artifact_kind": "document"},
                {"id": "out-pptx", "name": "pptx", "artifact_kind": "document"},
            ]
        },
    )

    assert artifacts == [
        {
            "port_id": "out-pdf",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
        },
        {
            "port_id": "out-pptx",
            "artifact_kind": "document",
            "url": "https://example.com/deck.pptx",
            "filename": "deck.pptx",
        }
    ]
