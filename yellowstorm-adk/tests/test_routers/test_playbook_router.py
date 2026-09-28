"""Unit tests for playbook router endpoints."""

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from src.schema.playbook import RunPlaybookStepRequest
from src.schema.chatbot_schema import AgentSuggestion


@pytest.fixture
def mock_current_user():
    """Mock current user for authentication."""
    user = MagicMock()
    user.username = "test_user"
    user.user_id = "user_123"
    return user


@pytest.fixture
def mock_agent_suggestion():
    """Mock AgentSuggestion for testing."""
    return AgentSuggestion(
        id="agent-123",
        name="Test Agent",
        description="A test agent for testing",
        prompt="You are a helpful test agent",
        tools=[{"name": "search", "top_k": 3}],
        chatbot_name={"provider": "gpt-4"},
        workspace_names=["brain-1"],
        save_memory=False
    )


@pytest.fixture
def mock_manager_suggestion():
    """Mock Manager AgentSuggestion for testing."""
    return AgentSuggestion(
        id="manager-123",
        name="Manager Agent",
        description="A manager agent for coordination",
        prompt="You are a manager that coordinates agents",
        chatbot_name={"provider": "gpt-4"},
        workspace_names=[],
        agent_type="manager"
    )


@pytest.fixture
def mock_playbook_request(mock_agent_suggestion, mock_manager_suggestion):
    """Mock RunPlaybookStepRequest for testing."""
    return RunPlaybookStepRequest(
        messageId="msg-12345",
        userId="user-123",
        taskId="task-456",
        taskDescription="Complete this task",
        task_metadata={"priority": "high"},
        result="Previous result",
        order=1,
        agent=mock_agent_suggestion,
        manager_agent=mock_manager_suggestion,
        call_id="call-789",
        vectorstore_name="test-vectorstore"
    )


