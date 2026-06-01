import asyncio
from types import SimpleNamespace

import pytest

from src.grpc_server.chatbot_servicer import _put_progress_event, ChatbotServicer


@pytest.mark.asyncio
async def test_put_progress_event_keeps_queue_bounded() -> None:
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)

    await _put_progress_event(queue, {"status": "in_progress", "output": "old"})
    await _put_progress_event(queue, {"status": "in_progress", "output": "new"})

    assert queue.qsize() == 1
    assert await queue.get() == {"status": "in_progress", "output": "new"}


@pytest.mark.asyncio
async def test_put_progress_event_keeps_interrupt_over_progress_update() -> None:
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)

    interrupt_item = {
        "step_update": {"status": "suspended", "interrupt": {"type": "clarification"}}
    }
    progress_item = {
        "step_update": {"status": "in_progress", "result": {"output": "draft"}}
    }

    await _put_progress_event(queue, interrupt_item)
    await _put_progress_event(queue, progress_item)

    assert queue.qsize() == 1
    assert await queue.get() == interrupt_item


@pytest.mark.asyncio
async def test_put_progress_event_replaces_progress_with_terminal_update() -> None:
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)

    await _put_progress_event(
        queue, {"step_update": {"status": "in_progress", "result": {"output": "draft"}}}
    )
    terminal_item = {
        "step_update": {"status": "completed", "result": {"status": "completed"}}
    }
    await _put_progress_event(queue, terminal_item)

    assert queue.qsize() == 1
    assert await queue.get() == terminal_item


@pytest.mark.asyncio
async def test_put_progress_event_prefers_latest_interrupt_over_older_interrupt() -> None:
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)

    older_interrupt = {
        "step_update": {
            "status": "suspended",
            "interrupt": {"type": "clarification", "round": 1},
        }
    }
    newer_interrupt = {
        "step_update": {
            "status": "suspended",
            "interrupt": {"type": "clarification", "round": 2},
        }
    }

    await _put_progress_event(queue, older_interrupt)
    await _put_progress_event(queue, newer_interrupt)

    assert queue.qsize() == 1
    assert await queue.get() == newer_interrupt


@pytest.mark.asyncio
async def test_stream_playbook_queue_raises_background_exception() -> None:
    queue: asyncio.Queue = asyncio.Queue()
    bg_task = asyncio.create_task(asyncio.sleep(0))
    await bg_task

    servicer = ChatbotServicer(agent_team_service=None)

    async def fail() -> None:
        raise RuntimeError("boom")

    bg_task = asyncio.create_task(fail())

    with pytest.raises(RuntimeError, match="boom"):
        async for _ in servicer._stream_playbook_queue(queue, bg_task, "thread-1"):
            pass


@pytest.mark.asyncio
async def test_stream_playbook_queue_raises_cancelled_error_for_cancelled_task() -> None:
    queue: asyncio.Queue = asyncio.Queue()
    servicer = ChatbotServicer(agent_team_service=None)

    bg_task = asyncio.create_task(asyncio.sleep(10))
    bg_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        async for _ in servicer._stream_playbook_queue(queue, bg_task, "thread-1"):
            pass


@pytest.mark.asyncio
async def test_convert_agent_team_request_v2_preserves_connector_repo() -> None:
    servicer = ChatbotServicer(agent_team_service=None)

    manager_agent = SimpleNamespace(
        agent_type="manager",
        id="agent-1",
        name="Manager",
        description="Manager agent",
        prompt="Manager prompt",
        tools=[],
        brain_context=[],
        agent_params=SimpleNamespace(params={}),
        save_memory=False,
        skills=[],
        chatbot=SimpleNamespace(model="anthropic/claude-sonnet-4-5"),
        HasField=lambda field: field in {"chatbot", "agent_params"},
    )

    pb_request = SimpleNamespace(
        workspace_context=[],
        attached_files=[],
        previous_attached_files=[],
        agents=[manager_agent],
        user_context=SimpleNamespace(user_id="user-1"),
        conversation_id="conv-1",
        query="create a pull request",
        agent_mode="manual",
        connector_repo=SimpleNamespace(
            connector_id="connector-1",
            connector_name="GitHub",
            repo_id="repo-1",
            repo_name="org-name/repo-name",
            repo_url="https://github.com/org-name/repo-name",
        ),
    )

    converted = await servicer._convert_agent_team_request_v2(pb_request)

    assert converted.connector_repo == {
        "connector_id": "connector-1",
        "connector_name": "GitHub",
        "repo_id": "repo-1",
        "repo_name": "org-name/repo-name",
        "repo_url": "https://github.com/org-name/repo-name",
    }
