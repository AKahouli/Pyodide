import sys
import types
from types import SimpleNamespace

import pytest


fake_settings = types.ModuleType("src.config.settings")
fake_settings.get_settings = lambda: SimpleNamespace(
    LITELLM_API_BASE_URL="http://localhost",
    LITELLM_API_SECRET_KEY="test-key",
)
sys.modules.setdefault("src.config.settings", fake_settings)

fake_correlation = types.ModuleType("src.middleware.correlation")
fake_correlation.get_user = lambda: "test-user"
sys.modules.setdefault("src.middleware.correlation", fake_correlation)

from src.flow_engine.nodes import step_hitl_handlers as handlers


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeChatOpenAI:
    responses: list[str] = []

    def __init__(self, **_kwargs: object) -> None:
        self.calls = 0

    async def ainvoke(self, _messages: object) -> SimpleNamespace:
        response = self.responses[self.calls]
        self.calls += 1
        return SimpleNamespace(content=response)


@pytest.mark.anyio
async def test_clarification_before_allows_bounded_multi_round_default(monkeypatch) -> None:
    fake_langchain_openai = types.ModuleType("langchain_openai")
    fake_langchain_openai.ChatOpenAI = FakeChatOpenAI
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai)
    FakeChatOpenAI.responses = ["Which country?", "Which lead type?", "CLEAR"]

    replies = iter([
        {"action": "reply", "message": "France", "scope": "downstream_run"},
        {"action": "reply", "message": "Distributors", "scope": "downstream_run"},
    ])
    monkeypatch.setattr(handlers, "interrupt", lambda _payload: next(replies))

    events: list[dict[str, object]] = []
    result = await handlers.handle_clarification_before(
        "step-1",
        "Lead search",
        "Search agro leads.",
        {"allowClarification": True},
        "test-model",
        events.append,
    )

    assert result.failed is False
    assert result.updated_description is not None
    assert "France" in result.updated_description
    assert "Distributors" in result.updated_description
    assert [event["payload"]["interrupt_id"] for event in events] == [
        "step-1:clarification:1",
        "step-1:clarification:2",
    ]


@pytest.mark.anyio
async def test_clarification_before_ignore_proceeds_without_limit_failure(monkeypatch) -> None:
    fake_langchain_openai = types.ModuleType("langchain_openai")
    fake_langchain_openai.ChatOpenAI = FakeChatOpenAI
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai)
    FakeChatOpenAI.responses = ["Which country?"]
    monkeypatch.setattr(
        handlers,
        "interrupt",
        lambda _payload: {"action": "reply", "message": "ignore these criterias", "scope": "downstream_run"},
    )

    result = await handlers.handle_clarification_before(
        "step-1",
        "Lead search",
        "Search agro leads.",
        {"allowClarification": True, "maxClarifications": 1},
        "test-model",
        lambda _event: None,
    )

    assert result.failed is False
    assert result.updated_description is not None
    assert "Proceed with the available information" in result.updated_description
    assert result.suppress_follow_up_clarification is True


@pytest.mark.anyio
async def test_clarification_before_limit_reached_proceeds_with_available_information(monkeypatch) -> None:
    fake_langchain_openai = types.ModuleType("langchain_openai")
    fake_langchain_openai.ChatOpenAI = FakeChatOpenAI
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai)
    FakeChatOpenAI.responses = ["Which country?", "Which lead type?"]

    replies = iter([
        {"action": "reply", "message": "France", "scope": "downstream_run"},
        {"action": "reply", "message": "Distributors", "scope": "downstream_run"},
    ])
    monkeypatch.setattr(handlers, "interrupt", lambda _payload: next(replies))

    result = await handlers.handle_clarification_before(
        "step-1",
        "Lead search",
        "Search agro leads.",
        {"allowClarification": True, "maxClarifications": 2},
        "test-model",
        lambda _event: None,
    )

    assert result.failed is False
    assert result.updated_description is not None
    assert "clarification round limit was reached" in result.updated_description
    assert result.suppress_follow_up_clarification is True


@pytest.mark.anyio
async def test_clarification_after_uses_next_round_and_reexecutes(monkeypatch) -> None:
    monkeypatch.setattr(
        handlers,
        "interrupt",
        lambda _payload: {"action": "reply", "message": "Distributors", "scope": "downstream_run"},
    )

    events: list[dict[str, object]] = []
    result = await handlers.handle_clarification_after(
        "step-1",
        "Lead search",
        "Search agro leads.",
        {"allowClarification": True},
        "What type of agro leads should I search for?",
        events.append,
        round_number=2,
    )

    assert result.needs_reexec is True
    assert result.updated_description is not None
    assert "Distributors" in result.updated_description
    assert events[0]["payload"]["interrupt_id"] == "step-1:clarification:2"


@pytest.mark.anyio
async def test_clarification_after_limit_reached_reexecutes_with_available_information() -> None:
    result = await handlers.handle_clarification_after(
        "step-1",
        "Lead search",
        "Search agro leads.",
        {"allowClarification": True, "maxClarifications": 3},
        "What type of agro leads should I search for?",
        lambda _event: None,
        round_number=4,
    )

    assert result.needs_reexec is True
    assert result.updated_description is not None
    assert "clarification round limit was reached" in result.updated_description
    assert result.suppress_follow_up_clarification is True


@pytest.mark.anyio
async def test_clarification_after_ignore_reexecutes_with_available_information(monkeypatch) -> None:
    monkeypatch.setattr(
        handlers,
        "interrupt",
        lambda _payload: {"action": "reply", "message": "Ignore", "scope": "downstream_run"},
    )

    result = await handlers.handle_clarification_after(
        "step-1",
        "Lead search",
        "Search agro leads.",
        {"allowClarification": True},
        "What type of agro leads should I search for?",
        lambda _event: None,
    )

    assert result.needs_reexec is True
    assert result.updated_description is not None
    assert "produce the best possible final result now" in result.updated_description
    assert result.suppress_follow_up_clarification is True
