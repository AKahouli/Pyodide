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


@pytest.mark.asyncio
async def test_litellm_patch_preserves_caller_timeout(monkeypatch):
    import litellm

    from src.evaluation.agent_evaluator import apply_litellm_debug_patch

    calls = []

    async def async_completion(*args, **kwargs):
        calls.append(("async", kwargs))
        return "async-result"

    def sync_completion(*args, **kwargs):
        calls.append(("sync", kwargs))
        return "sync-result"

    monkeypatch.delattr(litellm, "_is_yellowstorm_patched", raising=False)
    monkeypatch.setattr(litellm, "acompletion", async_completion)
    monkeypatch.setattr(litellm, "completion", sync_completion)

    apply_litellm_debug_patch()

    assert await litellm.acompletion(model="test-model", messages=[], timeout=90) == "async-result"
    assert litellm.completion(model="test-model", messages=[], timeout=90) == "sync-result"
    assert calls == [("async", {"model": "azure/test-model", "messages": [], "timeout": 90}),
                     ("sync", {"model": "azure/test-model", "messages": [], "timeout": 90})]


# --- compaction resolution (configurable ADK context compaction) ---
from src.smart_rag.infrastructure.model_parameters import (  # noqa: E402
    _resolve_request_compaction,
    get_request_compaction_config,
    set_request_compaction_config,
)


def _base(**over):
    cfg = {
        "enabled": True,
        "compaction_interval": 10,
        "overlap_size": 2,
        "token_fraction": 0.75,
        "event_retention_size": 6,
        "summarizer_model": "",
    }
    cfg.update(over)
    return cfg


def test_resolve_derives_token_threshold_from_fraction_and_window():
    r = _resolve_request_compaction(_base(), "azure/gpt-4.1", 200_000)
    assert (r.compaction_interval, r.overlap_size) == (10, 2)
    assert r.token_threshold == 150_000 and r.event_retention_size == 6
    assert r.summarizer_model == "azure/gpt-4.1"  # empty falls back to chat model


def test_resolve_disabled_returns_none():
    assert _resolve_request_compaction(_base(enabled=False), "m", 1000) is None


def test_resolve_unknown_window_skips_token_pair_keeps_sliding():
    r = _resolve_request_compaction(_base(), "m", None)
    assert r.token_threshold is None and r.event_retention_size is None
    assert r.compaction_interval == 10


def test_resolve_no_usable_trigger_returns_none():
    assert _resolve_request_compaction(
        _base(compaction_interval=0, token_fraction=0.0), "m", 1000
    ) is None


def test_resolve_keeps_explicit_summarizer_model():
    r = _resolve_request_compaction(_base(summarizer_model="azure/gpt-4.1-mini"), "m", 1000)
    assert r.summarizer_model == "azure/gpt-4.1-mini"


def test_resolve_model_config_wires_and_subagent_does_not_clobber():
    set_request_compaction_config(None)
    resolve_model_config({
        "provider": "azure/gpt-4.1", "context_window_tokens": 128_000,
        "compaction": _base(compaction_interval=8, token_fraction=0.5),
    })
    g = get_request_compaction_config()
    assert g is not None and g.token_threshold == 64_000
    # a later sub-agent config without compaction must not wipe the request config
    resolve_model_config({"provider": "other/model", "context_window_tokens": 4096})
    assert get_request_compaction_config() is g
