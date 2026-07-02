from __future__ import annotations

import pytest

from src.flow_engine.nodes.router import run_router
from src.flow_engine.nodes.router_conditions import (
    RouterConditionSourceUnavailableError,
    choose_deterministic_label,
)


def make_state(task_outputs):
    return {
        "execution_id": "exec-1",
        "flow_id": "flow-1",
        "inputs": {},
        "task_outputs": task_outputs,
        "iterations": {"step-1": 1},
        "router_decisions": {},
        "errors": [],
        "pending_approval": None,
        "cancelled": False,
    }


def test_choose_deterministic_label_matches_structured_output_path():
    decision = choose_deterministic_label(
        {
            "router_config": {
                "output_labels": ["invalid", "valid"],
                "default_label": "invalid",
                "conditions": [{
                    "label": "valid",
                    "source_node": "step-1",
                    "source_port": "result",
                    "path": "verdict",
                    "operator": "equals",
                    "value": "valid",
                }],
            },
        },
        make_state({
            ("step-1", 0): {
                "outputs": {
                    "result": {
                        "content": {"verdict": "valid"},
                    },
                },
            },
        }),
    )

    assert decision == {
        "label": "valid",
        "matched_condition_index": 0,
        "used_default": False,
        "mode": "deterministic",
    }


def test_choose_deterministic_label_uses_default_when_no_condition_matches():
    decision = choose_deterministic_label(
        {
            "router_config": {
                "output_labels": ["invalid", "valid"],
                "default_label": "invalid",
                "conditions": [{
                    "label": "valid",
                    "source_node": "step-1",
                    "source_port": "result",
                    "path": "score",
                    "operator": "gt",
                    "value": 90,
                }],
            },
        },
        make_state({
            ("step-1", 0): {
                "outputs": {
                    "result": {
                        "content": {"score": 70},
                    },
                },
            },
        }),
    )

    assert decision == {
        "label": "invalid",
        "matched_condition_index": None,
        "used_default": True,
        "mode": "deterministic",
    }


def test_choose_deterministic_label_fails_when_source_output_is_unavailable():
    with pytest.raises(RouterConditionSourceUnavailableError, match="step-1"):
        choose_deterministic_label(
            {
                "router_config": {
                    "output_labels": ["invalid", "valid"],
                    "default_label": "invalid",
                    "conditions": [{
                        "label": "valid",
                        "source_node": "step-1",
                        "source_port": "result",
                        "path": "verdict",
                        "operator": "equals",
                        "value": "valid",
                    }],
                },
            },
            make_state({}),
        )


def test_choose_deterministic_label_supports_legacy_output_fallback():
    decision = choose_deterministic_label(
        {
            "router_config": {
                "output_labels": ["retry", "done"],
                "default_label": "retry",
                "conditions": [{
                    "label": "done",
                    "source_node": "step-1",
                    "source_port": "result",
                    "path": "verdict",
                    "operator": "equals",
                    "value": "done",
                }],
            },
        },
        make_state({
            ("step-1", 0): {
                "output": {
                    "result": {"verdict": "done"},
                },
            },
        }),
    )

    assert decision is not None
    assert decision["label"] == "done"


def test_choose_deterministic_label_matches_numeric_equals_values():
    decision = choose_deterministic_label(
        {
            "router_config": {
                "output_labels": ["retry", "done"],
                "default_label": "retry",
                "conditions": [{
                    "label": "done",
                    "source_node": "step-1",
                    "source_port": "result",
                    "path": "score",
                    "operator": "equals",
                    "value": "42",
                }],
            },
        },
        make_state({
            ("step-1", 0): {
                "outputs": {
                    "result": {
                        "content": {"score": 42},
                    },
                },
            },
        }),
    )

    assert decision is not None
    assert decision["label"] == "done"


