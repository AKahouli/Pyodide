import ast
import asyncio
import re2 as re
import traceback
from asyncio import sleep
from logging import Logger
from typing import Optional, Dict, Any

import aiohttp
from worker import delete_temp_folder
from src.logger.logging import get_logger
from src.schema.workers.base import NotificationStatus, TaskErrorDetails, WebhookNotificationPayload
from src.vectorstores_api_client.delete import delete_directory
from src.vectorstores_api_client.task_status import get_task_status
from src.config.settings import get_settings

logger = get_logger("api.main")
settings = get_settings()

def parse_celery_exception(task_result: str, task_name: Optional[str] = None) -> TaskErrorDetails:
    """
    Parse Celery task exception result and create structured error details
    
    Args:
        task_result: The task result string from Celery (usually contains exception info)
        task_name: Optional name of the failed task
        
    Returns:
        TaskErrorDetails: Structured error information
    """
    try:
        # Try to parse the task result to extract meaningful error information
        error_message = str(task_result)
        error_code = "INDEXATION_TASK_ERROR"
        details = {}
        stack_trace = None
        
        # Check if this is a known custom exception pattern
        if "VectorstoreValidationError" in error_message:
            error_code = "VECTORSTORE_VALIDATION_ERROR"
        elif "VectorstoreIndexingError" in error_message:
            error_code = "VECTORSTORE_INDEXING_ERROR"
        elif "VectorstoreConnectionError" in error_message:
            error_code = "VECTORSTORE_CONNECTION_ERROR"
        elif "FileNotFoundError" in error_message:
            error_code = "FILE_NOT_FOUND_ERROR"
        elif "PermissionError" in error_message:
            error_code = "PERMISSION_ERROR"
        elif "ConnectionError" in error_message:
            error_code = "CONNECTION_ERROR"
        elif "TimeoutError" in error_message:
            error_code = "TIMEOUT_ERROR"
        elif "MemoryError" in error_message:
            error_code = "MEMORY_ERROR"
        elif "ValueError" in error_message:
            error_code = "VALUE_ERROR"
        elif "KeyError" in error_message:
            error_code = "KEY_ERROR"
        
        # Try to extract more specific error information
        if "Traceback" in error_message:
            # If there's a full traceback, extract the main error message
            lines = error_message.split('\n')
            for line in reversed(lines):
                if line.strip() and not line.startswith(' '):
                    error_message = line.strip()
                    break
            stack_trace = str(task_result)  # Keep full traceback for debugging
        
        # Extract additional context if available
        if task_name:
            details["task_name"] = task_name
            
        # Try to extract file path or collection name from error message
        path_match = re.search(
            r"(?i)['\"]([^'\"]*\.(pdf|docx?|txt|xlsx?))['\"]", error_message
        )
        if path_match:
            details["file_path"] = path_match.group(1)

        collection_match = re.search(
            r"(?i)collection[_\s]*['\"]?([a-zA-Z0-9_-]+)['\"]?",
            error_message)
        if collection_match:
            details["collection_name"] = collection_match.group(1)
        
        return TaskErrorDetails(
            error_code=error_code,
            message=error_message,
            details=details,
            task_name=task_name,
            stack_trace=stack_trace
        )
        
    except Exception as e:
        # Fallback error details if parsing fails
        logger.warning(f"Failed to parse Celery exception: {e}")
        return TaskErrorDetails(
            error_code="TASK_PARSING_ERROR",
            message=f"Failed to parse task error: {str(task_result)[:500]}...",  # Truncate long messages
            details={"parsing_error": str(e)},
            task_name=task_name,
            stack_trace=str(task_result)
        )


def create_error_notification_payload(
    task_id: str,
    metadata: Dict[str, Any],
    task_error: Optional[TaskErrorDetails] = None,
    image_task_error: Optional[TaskErrorDetails] = None
) -> WebhookNotificationPayload:
    """
    Create a structured notification payload for failed indexation tasks
    
    Args:
        task_id: The Celery task ID
        metadata: Task metadata
        task_error: Main task error details
        image_task_error: Image task error details (if applicable)
        
    Returns:
        IndexationNotificationPayload: Structured notification payload
    """
    return WebhookNotificationPayload(
        event_type="indexation_task",
        task_id=task_id,
        metadata=metadata,
        status=NotificationStatus.FAIL,
        status_image=NotificationStatus.FAIL if image_task_error else None,
        error_details=task_error,
        error_details_image=image_task_error
    )


