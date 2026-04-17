"""Unit tests for playbook schema models."""

import pytest
from pydantic import ValidationError
from src.schema.playbook import (
    RunPlaybookStepRequest,
    RunPlaybookStepResponse,
    PlaybookMailTriggerNodeInput,
)
from src.schema.chatbot_schema import AgentSuggestion


class TestRunPlaybookStepRequest:
    """Test suite for RunPlaybookStepRequest schema."""

    @pytest.fixture
    def valid_agent_suggestion(self):
        """Create a valid AgentSuggestion for testing."""
        return AgentSuggestion(
            id="agent-123",
            name="Test Agent",
            description="A test agent",
            prompt="You are a helpful agent",
            tools=[{"name": "search", "top_k": 3}],
            chatbot_name={"provider": "gpt-4"},
            brain_ids=["brain-1"],
            save_memory=False,
        )

    @pytest.fixture
    def valid_manager_suggestion(self):
        """Create a valid Manager AgentSuggestion for testing."""
        return AgentSuggestion(
            id="manager-123",
            name="Manager Agent",
            description="A manager agent",
            prompt="You are a manager",
            chatbot_name={"provider": "gpt-4"},
            brain_ids=[],
            agent_type="manager",
        )

    @pytest.fixture
    def valid_request_data(self, valid_agent_suggestion, valid_manager_suggestion):
        """Create valid request data for testing."""
        return {
            "messageId": "msg-12345",
            "userId": "user-123",
            "taskId": "task-456",
            "taskDescription": "Complete this task",
            "task_metadata": {"priority": "high"},
            "result": "Previous result",
            "order": 1,
            "agent": valid_agent_suggestion,
            "manager_agent": valid_manager_suggestion,
            "call_id": "call-789",
            "vectorstore_name": "test-vectorstore",
        }

    def test_valid_request_creation(self, valid_request_data):
        """Test creating a valid RunPlaybookStepRequest."""
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.messageId == "msg-12345"
        assert request.userId == "user-123"
        assert request.taskId == "task-456"
        assert request.taskDescription == "Complete this task"
        assert request.order == 1
        assert request.call_id == "call-789"
        assert request.vectorstore_name == "test-vectorstore"
        assert request.task_metadata == {"priority": "high"}
        assert request.result == "Previous result"

    def test_message_id_validation_too_short(self, valid_request_data):
        """Test that messageId must be at least 5 characters."""
        valid_request_data["messageId"] = "abc"

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "messageId must be at least 5 characters long" in str(exc_info.value)

    def test_message_id_validation_empty(self, valid_request_data):
        """Test that messageId cannot be empty."""
        valid_request_data["messageId"] = ""

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "messageId must be at least 5 characters long" in str(exc_info.value)

    def test_message_id_validation_whitespace(self, valid_request_data):
        """Test that messageId with only whitespace is invalid."""
        valid_request_data["messageId"] = "   "

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "messageId must be at least 5 characters long" in str(exc_info.value)

    def test_message_id_strips_whitespace(self, valid_request_data):
        """Test that messageId strips leading/trailing whitespace."""
        valid_request_data["messageId"] = "  msg-12345  "
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.messageId == "msg-12345"

    def test_user_id_validation_empty(self, valid_request_data):
        """Test that userId cannot be empty."""
        valid_request_data["userId"] = ""

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "userId cannot be empty" in str(exc_info.value)

    def test_user_id_validation_whitespace(self, valid_request_data):
        """Test that userId with only whitespace is invalid."""
        valid_request_data["userId"] = "   "

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "userId cannot be empty" in str(exc_info.value)

    def test_user_id_strips_whitespace(self, valid_request_data):
        """Test that userId strips leading/trailing whitespace."""
        valid_request_data["userId"] = "  user-123  "
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.userId == "user-123"

    def test_task_id_validation_empty(self, valid_request_data):
        """Test that taskId cannot be empty."""
        valid_request_data["taskId"] = ""

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "taskId cannot be empty" in str(exc_info.value)

    def test_task_id_strips_whitespace(self, valid_request_data):
        """Test that taskId strips leading/trailing whitespace."""
        valid_request_data["taskId"] = "  task-456  "
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.taskId == "task-456"

    def test_task_description_validation_empty(self, valid_request_data):
        """Test that taskDescription cannot be empty."""
        valid_request_data["taskDescription"] = ""

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "String should have at least 1 character" in str(exc_info.value)

    def test_task_description_validation_whitespace(self, valid_request_data):
        """Test that taskDescription with only whitespace is invalid."""
        valid_request_data["taskDescription"] = "   "

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "taskDescription cannot be empty" in str(
            exc_info.value
        ) or "String should have at least 1 character" in str(exc_info.value)

    def test_task_description_strips_whitespace(self, valid_request_data):
        """Test that taskDescription strips leading/trailing whitespace."""
        valid_request_data["taskDescription"] = "  Complete this task  "
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.taskDescription == "Complete this task"

    def test_call_id_validation_empty(self, valid_request_data):
        """Test that call_id cannot be empty."""
        valid_request_data["call_id"] = ""

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "call_id cannot be empty" in str(exc_info.value)

    def test_call_id_strips_whitespace(self, valid_request_data):
        """Test that call_id strips leading/trailing whitespace."""
        valid_request_data["call_id"] = "  call-789  "
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.call_id == "call-789"

    def test_vectorstore_name_validation_empty(self, valid_request_data):
        """Test that vectorstore_name cannot be empty."""
        valid_request_data["vectorstore_name"] = ""

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "vectorstore_name cannot be empty" in str(exc_info.value)

    def test_vectorstore_name_strips_whitespace(self, valid_request_data):
        """Test that vectorstore_name strips leading/trailing whitespace."""
        valid_request_data["vectorstore_name"] = "  test-vectorstore  "
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.vectorstore_name == "test-vectorstore"

    def test_order_validation_negative(self, valid_request_data):
        """Test that order must be >= 0."""
        valid_request_data["order"] = -1

        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest(**valid_request_data)

        assert "greater than or equal to 0" in str(exc_info.value)

    def test_order_validation_zero(self, valid_request_data):
        """Test that order can be 0."""
        valid_request_data["order"] = 0
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.order == 0

    def test_task_metadata_default(self, valid_request_data):
        """Test that task_metadata defaults to empty dict."""
        del valid_request_data["task_metadata"]


