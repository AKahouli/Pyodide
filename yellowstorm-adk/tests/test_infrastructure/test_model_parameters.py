import pytest
from types import SimpleNamespace

from src.smart_rag.infrastructure.model_parameters import (
    get_context_window_for_model,
    get_reasoning_effort_for_model,
    normalize_messages_for_model,
    register_model_input_modalities,
    resolve_model_config,
)


def test_text_only_messages_keep_text_and_tool_linkage_without_mutating_input():
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Inspect this image"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        },
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "search", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call-1", "content": "result"},
    ]

    register_model_input_modalities("text-only-model", ["text"])
    normalized = normalize_messages_for_model("text-only-model", messages)

    assert normalized[0]["content"] == [
        {"type": "text", "text": "Inspect this image"}
    ]
    assert normalized[1] == messages[1]
    assert normalized[2] == messages[2]
    assert messages[0]["content"][1]["type"] == "image_url"


def test_text_only_message_with_only_unsupported_parts_uses_absent_content():
    messages = [
        {
            "role": "assistant",
            "content": [{"type": "image_url", "image_url": {"url": "redacted"}}],
            "tool_calls": [{"id": "call-1"}],
        }
    ]

    register_model_input_modalities("tool-model", ["text"])
    normalized = normalize_messages_for_model("tool-model", messages)

    assert normalized == [
        {"role": "assistant", "content": None, "tool_calls": [{"id": "call-1"}]}
    ]


def test_unconfigured_messages_preserve_multimodal_content():
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Inspect this image"},
                {"type": "image_url", "image_url": {"url": "redacted"}},
            ],
        }
    ]

    assert normalize_messages_for_model("azure/gpt-5.4", messages) is messages


def test_text_only_messages_remove_every_non_text_block_type():
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Use the available context"},
                {"type": "input_audio", "input_audio": {"data": "redacted"}},
                {"type": "file", "file": {"file_id": "redacted"}},
            ],
        }
    ]

    register_model_input_modalities("other-text-model", ["text"])
    normalized = normalize_messages_for_model("other-text-model", messages)

    assert normalized[0]["content"] == [
        {"type": "text", "text": "Use the available context"}
    ]


def test_image_capable_messages_preserve_image_blocks():
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Inspect this image"},
            {"type": "image_url", "image_url": {"url": "redacted"}},
        ],
    }]
    register_model_input_modalities("vision-model", ["text", "image"])

    assert normalize_messages_for_model("vision-model", messages) is messages


def test_llm_factory_registers_modalities_from_model_config():
    from src.smart_rag.infrastructure.factories.llm_factory import _resolve_model_config

    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "question"},
            {"type": "image_url", "image_url": {"url": "redacted"}},
        ],
    }]

    model_name = _resolve_model_config({
        "provider": "factory-text-model",
        "input_modalities": ["text"],
    })

    assert model_name == "factory-text-model"
    assert normalize_messages_for_model(model_name, messages)[0]["content"] == [
        {"type": "text", "text": "question"}
    ]


def test_model_config_registers_reasoning_effort_and_context_capacity():
    model_name = resolve_model_config({
        "provider": "openai/reasoning-model",
        "reasoning_effort": "high",
        "context_window_tokens": 128000,
    })

    assert get_reasoning_effort_for_model(model_name) == "high"
    assert get_context_window_for_model("reasoning-model") == 128000


@pytest.mark.parametrize(
    ("modalities", "expected_types"),
    [
        (["text"], ["text"]),
        (["text", "image"], ["text", "image_url"]),
    ],
)
def test_delegated_agent_runtime_applies_transported_modalities(modalities, expected_types):
    from src.smart_rag.agents.factories.delegation_factory_helper import prepare_agent_data

    config = SimpleNamespace(brain_ids=[], vectorstore_name="default")
    agent_config = {
        "brain_documents": [],
        "brain_relations": {},
        "brain_ids": [],
        "tools": [],
        "chatbot_name": {
            "provider": f"delegated-{'-'.join(modalities)}",
            "input_modalities": modalities,
        },
    }
    *_, model_name = prepare_agent_data(None, config, agent_config, [], "prompt", "fallback")
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "question"},
            {"type": "image_url", "image_url": {"url": "redacted"}},
        ],
    }]

    normalized = normalize_messages_for_model(model_name, messages)

    assert [part["type"] for part in normalized[0]["content"]] == expected_types


@pytest.mark.asyncio
async def test_litellm_patch_normalizes_keyword_and_positional_text_only_messages(monkeypatch):
    import litellm

    from src.evaluation.agent_evaluator import apply_litellm_debug_patch

    calls = []

    async def async_completion(model, messages, **kwargs):
        calls.append(("async", model, messages, kwargs))
        return "async-result"

    def sync_completion(model, messages, **kwargs):
        calls.append(("sync", model, messages, kwargs))
        return "sync-result"

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "question"},
                {"type": "image_url", "image_url": {"url": "redacted"}},
            ],
        }
    ]
    monkeypatch.delattr(litellm, "_is_yellowstorm_patched", raising=False)
    monkeypatch.setattr(litellm, "acompletion", async_completion)
    monkeypatch.setattr(litellm, "completion", sync_completion)
    register_model_input_modalities("text-boundary-model", ["text"])

    apply_litellm_debug_patch()

    assert await litellm.acompletion(
        "text-boundary-model", messages, num_retries=0
    ) == "async-result"
    assert litellm.completion(
        model="text-boundary-model", messages=messages, num_retries=0
    ) == "sync-result"
    assert calls[0][1] == "azure/text-boundary-model"
    assert "model" not in calls[0][3]
    assert calls[0][3]["num_retries"] == 0
    assert calls[0][3]["timeout"] == 700  # async path carries the judge timeout bump
    assert calls[0][2][0]["content"] == [{"type": "text", "text": "question"}]
    assert calls[1][1] == "azure/text-boundary-model"
    assert calls[1][2][0]["content"] == [{"type": "text", "text": "question"}]
    assert calls[1][3]["num_retries"] == 0
    assert calls[1][3]["timeout"] == 300