async def listen_to_task_status_webhook(
        task_id: str,
        metadata: Dict[str, Any],
        logger: Logger,
        webhook_url: str,
        task_image_id: Optional[str] = None,
        logical_task_id: Optional[str] = None,
        temp_folder: Optional[str] = None,
):
    logger.info(f"Listening to task {task_id} status")
    if task_image_id is not None:
        logger.info(f"Listening to task Image {task_image_id} status")
    if logical_task_id is not None:
        logger.info(f"Listening to task Logical {logical_task_id} status")
    logger.info("Webhook listener initialized successfully")

    started = False
    started_image = False
    started_logical = False
    task_finished = False
    image_finished = task_image_id is None
    logical_finished = logical_task_id is None

    # Track error details for structured error responses
    task_error_details: Optional[TaskErrorDetails] = None
    image_task_error_details: Optional[TaskErrorDetails] = None
    logical_task_error_details: Optional[TaskErrorDetails] = None
    temp_cleanup_scheduled = False

    def schedule_temp_folder_cleanup_once() -> None:
        nonlocal temp_cleanup_scheduled
        if temp_cleanup_scheduled or not temp_folder:
            return
        try:
            delete_temp_folder.apply_async(args=[temp_folder])
            temp_cleanup_scheduled = True
            logger.info(f"Scheduled temp folder deletion for: {temp_folder}")
        except Exception as e:
            logger.exception(f"Error scheduling temp folder deletion for {temp_folder}: {e}")

    while not task_finished:
        task_status_future = asyncio.to_thread(get_task_status, task_id)
        image_status_future = (
            asyncio.to_thread(get_task_status, task_image_id)
            if task_image_id is not None
            else None
        )
        logical_status_future = (
            asyncio.to_thread(get_task_status, logical_task_id)
            if logical_task_id is not None and not logical_finished
            else None
        )

        futures = [task_status_future]
        if image_status_future:
            futures.append(image_status_future)
        if logical_status_future:
            futures.append(logical_status_future)

        results = await asyncio.gather(*futures)
        task_status = results[0]
        result_index = 1
        if image_status_future:
            image_status = results[result_index]
            result_index += 1
        else:
            image_status = None
        if logical_status_future:
            logical_status = results[result_index]
        else:
            logical_status = None

        logger.info(f"Task {task_id} status: {task_status.status}")
        if task_image_id:
            logger.info(
                f"Task {task_image_id} status Image: {image_status.status if image_status else 'No Image Task'}")
        if logical_task_id:
            logger.info(
                f"Task {logical_task_id} status Logical: {logical_status.status if logical_status else 'No Logical Task'}")

        if logical_status and logical_status.status == "FAILURE":
            status = NotificationStatus.FAIL
            logical_task_error_details = parse_celery_exception(
                logical_status.result, "logical_indexing_task"
            ) if logical_status.result else None
            task_error_details = logical_task_error_details
            if isinstance(logical_status.result, str):
                metadata['error_message'] = logical_status.result
            task_finished = True
            logical_finished = True

            if not task_image_id:
                schedule_temp_folder_cleanup_once()
        elif logical_status and logical_status.status == "SUCCESS":
            logical_finished = True
        elif logical_status and logical_status.status == "PENDING" and not started_logical:
            started_logical = True

        if task_finished:
            pass
        elif task_status.status == "SUCCESS":
            status = NotificationStatus.FINISH
            task_status.result = ast.literal_eval(task_status.result)
            if isinstance(task_status.result, dict):
                for key, value in task_status.result.items():
                    if key == "html_path" and isinstance(value, str) and value.endswith(".html"):
                        metadata['graph_html_path'] = value
                    elif key == "graphml_path" and isinstance(value, str) and value.endswith(".graphml"):
                        metadata['graphml_path'] = value
                metadata["dpp_moa"] = task_status.result
            task_finished = True

        elif task_status.status == "FAILURE":
            status = NotificationStatus.FAIL
            # Parse the task error and create structured error details
            task_error_details = parse_celery_exception(task_status.result, "indexation_task") if task_status.result else None

            # Keep backward compatibility with legacy error_message field
            if isinstance(task_status.result, str):
                metadata['error_message'] = task_status.result

            task_finished = True

            if not task_image_id:
                schedule_temp_folder_cleanup_once()

        elif task_status.status == "PENDING" and not started:
            started = True
            status = NotificationStatus.START

        await sleep(5)

    # Send notification when task_id is finished
    if task_error_details or status == NotificationStatus.FAIL:
        # Use structured error payload for failures
        notification_payload = WebhookNotificationPayload(
            event_type="indexation_task",
            task_id=task_id,
            metadata=metadata,
            status=status,
            status_image=None,
            error_details=task_error_details,
            error_details_image=None
        )
        final_data = notification_payload.model_dump()
    else:
        # Use legacy format for successful tasks (backward compatibility)
        notification_payload = WebhookNotificationPayload(
            event_type="indexation_task",
            task_id=task_id,
            metadata=metadata,
            status=status,
            status_image=None,
        )
        final_data = notification_payload.model_dump()

    # Build headers with authentication
    headers = {
        "Content-Type": "application/json",
    }

    # Add API key if configured
    if settings.WEBHOOK_API_KEY:
        headers["X-API-Key"] = settings.WEBHOOK_API_KEY
        logger.info("Including API key in webhook request")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url=webhook_url, json=final_data, headers=headers) as response:
                response.raise_for_status()
                logger.info(f"Notification sent successfully: {response.status}")
    except aiohttp.ClientError as e:
        logger.exception(f"Error sending Notification: {e}")

    # Continue to check for image status if task_image_id exists
    while not image_finished:
        image_status = await asyncio.to_thread(get_task_status, task_image_id)
        logger.info(f"Task {task_image_id} status Image: {image_status.status if image_status else 'No Image Task'}")

        if image_status.status == "SUCCESS":
            status_image = NotificationStatus.FINISH
            image_finished = True

        elif image_status.status == "FAILURE":
            status_image = NotificationStatus.FAIL
            image_task_error_details = parse_celery_exception(image_status.result, "image_processing_task") if image_status.result else None

            if isinstance(image_status.result, str):
                metadata['error_message_image'] = image_status.result

            image_finished = True

            if task_status.status == "FAILURE":
                schedule_temp_folder_cleanup_once()

        elif image_status.status == "PENDING" and not started_image:
            started_image = True
            status_image = NotificationStatus.START

        await sleep(5)

    # Continue to check for logical status if logical_task_id exists
    status_logical = None
    while not logical_finished:
        logical_status = await asyncio.to_thread(get_task_status, logical_task_id)
        logger.info(f"Task {logical_task_id} status Logical: {logical_status.status if logical_status else 'No Logical Task'}")

        if logical_status.status == "SUCCESS":
            status_logical = NotificationStatus.FINISH
            logical_finished = True
            if isinstance(logical_status.result, str):
                try:
                    logical_result = ast.literal_eval(logical_status.result)
                    if isinstance(logical_result, dict):
                        metadata["logical_indexing"] = logical_result
                except Exception:
                    pass
        elif logical_status.status == "FAILURE":
            status_logical = NotificationStatus.FAIL
            logical_task_error_details = parse_celery_exception(
                logical_status.result, "logical_indexing_task"
            ) if logical_status.result else None
            if isinstance(logical_status.result, str):
                metadata['error_message_logical'] = logical_status.result
            logical_finished = True
        elif logical_status.status == "PENDING" and not started_logical:
            started_logical = True

        await sleep(5)

    if task_image_id:
        if task_error_details or image_task_error_details or logical_task_error_details or status == NotificationStatus.FAIL or status_image == NotificationStatus.FAIL or status_logical == NotificationStatus.FAIL:
            notification_payload = WebhookNotificationPayload(
                event_type="indexation_task",
                task_id=task_id,
                metadata=metadata,
                status=status,
                status_image=status_image,
                status_logical=status_logical,
                error_details=task_error_details,
                error_details_image=image_task_error_details
            )
            final_data = notification_payload.dict()
        else:
            notification_payload = WebhookNotificationPayload(
                event_type="indexation_task",
                task_id=task_id,
                metadata=metadata,
                status=status,
                status_image=status_image,
                status_logical=status_logical,
            )
            final_data = notification_payload.model_dump()

        # Build headers with authentication
        headers = {
            "Content-Type": "application/json",
        }

        # Add API key if configured
        if settings.WEBHOOK_API_KEY:
            headers["X-API-Key"] = settings.WEBHOOK_API_KEY
            logger.info("Including API key in final webhook request")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url=webhook_url, json=final_data, headers=headers) as response:
                    response.raise_for_status()
                    logger.info(f"Notification sent successfully: {response.status}")
        except aiohttp.ClientError as e:
            logger.exception(f"Error sending Notification: {e}")