class TestExecutePlaybookStepEndpoint:
    """Test cases for execute_playbook_step endpoint."""

    @pytest.mark.asyncio
    async def test_execute_playbook_step_success(self, mock_playbook_request, mock_current_user):
        """Test successful playbook step execution with streaming."""
        with patch('src.routers.playbook.execute_playbook_step') as mock_execute:
            # Setup mock to simulate successful execution
            async def mock_execution(request, queue):
                # Simulate sending some events
                await queue.put({
                    "agent_id": "test-agent",
                    "content": "Starting execution",
                    "type": "start"
                })
                await queue.put({
                    "agent_id": "test-agent",
                    "content": "Processing...",
                    "type": "progress"
                })
                await queue.put({
                    "success": True,
                    "result": "Task completed",
                    "type": "complete"
                })
                # Signal completion
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_step_endpoint

            # Call endpoint
            response = await execute_playbook_step_endpoint(
                request=mock_playbook_request,
                user=mock_current_user
            )

            # Assertions
            assert isinstance(response, StreamingResponse)
            assert response.media_type == "text/event-stream"
            assert response.headers["Cache-Control"] == "no-cache"
            assert response.headers["Connection"] == "keep-alive"
            assert response.headers["X-Accel-Buffering"] == "no"

            # Collect events from stream
            events = []
            async for chunk in response.body_iterator:
                chunk_str = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                if chunk_str.startswith("data: "):
                    event_data = chunk_str[6:].strip()
                    if event_data:
                        events.append(json.loads(event_data))

            # Verify events were streamed
            assert len(events) >= 3
            assert events[-1]["success"] is True
            assert events[-1]["result"] == "Task completed"


    @pytest.mark.asyncio
    async def test_execute_playbook_step_streaming(self, mock_playbook_request, mock_current_user):
        """Test that streaming works correctly for multiple events."""
        with patch('src.routers.playbook.execute_playbook_step') as mock_execute:
            # Setup mock to send multiple events
            async def mock_execution(request, queue):
                # Send multiple events to test streaming
                for i in range(5):
                    await queue.put({"progress": i * 20, "status": "processing"})
                await queue.put({"success": True, "result": "Done"})
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_step_endpoint

            # Call endpoint
            response = await execute_playbook_step_endpoint(
                request=mock_playbook_request,
                user=mock_current_user
            )

            # Collect all events from stream
            events = []
            async for chunk in response.body_iterator:
                chunk_str = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                if chunk_str.startswith("data: "):
                    event_data = chunk_str[6:].strip()
                    if event_data:
                        events.append(json.loads(event_data))

            # Should have received all events
            assert len(events) == 6  # 5 progress events + 1 final event
            assert events[-1]["success"] is True
            assert events[-1]["result"] == "Done"

    @pytest.mark.asyncio
    async def test_execute_playbook_step_logging(self, mock_playbook_request, mock_current_user):
        """Test that proper logging occurs during execution."""
        with patch('src.routers.playbook.execute_playbook_step') as mock_execute:
            with patch('src.routers.playbook.logger') as mock_logger:
                # Setup mock
                async def mock_execution(request, queue):
                    await queue.put({"success": True})
                    await queue.put(None)

                mock_execute.side_effect = mock_execution

                from src.routers.playbook import execute_playbook_step_endpoint

                # Call endpoint
                response = await execute_playbook_step_endpoint(
                    request=mock_playbook_request,
                    user=mock_current_user
                )

                # Consume the stream
                async for _ in response.body_iterator:
                    pass

                # Verify logging calls
                assert mock_logger.info.called
                # Check that initial log contains task info
                initial_log_calls = [
                    call for call in mock_logger.info.call_args_list
                    if "Executing playbook_dir step" in str(call) or "PLAYBOOK ROUTER" in str(call)
                ]
                assert len(initial_log_calls) > 0

    @pytest.mark.asyncio
    async def test_execute_playbook_step_error_handling(self, mock_playbook_request, mock_current_user):
        """Test error handling when execution fails."""
        with patch('src.routers.playbook.execute_playbook_step') as mock_execute:
            # Setup mock to send error event
            async def mock_execution(request, queue):
                # Send an error event instead of raising exception
                await queue.put({
                    "success": False,
                    "error": "Test error during execution",
                    "type": "error"
                })
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_step_endpoint

            # Call endpoint
            response = await execute_playbook_step_endpoint(
                request=mock_playbook_request,
                user=mock_current_user
            )

            # Collect events
            events = []
            async for chunk in response.body_iterator:
                chunk_str = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                if chunk_str.startswith("data: "):
                    event_data = chunk_str[6:].strip()
                    if event_data:
                        events.append(json.loads(event_data))

            # Verify error is reported in event
            assert len(events) == 1
            assert events[0]["success"] is False
            assert "Test error during execution" in events[0]["error"]

    @pytest.mark.asyncio
    async def test_execute_playbook_step_client_disconnect(self, mock_playbook_request, mock_current_user):
        """Test handling of client disconnection during streaming."""
        with patch('src.routers.playbook.execute_playbook_step') as mock_execute:
            # Setup mock
            async def mock_execution(request, queue):
                await queue.put({"status": "started"})
                # Simulate long running task
                await asyncio.sleep(0.1)
                await queue.put({"status": "processing"})
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_step_endpoint

            # Call endpoint
            response = await execute_playbook_step_endpoint(
                request=mock_playbook_request,
                user=mock_current_user
            )

            # Simulate client disconnect by cancelling the stream
            async def consume_and_cancel():
                async for chunk in response.body_iterator:
                    # Simulate disconnection after first chunk
                    raise asyncio.CancelledError("Client disconnected")

            with pytest.raises(asyncio.CancelledError):
                await consume_and_cancel()

    @pytest.mark.asyncio
    async def test_execute_playbook_step_empty_queue(self, mock_playbook_request, mock_current_user):
        """Test handling of empty queue (immediate completion)."""
        with patch('src.routers.playbook.execute_playbook_step') as mock_execute:
            # Setup mock to immediately signal completion
            async def mock_execution(request, queue):
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_step_endpoint

            # Call endpoint
            response = await execute_playbook_step_endpoint(
                request=mock_playbook_request,
                user=mock_current_user
            )

            # Collect events
            events = []
            async for chunk in response.body_iterator:
                chunk_str = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                if chunk_str.startswith("data: "):
                    event_data = chunk_str[6:].strip()
                    if event_data:
                        events.append(json.loads(event_data))

            # Should have no events (queue was immediately closed)
            assert len(events) == 0


