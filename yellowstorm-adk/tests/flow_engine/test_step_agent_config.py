from src.flow_engine.nodes.step_agent_config import build_agent_config


def test_build_agent_config_preserves_tools_skills_and_brain_ids() -> None:
    config = build_agent_config(
        {
            "agent_name": "Target",
            "agent_type": "mono-agent",
            "agent_params": {"user_id": "u1"},
            "agent_tools": [{"name": "search"}, "ignored"],
            "skills": [{"id": "s1"}, "ignored"],
            "brain_context": [{"workspace_id": "ws1"}, {"workspace_id": "ws2"}],
        }
    )

    assert config["name"] == "Target"
    assert config["type"] == "mono-agent"
    assert config["agent_params"] == {"user_id": "u1"}
    assert config["tools"] == [{"name": "search"}]
    assert config["skills"] == [{"id": "s1"}]
    assert config["brain_ids"] == ["ws1", "ws2"]


def test_build_agent_config_forwards_conversation_parity_model_knobs() -> None:
    config = build_agent_config(
        {
            "agent_name": "Target",
            "agent_model": "openai/gpt-5",
            "agent_reasoning_effort": "high",
            "agent_input_modalities": ["text", "image", 3],
            "agent_context_window_tokens": 128000,
            "agent_compaction": {"enabled": True, "compaction_interval": 5},
        }
    )

    assert config["model"] == "openai/gpt-5"
    assert config["reasoning_effort"] == "high"
    assert config["input_modalities"] == ["text", "image", "3"]
    assert config["context_window_tokens"] == 128000
    assert config["compaction"] == {"enabled": True, "compaction_interval": 5}


def test_build_agent_config_defaults_absent_or_invalid_knobs() -> None:
    config = build_agent_config(
        {
            "agent_name": "Target",
            "agent_reasoning_effort": "",
            "agent_input_modalities": "not-a-list",
            "agent_context_window_tokens": 0,
            "agent_compaction": "not-a-dict",
        }
    )

    assert config["model"] == ""
    assert config["reasoning_effort"] is None
    assert config["input_modalities"] == []
    assert config["context_window_tokens"] is None
    assert config["compaction"] is None
