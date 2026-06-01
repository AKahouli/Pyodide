import asyncio

import pytest

from src.grpc_server.chatbot_servicer import _put_progress_event, ChatbotServicer


def test_dict_to_stream_chunk_artifact_uses_object_key_fallback() -> None:
    servicer = ChatbotServicer(agent_team_service=None)

    chunk = servicer._dict_to_stream_chunk(
        {
            "action": "add",
            "component": {
                "id": "component-1",
                "type": "artifact",
                "data": {
                    "filename": "report.xlsx",
                    "object_key": "user/session/report.xlsx",
                },
            },
            "metadata": {"message_id": "message-1"},
        }
    )

    assert chunk.component.artifact.file_path == "user/session/report.xlsx"


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
async def test_put_progress_event_prefers_latest_interrupt_over_older_interrupt() -> (
    None
):
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
async def test_stream_playbook_queue_raises_cancelled_error_for_cancelled_task() -> (
    None
):
    queue: asyncio.Queue = asyncio.Queue()
    servicer = ChatbotServicer(agent_team_service=None)

    bg_task = asyncio.create_task(asyncio.sleep(10))
    bg_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        async for _ in servicer._stream_playbook_queue(queue, bg_task, "thread-1"):
            pass