class TestExecutePlaybookEndpoint:
    """Test cases for execute_playbook endpoint."""

    @pytest.fixture
    def mock_playbook_full_request(self, mock_agent_suggestion, mock_manager_suggestion):
        """Mock RunPlaybookRequest for testing complete playbook execution."""
        from src.schema.playbook import RunPlaybookRequest, RunPlaybookStepRequest

        steps = [
            RunPlaybookStepRequest(
                messageId=f"msg-{i}",
                userId="user-123",
                taskId=f"task-{i}",
                taskDescription=f"Step {i} description",
                task_metadata={"step": i},
                result=None,
                order=i,
                agent=mock_agent_suggestion,
                manager_agent=mock_manager_suggestion,
                call_id=f"call-{i}",
                vectorstore_name="test-vectorstore"
            )
            for i in range(3)
        ]

        return RunPlaybookRequest(
            playbook_id="playbook-123",
            playbook_name="Test Playbook",
            message="Execute this playbook",
            steps=steps,
            manager_agent=mock_manager_suggestion,
            manager_prompt="Coordinate the team and manage step execution",
            # Fields from RunAgentTeamRequest parent class
            user_id="user-123",
            session_id="session-root",
            chatbot_name={"provider": "gpt-4"},
            agent_mode="team"
        )

    @pytest.mark.asyncio
    async def test_execute_playbook_success(self, mock_playbook_full_request, mock_current_user):
        """Test successful complete playbook execution with streaming."""
        with patch('src.routers.playbook.execute_playbook_with_agent_team') as mock_execute:
            # Setup mock to simulate successful playbook execution
            async def mock_execution(request, queue):
                # Simulate playbook start
                await queue.put({
                    "type": "playbook_start",
                    "playbook_id": request.playbook_id,
                    "total_steps": len(request.steps)
                })

                # Simulate each step
                for i, step in enumerate(request.steps):
                    await queue.put({
                        "type": "step_start",
                        "step_order": i,
                        "task_id": step.taskId
                    })
                    await queue.put({
                        "type": "step_complete",
                        "step_order": i,
                        "task_id": step.taskId,
                        "success": True
                    })

                # Simulate playbook completion
                await queue.put({
                    "type": "playbook_complete",
                    "success": True,
                    "total_steps": len(request.steps),
                    "completed_steps": len(request.steps),
                    "failed_steps": 0
                })
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_endpoint

            # Call endpoint
            response = await execute_playbook_endpoint(
                request=mock_playbook_full_request,
                user=mock_current_user
            )

            # Assertions
            assert isinstance(response, StreamingResponse)
            assert response.media_type == "text/event-stream"
            assert response.headers["Cache-Control"] == "no-cache"
            assert response.headers["Connection"] == "keep-alive"

            # Collect events from stream
            events = []
            async for chunk in response.body_iterator:
                chunk_str = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                if chunk_str.startswith("data: "):
                    event_data = chunk_str[6:].strip()
                    if event_data:
                        events.append(json.loads(event_data))

            # Verify events
            assert len(events) > 0
            # First event should be playbook start
            assert events[0]["type"] == "playbook_start"
            assert events[0]["playbook_id"] == "playbook-123"
            # Last event should be playbook complete
            assert events[-1]["type"] == "playbook_complete"
            assert events[-1]["success"] is True
            assert events[-1]["completed_steps"] == 3

    @pytest.mark.asyncio
    async def test_execute_playbook_with_failures(self, mock_playbook_full_request, mock_current_user):
        """Test playbook execution with some step failures."""
        with patch('src.routers.playbook.execute_playbook_with_agent_team') as mock_execute:
            # Setup mock to simulate partial failure
            async def mock_execution(request, queue):
                await queue.put({"type": "playbook_start", "total_steps": len(request.steps)})

                # First step succeeds
                await queue.put({"type": "step_start", "step_order": 0})
                await queue.put({"type": "step_complete", "step_order": 0, "success": True})

                # Second step fails
                await queue.put({"type": "step_start", "step_order": 1})
                await queue.put({
                    "type": "step_complete",
                    "step_order": 1,
                    "success": False,
                    "error": "Step failed"
                })

                # Playbook completes with partial failure
                await queue.put({
                    "type": "playbook_complete",
                    "success": False,
                    "total_steps": 3,
                    "completed_steps": 1,
                    "failed_steps": 1
                })
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_endpoint

            response = await execute_playbook_endpoint(
                request=mock_playbook_full_request,
                user=mock_current_user
            )

            # Collect events
            events = []
            async for chunk in response.body_iterator:
                chunk_str = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                if chunk_str.startswith("data: "):
                    event_data = chunk_str[6:].strip()
                    if event_data:
                        events.append(json.loads(event_data))

            # Verify failure is reported
            assert events[-1]["type"] == "playbook_complete"
            assert events[-1]["success"] is False
            assert events[-1]["failed_steps"] == 1
            assert events[-1]["completed_steps"] == 1

    @pytest.mark.asyncio
    async def test_execute_playbook_error_handling(self, mock_playbook_full_request, mock_current_user):
        """Test error handling when playbook execution fails."""
        with patch('src.routers.playbook.execute_playbook_with_agent_team') as mock_execute:
            # Setup mock to send error event
            async def mock_execution(request, queue):
                # Send error event instead of raising exception
                await queue.put({
                    "type": "playbook_error",
                    "success": False,
                    "error": "Playbook execution failed",
                    "total_steps": len(request.steps),
                    "completed_steps": 0,
                    "failed_steps": 0
                })
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_endpoint

            # Call endpoint
            response = await execute_playbook_endpoint(
                request=mock_playbook_full_request,
                user=mock_current_user
            )

            # Collect events
            events = []
            async for chunk in response.body_iterator:
                chunk_str = chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk
                if chunk_str.startswith("data: "):
                    event_data = chunk_str[6:].strip()
                    if event_data:
                        events.append(json.loads(event_data))

            # Verify error is reported in event
            assert len(events) == 1
            assert events[0]["success"] is False
            assert "Playbook execution failed" in events[0]["error"]

    @pytest.mark.asyncio
    async def test_execute_playbook_logging(self, mock_playbook_full_request, mock_current_user):
        """Test that proper logging occurs during playbook execution."""
        with patch('src.routers.playbook.execute_playbook_with_agent_team') as mock_execute:
            with patch('src.routers.playbook.logger') as mock_logger:
                # Setup mock
                async def mock_execution(request, queue):
                    await queue.put({"type": "playbook_complete", "success": True})
                    await queue.put(None)

                mock_execute.side_effect = mock_execution

                from src.routers.playbook import execute_playbook_endpoint

                # Call endpoint
                response = await execute_playbook_endpoint(
                    request=mock_playbook_full_request,
                    user=mock_current_user
                )

                # Consume the stream
                async for _ in response.body_iterator:
                    pass

                # Verify logging calls
                assert mock_logger.info.called
                # Check that initial log contains playbook info
                log_messages = [str(call) for call in mock_logger.info.call_args_list]
                assert any("Executing playbook" in msg for msg in log_messages)
                assert any("playbook-123" in msg for msg in log_messages)

    @pytest.mark.asyncio
    async def test_execute_playbook_client_disconnect(self, mock_playbook_full_request, mock_current_user):
        """Test handling of client disconnection during playbook execution."""
        with patch('src.routers.playbook.execute_playbook_with_agent_team') as mock_execute:
            # Setup mock
            async def mock_execution(request, queue):
                await queue.put({"type": "playbook_start"})
                # Simulate long running execution
                await asyncio.sleep(0.1)
                await queue.put({"type": "step_complete"})
                await queue.put(None)

            mock_execute.side_effect = mock_execution

            from src.routers.playbook import execute_playbook_endpoint

            # Call endpoint
            response = await execute_playbook_endpoint(
                request=mock_playbook_full_request,
                user=mock_current_user
            )

            # Simulate client disconnect
            async def consume_and_cancel():
                async for chunk in response.body_iterator:
                    # Disconnect after first chunk
                    raise asyncio.CancelledError("Client disconnected")

            with pytest.raises(asyncio.CancelledError):
                await consume_and_cancel()


