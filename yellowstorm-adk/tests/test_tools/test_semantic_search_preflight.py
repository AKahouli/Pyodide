import asyncio

import pytest

from src.schema.chatbot_schema import AgentSuggestion, RunAgentTeamRequest
from src.smart_rag.tools.semantic_search_preflight import run_semantic_search_preflight


@pytest.mark.asyncio
async def test_preflight_runs_first_injects_result_and_removes_duplicate_tool(monkeypatch):
    calls = []

    async def semantic_search(query: str):
        calls.append(query)
        return {
            "documents": [{"title": "Guarantees", "score": 0.98}],
            "retrieval_scope": {
                "workspace_id": [" workspace-alice ", "workspace-bob", "workspace-alice"],
                "file_names": ["alice.pdf", "bob.pdf", "alice.pdf"],
            },
        }

    monkeypatch.setattr(
        "src.smart_rag.tools.semantic_search_preflight.create_semantic_search",
        lambda context: semantic_search,
    )
    agent = AgentSuggestion(
        id="agent-1",
        name="Agent",
        description="Agent",
        prompt="Answer",
        tools=[{"name": "semantic_search"}, {"name": "other_tool"}],
        agent_params={
            "semantic_model_schema_name": "sem_123",
            "semantic_search_url": "http://search/fused",
        },
    )
    request = RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="Quelles garanties ?",
        chatbot_name={"provider": "model"},
        agents=[agent],
        agent_mode="mono",
    )
    queue = asyncio.Queue()

    await run_semantic_search_preflight(request, queue)

    assert calls == ["Quelles garanties ?"]
    first = await queue.get()
    second = await queue.get()
    assert first["component"]["data"]["title"] == "semantic_search"
    assert first["component"]["data"]["status"] == "running"
    assert second["component"]["data"]["status"] == "completed"
    assert "Guarantees" in request.message
    assert 'workspace_id: ["workspace-alice", "workspace-bob"]' in request.message
    assert request.brain_ids == ["workspace-alice", "workspace-bob"]
    assert request.workspace_names == ["workspace-alice", "workspace-bob"]
    assert agent.brain_ids == ["workspace-alice", "workspace-bob"]
    assert agent.file_names == ["alice.pdf", "bob.pdf"]
    assert agent.tools == [{"name": "other_tool"}]


@pytest.mark.asyncio
async def test_preflight_ignores_unsafe_or_unscoped_retrieval_values(monkeypatch):
    async def semantic_search(_query: str):
        return {
            "retrieval_scope": {
                "workspace_id": ["workspace-ok", "workspace,bad", "line\nbreak", ""],
                "file_names": ["safe.pdf", "bad\rname.pdf"],
            },
        }

    monkeypatch.setattr(
        "src.smart_rag.tools.semantic_search_preflight.create_semantic_search",
        lambda context: semantic_search,
    )
    agent = AgentSuggestion(
        id="agent-1",
        name="Agent",
        description="Agent",
        prompt="Answer",
        agent_params={
            "semantic_model_schema_name": "sem_123",
            "semantic_search_url": "http://search/fused",
        },
    )
    request = RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="Question",
        chatbot_name={"provider": "model"},
        agents=[agent],
        agent_mode="mono",
    )

    await run_semantic_search_preflight(request, asyncio.Queue())

    assert request.brain_ids == ["workspace-ok"]
    assert agent.file_names == ["safe.pdf"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("scope", "expected_workspaces", "expected_files"),
    [
        ({"workspace_id": [], "file_names": ["only.pdf"]}, [], ["only.pdf"]),
        ({"workspace_id": ["workspace-only"], "file_names": []}, ["workspace-only"], []),
    ],
)
async def test_preflight_propagates_independent_scope_lists(
    monkeypatch, scope, expected_workspaces, expected_files
):
    async def semantic_search(_query: str):
        return {"retrieval_scope": scope}

    monkeypatch.setattr(
        "src.smart_rag.tools.semantic_search_preflight.create_semantic_search",
        lambda context: semantic_search,
    )
    agent = AgentSuggestion(
        id="agent-1",
        name="Agent",
        description="Agent",
        prompt="Answer",
        agent_params={
            "semantic_model_schema_name": "sem_123",
            "semantic_search_url": "http://search/fused",
        },
    )
    request = RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="Question",
        chatbot_name={"provider": "model"},
        agents=[agent],
        agent_mode="mono",
    )

    await run_semantic_search_preflight(request, asyncio.Queue())

    assert (request.brain_ids or []) == expected_workspaces
    assert agent.file_names == expected_files
    assert "Logical Search retrieval scope" in request.message


