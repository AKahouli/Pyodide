import json

from src.flow_engine.generation.prompt import build_generate_playbook_prompt
from src.flow_engine.generation.prompt import (
    build_generate_playbook_prompt as build_generate_playbook_prompt_shim,
)


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


def test_prompt_includes_ports_in_json_schema() -> None:
    prompt = build_generate_playbook_prompt(
        agents_info=[{"id": "agent-1", "name": "Planner"}],
        workspace_info=[],
        existing_playbook_json=None,
    )

    assert '"inputPorts"' in prompt
    assert '"outputPorts"' in prompt
    assert '"artifactKind": "text"' in prompt
    assert '"id": "default"' in prompt
    assert '"name": "Input"' in prompt
    assert '"name": "Output"' in prompt


def test_prompt_includes_port_rules_section() -> None:
    prompt = build_generate_playbook_prompt(
        agents_info=[{"id": "agent-1", "name": "Planner"}],
        workspace_info=[],
        existing_playbook_json=None,
    )

    assert "## Regles des ports (inputPorts / outputPorts)" in prompt
    assert "OBLIGATOIRE" in prompt
    assert "artifactKind" in prompt
    assert '"document"' in prompt
    assert '"code"' in prompt
    assert '"image"' in prompt
    assert '"data"' in prompt
    assert '"dashboard"' in prompt


def test_prompt_includes_task_type_in_schema() -> None:
    prompt = build_generate_playbook_prompt(
        agents_info=[{"id": "agent-1", "name": "Planner"}],
        workspace_info=[],
        existing_playbook_json=None,
    )

    assert '"task_type": "generic"' in prompt


def test_modification_mode_includes_port_preservation_rule() -> None:
    prompt = build_generate_playbook_prompt(
        agents_info=[{"id": "agent-1", "name": "Planner"}],
        workspace_info=[],
        existing_playbook_json='{"nodes": [], "edges": []}',
    )

    assert "Regles de modification des ports" in prompt
    assert "conservent leurs inputPorts et outputPorts" in prompt


def test_langgraph_generate_playbook_prompt_shim_delegates() -> None:
    prompt = build_generate_playbook_prompt_shim(
        agents_info=[{"id": "agent-1", "name": "Planner"}],
        workspace_info=[],
        existing_playbook_json=None,
    )

    assert '"inputPorts"' in prompt