class TestEventStreamHelper:
    """Test cases for _event_stream helper function."""

    @pytest.mark.asyncio
    async def test_event_stream_normal_flow(self):
        """Test normal event streaming flow."""
        from src.routers.sse_stream import event_stream as _event_stream

        queue = asyncio.Queue()

        # Create a mock background task
        async def bg_task():
            pass

        task = asyncio.create_task(bg_task())

        # Add events to queue
        async def add_events():
            await queue.put({"event": "first", "data": "test1"})
            await queue.put({"event": "second", "data": "test2"})
            await queue.put({"event": "third", "data": "test3"})
            await queue.put(None)  # Signal completion

        asyncio.create_task(add_events())

        # Consume stream
        events = []
        async for chunk in _event_stream(queue, task, "test_endpoint"):
            # Parse the SSE format
            if chunk.startswith("data: "):
                event_data = chunk[6:].strip()
                events.append(json.loads(event_data))

        # Verify all events were streamed
        assert len(events) == 3
        assert events[0]["event"] == "first"
        assert events[1]["event"] == "second"
        assert events[2]["event"] == "third"

    @pytest.mark.asyncio
    async def test_event_stream_empty_queue(self):
        """Test event stream with immediately closed queue."""
        from src.routers.sse_stream import event_stream as _event_stream

        queue = asyncio.Queue()

        async def bg_task():
            pass

        task = asyncio.create_task(bg_task())

        # Immediately signal completion
        await queue.put(None)

        # Consume stream
        events = []
        async for chunk in _event_stream(queue, task, "test_endpoint"):
            events.append(chunk)

        # Should have no events
        assert len(events) == 0

    @pytest.mark.asyncio
    async def test_event_stream_cancellation(self):
        """Test event stream handles cancellation correctly."""
        from src.routers.sse_stream import event_stream as _event_stream

        queue = asyncio.Queue()

        # Create a simple background task
        async def bg_task():
            await asyncio.sleep(10)

        task = asyncio.create_task(bg_task())

        # Add one event then simulate cancellation
        await queue.put({"event": "start"})

        # Consume stream and verify CancelledError is propagated
        events_received = []
        with pytest.raises(asyncio.CancelledError):
            async for chunk in _event_stream(queue, task, "test_endpoint"):
                events_received.append(chunk)
                # Simulate client disconnection
                raise asyncio.CancelledError()

        # Verify we received at least the first event before disconnection
        assert len(events_received) > 0

        # Clean up the background task
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_event_stream_logging(self):
        """Test that event stream logs appropriately."""
        from src.routers.sse_stream import event_stream as _event_stream

        with patch('src.routers.sse_stream.logger') as mock_logger:
            queue = asyncio.Queue()

            async def bg_task():
                pass

            task = asyncio.create_task(bg_task())

            # Add events
            await queue.put({"event": "first"})
            await queue.put(None)

            # Consume stream
            async for _ in _event_stream(queue, task, "test_logging"):
                pass

            # Verify logging
            assert mock_logger.info.called
            log_calls = [str(call) for call in mock_logger.info.call_args_list]
            # Should log first chunk and stream finished
            assert any("First chunk" in call for call in log_calls)
            assert any("Stream finished" in call for call in log_calls)

    @pytest.mark.asyncio
    async def test_event_stream_json_formatting(self):
        """Test that events are properly formatted as JSON."""
        from src.routers.sse_stream import event_stream as _event_stream

        queue = asyncio.Queue()

        async def bg_task():
            pass

        task = asyncio.create_task(bg_task())

        # Add complex event with nested data
        complex_event = {
            "type": "test",
            "data": {
                "nested": "value",
                "number": 123,
                "boolean": True,
                "null_value": None,
                "array": [1, 2, 3]
            }
        }
        await queue.put(complex_event)
        await queue.put(None)

        # Consume stream
        chunks = []
        async for chunk in _event_stream(queue, task, "test_json"):
            chunks.append(chunk)

        # Should have exactly one chunk
        assert len(chunks) == 1

        # Verify SSE format
        assert chunks[0].startswith("data: ")
        assert chunks[0].endswith("\n\n")

        # Verify JSON can be parsed back
        json_str = chunks[0][6:].strip()
        parsed = json.loads(json_str)
        assert parsed == complex_event
