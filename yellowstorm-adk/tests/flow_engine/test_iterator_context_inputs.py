from src.flow_engine.bindings.resolver import resolve_node_inputs


def test_resolve_iterator_inputs_keeps_items_and_context_ports() -> None:
    state = {
        "inputs": {},
        "task_outputs": {
            ("collect", 0): {"items": ["cv-a", "cv-b"]},
            ("template", 0): {"document": "template-docx"},
        },
        "iterations": {"collect": 1, "template": 1},
        "router_decisions": {},
    }
    bindings = [
        {
            "id": "items-binding",
            "source_kind": "node-output",
            "source_node": "collect",
            "source_port": "items",
            "target_node": "iterator",
            "target_port": "items",
            "iteration": "current",
        },
        {
            "id": "template-binding",
            "source_kind": "node-output",
            "source_node": "template",
            "source_port": "document",
            "target_node": "iterator",
            "target_port": "template",
            "iteration": "current",
        },
    ]

    resolved = resolve_node_inputs("iterator", bindings, state)

    assert resolved["items"] == ["cv-a", "cv-b"]
    assert resolved["template"] == "template-docx"
