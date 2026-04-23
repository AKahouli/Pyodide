"""
Unit tests for index_notification_webhook.py - logical task polling.
"""
import pytest
import sys
import os
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))


class TestWebhookNotificationPayload:
    def test_payload_includes_status_logical(self):
        from src.schema.workers.base import WebhookNotificationPayload, NotificationStatus
        payload = WebhookNotificationPayload(
            event_type="indexation_task",
            task_id="task-123",
            metadata={"key": "value"},
            status=NotificationStatus.FINISH,
            status_image=NotificationStatus.FINISH,
            status_logical=NotificationStatus.FINISH,
        )
        data = payload.model_dump()
        assert data["status_logical"] == "FINISH"

    def test_payload_status_logical_defaults_none(self):
        from src.schema.workers.base import WebhookNotificationPayload
        payload = WebhookNotificationPayload(
            event_type="indexation_task",
            metadata={},
        )
        assert payload.status_logical is None

    def test_payload_with_logical_failure(self):
        from src.schema.workers.base import WebhookNotificationPayload, NotificationStatus, TaskErrorDetails
        error = TaskErrorDetails(error_code="TEST_ERROR", message="test failed")
        payload = WebhookNotificationPayload(
            event_type="indexation_task",
            metadata={},
            status=NotificationStatus.FAIL,
            status_logical=NotificationStatus.FAIL,
            error_details=error,
        )
        data = payload.model_dump()
        assert data["status_logical"] == "FAIL"
        assert data["error_details"]["error_code"] == "TEST_ERROR"


class _AsyncResponse:
    status = 200

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def raise_for_status(self):
        return None


class _AsyncSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def post(self, *args, **kwargs):
        return _AsyncResponse()


class TestWebhookCleanupScheduling:
    @pytest.mark.asyncio
    @patch("src.helpers.index_notification_webhook.sleep", new_callable=AsyncMock)
    @patch("src.helpers.index_notification_webhook.delete_temp_folder.apply_async")
    @patch("src.helpers.index_notification_webhook.aiohttp.ClientSession", return_value=_AsyncSession())
    @patch("src.helpers.index_notification_webhook.get_task_status")
    async def test_success_does_not_schedule_duplicate_cleanup(
        self,
        mock_get_task_status,
        mock_client_session,
        mock_apply_async,
        mock_sleep,
    ):
        from src.helpers.index_notification_webhook import listen_to_task_status_webhook

        mock_get_task_status.return_value = MagicMock(status="SUCCESS", result="{}")
        logger = MagicMock()

        await listen_to_task_status_webhook(
            task_id="task-1",
            metadata={},
            logger=logger,
            webhook_url="http://example.com/webhook",
            temp_folder="./tmp/shared/tmp/job-1",
        )

        mock_apply_async.assert_not_called()

    @pytest.mark.asyncio
    @patch("src.helpers.index_notification_webhook.sleep", new_callable=AsyncMock)
    @patch("src.helpers.index_notification_webhook.delete_temp_folder.apply_async")
    @patch("src.helpers.index_notification_webhook.aiohttp.ClientSession", return_value=_AsyncSession())
    @patch("src.helpers.index_notification_webhook.get_task_status")
    async def test_failure_schedules_cleanup_once(
        self,
        mock_get_task_status,
        mock_client_session,
        mock_apply_async,
        mock_sleep,
    ):
        from src.helpers.index_notification_webhook import listen_to_task_status_webhook

        mock_get_task_status.return_value = MagicMock(status="FAILURE", result="boom")
        logger = MagicMock()

        await listen_to_task_status_webhook(
            task_id="task-2",
            metadata={},
            logger=logger,
            webhook_url="http://example.com/webhook",
            temp_folder="./tmp/shared/tmp/job-2",
        )

        mock_apply_async.assert_called_once_with(args=["./tmp/shared/tmp/job-2"])
