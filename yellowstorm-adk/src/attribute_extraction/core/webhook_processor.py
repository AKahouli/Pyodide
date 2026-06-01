"""Webhook processing for attribute extraction jobs."""

import json
import httpx
from fastapi import HTTPException

from src.attribute_extraction.core.extraction_service import AttributeExtractionService
from src.attribute_extraction.schema.models import AttributeExtractionRequest
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("api.attribute_extraction.webhook")
settings = get_settings()


async def process_extraction_and_webhook(
    job_id: str,
    user_request: AttributeExtractionRequest,
    username: str
):
    """
    Background task to process extraction and send results to webhook.

    Args:
        job_id: Unique job identifier
        user_request: Extraction request with attributes and configuration
        username: Username of the user who submitted the job
    """
    try:
        logger.info(f"[Job {job_id}] Starting attribute extraction for user {username}")

        # Get LiteLLM configuration from settings
        litellm_api_key = settings.LITELLM_API_SECRET_KEY
        litellm_base_url = settings.LITELLM_API_BASE_URL
        model = settings.ATTRIBUT_EXTRACT_MODEL

        # Create service
        service = AttributeExtractionService(
            api_key=litellm_api_key,
            base_url=litellm_base_url,
            model=model,
            workspace_names=user_request.workspace_names,
            vectorstore=user_request.vectorstore,
            top_k=user_request.top_k,
            file_names=user_request.file_names,
            sheet_name=user_request.sheet_name
        )

        # Execute extraction
        result_json = await service.execute(
            attributes=user_request.attributes
        )

        # Parse result
        result_dict = json.loads(result_json)

        logger.info(f"[Job {job_id}] Extraction completed, sending to webhook: {user_request.webhook_url}")

        # Send results to webhook
        webhook_payload = {
            "job_id": job_id,
            "event_type": "task_enrichissement",
            "status": "completed",
            "data": result_dict,
            "workspace_names": user_request.workspace_names,
            "file_name": user_request.file_names[0] if user_request.file_names else None,
            "sheet_name": user_request.sheet_name
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                str(user_request.webhook_url),
                json=webhook_payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            logger.info(f"[Job {job_id}] Successfully sent results to webhook (status: {response.status_code})")

    except HTTPException as exc:
        logger.error(f"[Job {job_id}] HTTP exception during extraction: {exc.detail}")
        file_name = user_request.file_names[0] if user_request.file_names else None
        await send_error_to_webhook(job_id, user_request.webhook_url, f"Extraction failed: {exc.detail}", file_name, user_request.sheet_name)
    except Exception as exc:
        logger.error(f"[Job {job_id}] Unexpected error: {str(exc)}")
        file_name = user_request.file_names[0] if user_request.file_names else None
        await send_error_to_webhook(job_id, user_request.webhook_url, f"Unexpected error: {str(exc)}", file_name, user_request.sheet_name)


async def send_error_to_webhook(job_id: str, webhook_url: str, error_message: str, file_name: str = None, sheet_name: str = None):
    """
    Send error notification to webhook (async version).

    Args:
        job_id: Job identifier
        webhook_url: Webhook URL to send error to
        error_message: Error message to include in payload
        file_name: Optional file name from the original request
        sheet_name: Optional sheet name from the original request
    """
    try:
        error_payload = {
            "job_id": job_id,
            "event_type": "task_enrichissement",
            "status": "failed",
            "error": error_message,
            "file_name": file_name,
            "sheet_name": sheet_name
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                str(webhook_url),
                json=error_payload,
                headers={"Content-Type": "application/json"}
            )
    except Exception as webhook_exc:
        logger.error(f"[Job {job_id}] Failed to send error to webhook: {str(webhook_exc)}")


def sync_send_error_to_webhook(job_id: str, webhook_url: str, error_message: str, file_name: str = None, sheet_name: str = None):
    """
    Send error notification to webhook (sync version for Celery tasks).

    Args:
        job_id: Job identifier
        webhook_url: Webhook URL to send error to
        error_message: Error message to include in payload
        file_name: Optional file name from the original request
        sheet_name: Optional sheet name from the original request
    """
    try:
        error_payload = {
            "job_id": job_id,
            "event_type": "task_enrichissement",
            "status": "failed",
            "error": error_message,
            "file_name": file_name,
            "sheet_name": sheet_name
        }
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                str(webhook_url),
                json=error_payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
    except Exception as webhook_exc:
        logger.error(f"[Job {job_id}] Failed to send error to webhook: {str(webhook_exc)}")
