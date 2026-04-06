import json

from src.langgraph_engine.generate_playbook_prompt import build_generate_playbook_prompt


def test_build_generate_playbook_prompt_uses_registry_preprompt() -> None:
    prompt = build_generate_playbook_prompt(
        agents_info=[{"id": "agent-1", "name": "Planner"}],
        workspace_info=[{"workspace_id": "ws-1", "documents": ["brief.pdf"]}],
        existing_playbook_json='{"nodes": [], "edges": []}',
        prompt_overrides={
            "playbook.generate": json.dumps({
                "systemTemplate": "Custom autobuilder preprompt",
            }),
        },
    )

    assert prompt.startswith("Custom autobuilder preprompt")
    assert "## Format de sortie attendu (JSON strict)" in prompt
    assert "Playbook existant" in prompt