class TestPlaybookMailTriggerNodeInput:
    """Test suite for future mail-trigger payload schema."""

    def test_valid_mail_trigger_node_input(self):
        payload = PlaybookMailTriggerNodeInput(
            trigger={"type": "mail", "occurredAt": "2026-04-17T12:00:00Z"},
            message={
                "provider": "m365",
                "mailboxAppKey": "microsoft",
                "providerMessageId": "msg-123",
                "providerThreadId": "thread-456",
                "receivedAt": "2026-04-17T12:00:00Z",
                "subject": "Invoice",
                "bodyText": "Please review",
                "bodyHtml": None,
                "from": {"name": "Ops", "address": "ops@example.com"},
                "to": [{"name": None, "address": "user@example.com"}],
                "cc": [],
                "hasAttachments": True,
                "attachments": [
                    {
                        "providerAttachmentId": "att-1",
                        "filename": "invoice.pdf",
                        "mimeType": "application/pdf",
                        "size": 1234,
                        "isInline": False,
                        "workspaceImport": {
                            "workspaceDocumentId": "doc-1",
                            "filename": "invoice.pdf",
                            "finalFilename": "invoice.pdf",
                            "mimeType": "application/pdf",
                            "size": 1234,
                            "sourcePath": "/system-imports/mail/p1/e1/invoice.pdf",
                            "collisionResolved": False,
                            "error": None,
                        },
                    }
                ],
            },
        )

        assert payload.trigger["type"] == "mail"
        assert payload.message.providerMessageId == "msg-123"
        assert payload.message.from_.address == "ops@example.com"
        assert (
            payload.message.attachments[0].workspaceImport.workspaceDocumentId
            == "doc-1"
        )
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.task_metadata == {}

    def test_result_optional(self, valid_request_data):
        """Test that result is optional."""
        valid_request_data["result"] = None
        request = RunPlaybookStepRequest(**valid_request_data)

        assert request.result is None

    def test_missing_required_fields(self):
        """Test that missing required fields raise ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepRequest()

        error_str = str(exc_info.value)
        assert "messageId" in error_str or "field required" in error_str.lower()


class TestRunPlaybookStepResponse:
    """Test suite for RunPlaybookStepResponse schema."""

    def test_valid_success_response(self):
        """Test creating a valid success response."""
        response = RunPlaybookStepResponse(
            success=True,
            messageId="msg-123",
            taskId="task-456",
            result="Task completed successfully",
        )

        assert response.success is True
        assert response.messageId == "msg-123"
        assert response.taskId == "task-456"
        assert response.result == "Task completed successfully"
        assert response.error is None

    def test_valid_error_response(self):
        """Test creating a valid error response."""
        response = RunPlaybookStepResponse(
            success=False,
            messageId="msg-123",
            taskId="task-456",
            error="Task execution failed",
        )

        assert response.success is False
        assert response.messageId == "msg-123"
        assert response.taskId == "task-456"
        assert response.error == "Task execution failed"
        assert response.result is None

    def test_response_with_both_result_and_error(self):
        """Test that response can have both result and error."""
        response = RunPlaybookStepResponse(
            success=False,
            messageId="msg-123",
            taskId="task-456",
            result="Partial result",
            error="Warning: some issues occurred",
        )

        assert response.result == "Partial result"
        assert response.error == "Warning: some issues occurred"

    def test_response_optional_fields_default_to_none(self):
        """Test that optional fields default to None."""
        response = RunPlaybookStepResponse(
            success=True, messageId="msg-123", taskId="task-456"
        )

        assert response.result is None
        assert response.error is None

    def test_missing_required_fields(self):
        """Test that missing required fields raise ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            RunPlaybookStepResponse(success=True)

        error_str = str(exc_info.value)
        assert "messageId" in error_str or "taskId" in error_str