@pytest.mark.asyncio
async def test_preflight_emits_heartbeat_while_search_is_running(monkeypatch):
    async def semantic_search(_query: str):
        await asyncio.sleep(0.03)
        return {"documents": []}

    monkeypatch.setattr(
        "src.smart_rag.tools.semantic_search_preflight.create_semantic_search",
        lambda context: semantic_search,
    )
    monkeypatch.setattr(
        "src.smart_rag.tools.semantic_search_preflight.SEMANTIC_SEARCH_HEARTBEAT_SECONDS",
        0.01,
    )
    request = RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="Question",
        chatbot_name={"provider": "model"},
        agents=[AgentSuggestion(
            id="agent-1",
            name="Agent",
            description="Agent",
            prompt="Answer",
            agent_params={
                "semantic_model_schema_name": "sem_123",
                "semantic_search_url": "http://search/fused",
            },
        )],
        agent_mode="mono",
    )
    queue = asyncio.Queue()

    await run_semantic_search_preflight(request, queue)

    events = []
    while not queue.empty():
        events.append(await queue.get())
    assert events[0]["component"]["data"]["status"] == "running"
    assert any(
        event["component"]["data"]["status"] == "running"
        for event in events[1:-1]
    )
    assert events[-1]["component"]["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_preflight_is_noop_without_semantic_context():
    request = RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="Hello",
        chatbot_name={"provider": "model"},
        agents=[],
        agent_mode="mono",
    )
    queue = asyncio.Queue()

    await run_semantic_search_preflight(request, queue)

    assert request.message == "Hello"
    assert queue.empty()


@pytest.mark.asyncio
async def test_preflight_fails_before_agent_execution_when_search_fails(monkeypatch):
    async def semantic_search(_query: str):
        return {"error": "search unavailable"}

    monkeypatch.setattr(
        "src.smart_rag.tools.semantic_search_preflight.create_semantic_search",
        lambda context: semantic_search,
    )
    request = RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="Question",
        chatbot_name={"provider": "model"},
        agents=[AgentSuggestion(
            id="agent-1",
            name="Agent",
            description="Agent",
            prompt="Answer",
            agent_params={
                "semantic_model_schema_name": "sem_123",
                "semantic_search_url": "http://search/fused",
            },
        )],
        agent_mode="mono",
    )
    queue = asyncio.Queue()

    with pytest.raises(RuntimeError, match="required semantic search"):
        await run_semantic_search_preflight(request, queue)

    assert (await queue.get())["component"]["data"]["status"] == "running"
    assert (await queue.get())["component"]["data"]["status"] == "failed"
    assert request.message == "Question"


@pytest.mark.asyncio
async def test_preflight_closes_tool_event_when_executor_raises(monkeypatch):
    async def semantic_search(_query: str):
        raise TimeoutError("private endpoint details")

    monkeypatch.setattr(
        "src.smart_rag.tools.semantic_search_preflight.create_semantic_search",
        lambda context: semantic_search,
    )
    request = RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="Question",
        chatbot_name={"provider": "model"},
        agents=[AgentSuggestion(
            id="agent-1",
            name="Agent",
            description="Agent",
            prompt="Answer",
            agent_params={
                "semantic_model_schema_name": "sem_123",
                "semantic_search_url": "http://search/fused",
            },
        )],
        agent_mode="mono",
    )
    queue = asyncio.Queue()

    with pytest.raises(RuntimeError, match="required semantic search"):
        await run_semantic_search_preflight(request, queue)

    await queue.get()
    failed = await queue.get()
    assert failed["component"]["data"]["status"] == "failed"
    assert "private endpoint details" not in failed["component"]["data"]["result_json"]