def test_choose_deterministic_label_reads_router_input_with_json_path():
    decision = choose_deterministic_label(
        {
            "router_config": {
                "output_labels": ["pdf", "other"],
                "default_label": "other",
                "conditions": [{
                    "label": "pdf",
                    "source_node": "router-1",
                    "source_port": "file_data",
                    "path": "$.path",
                    "operator": "contains",
                    "value": ".pdf",
                }],
            },
        },
        make_state({}),
        node_id="router-1",
        node_inputs={"file_data": {"path": "folder/report.pdf"}},
    )

    assert decision is not None
    assert decision["label"] == "pdf"


def test_choose_deterministic_label_reads_iterator_item_for_self_input():
    state = make_state({})
    state["inputs"] = {"_item": {"path": "folder/report.xlsx"}}

    decision = choose_deterministic_label(
        {
            "router_config": {
                "output_labels": ["xlsx", "other"],
                "default_label": "other",
                "conditions": [{
                    "label": "xlsx",
                    "source_node": "router-1",
                    "source_port": "file_data",
                    "path": "$.path",
                    "operator": "contains",
                    "value": ".xlsx",
                }],
            },
        },
        state,
        node_id="router-1",
        node_inputs={},
    )

    assert decision is not None
    assert decision["label"] == "xlsx"


def test_choose_deterministic_label_does_not_mask_bound_none_self_input():
    state = make_state({})
    state["inputs"] = {"_item": {"path": "folder/report.xlsx"}}

    decision = choose_deterministic_label(
        {
            "router_config": {
                "output_labels": ["xlsx", "other"],
                "default_label": "other",
                "conditions": [{
                    "label": "xlsx",
                    "source_node": "router-1",
                    "source_port": "file_data",
                    "path": "$.path",
                    "operator": "contains",
                    "value": ".xlsx",
                }],
            },
        },
        state,
        node_id="router-1",
        node_inputs={"file_data": None},
    )

    assert decision is not None
    assert decision["label"] == "other"


@pytest.mark.asyncio
async def test_run_router_skips_llm_when_deterministic_conditions_exist(monkeypatch):
    emitted = []

    monkeypatch.setattr('src.flow_engine.nodes.router.get_stream_writer', lambda: emitted.append)

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError('LLM should not be called for deterministic routers')

    monkeypatch.setattr('src.flow_engine.nodes.router.litellm.acompletion', fail_if_called)

    result = await run_router(
        'router-1',
        {
            'router_config': {
                'output_labels': ['invalid', 'valid'],
                'default_label': 'invalid',
                'conditions': [{
                    'label': 'valid',
                    'source_node': 'step-1',
                    'source_port': 'result',
                    'path': 'verdict',
                    'operator': 'equals',
                    'value': 'valid',
                }],
            },
        },
        make_state({
            ('step-1', 0): {
                'outputs': {
                    'result': {
                        'content': {'verdict': 'valid'},
                    },
                },
            },
        }),
    )

    assert result['router_decisions'] == {'router-1': 'valid'}
    assert any(event['type'] == 'RouterDecision' and event['payload']['mode'] == 'deterministic' for event in emitted)


@pytest.mark.asyncio
async def test_run_router_fails_when_deterministic_source_output_is_unavailable(monkeypatch):
    emitted = []

    monkeypatch.setattr('src.flow_engine.nodes.router.get_stream_writer', lambda: emitted.append)

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError('LLM should not be called for deterministic routers')

    monkeypatch.setattr('src.flow_engine.nodes.router.litellm.acompletion', fail_if_called)

    with pytest.raises(RouterConditionSourceUnavailableError, match='step-1'):
        await run_router(
            'router-1',
            {
                'router_config': {
                    'output_labels': ['invalid', 'valid'],
                    'default_label': 'invalid',
                    'conditions': [{
                        'label': 'valid',
                        'source_node': 'step-1',
                        'source_port': 'result',
                        'path': 'verdict',
                        'operator': 'equals',
                        'value': 'valid',
                    }],
                },
            },
            make_state({}),
        )

    assert any(event['type'] == 'NodeStarted' for event in emitted)
    assert any(event['type'] == 'NodeFailed' for event in emitted)
    assert not any(event['type'] == 'NodeCompleted' for event in emitted)
    assert not any(event['type'] == 'RouterDecision' for event in emitted)
