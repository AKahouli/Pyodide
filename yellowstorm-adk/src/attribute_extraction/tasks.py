"""Celery tasks for attribute extraction jobs."""

import json
import httpx
from celery import current_task
from src.infrastructure.celery_app import celery_app
from src.attribute_extraction.core.extraction_service import AttributeExtractionService
from src.attribute_extraction.core.webhook_processor import sync_send_error_to_webhook
from src.attribute_extraction.schema.models import AttributeExtractionRequest
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("celery.attribute_extraction")
settings = get_settings()


@celery_app.task(bind=True, name='attribute-extraction-task')
def process_single_attribute_extraction(self, job_id: str, user_request_data: dict, username: str):
    """
    Celery task to process a single attribute extraction job.

    Args:
        job_id: Unique job identifier
        user_request_data: Dictionary containing AttributeExtractionRequest data
        username: Username of user who submitted job

    Returns:
        Dictionary with result or error information
    """
    try:
        # Update task state
        self.update_state(
            state='PROGRESS',
            meta={'progress': 10, 'status': 'Starting extraction'}
        )

        # Convert dict back to AttributeExtractionRequest
        user_request = AttributeExtractionRequest(**user_request_data)

        # Get LiteLLM configuration from settings
        service = AttributeExtractionService(
            api_key=settings.LITELLM_API_SECRET_KEY,
            base_url=settings.LITELLM_API_BASE_URL,
            model=settings.ATTRIBUT_EXTRACT_MODEL,
            workspace_names=user_request.workspace_names,
            vectorstore=user_request.vectorstore,
            top_k=user_request.top_k,
            file_names=user_request.file_names,
            sheet_name=user_request.sheet_name
        )

        # Update progress
        self.update_state(
            state='PROGRESS',
            meta={'progress': 30, 'status': 'Executing extraction'}
        )

        # Execute extraction synchronously
        result_json = service.sync_execute(attributes=user_request.attributes)

        # Parse result
        result_dict = json.loads(result_json)

        # Update progress
        self.update_state(
            state='PROGRESS',
            meta={'progress': 90, 'status': 'Sending webhook'}
        )

        # Send results to webhook (sync version)
        webhook_payload = {
            "job_id": job_id,
            "event_type": "task_enrichissement",
            "status": "completed",
            "data": result_dict,
            "workspace_names": user_request.workspace_names,
            "file_name": user_request.file_names[0] if user_request.file_names else None,
            "sheet_name": user_request.sheet_name
        }
        logger.info(f"webhook payload: {webhook_payload}")

        # Use sync httpx client
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                str(user_request.webhook_url),
                json=webhook_payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()

        logger.info(f"[Job {job_id}] Celery task completed successfully")

        return {
            "status": "completed",
            "job_id": job_id,
            "progress": 100,
            "data": result_dict
        }

    except Exception as exc:
        logger.error(f"[Job {job_id}] Celery task failed: {str(exc)}")

        # Send error to webhook (sync version)
        try:
            sync_send_error_to_webhook(
                job_id,
                user_request_data['webhook_url'],
                f"Celery task failed: {str(exc)}",
                user_request_data.get('file_names', [None])[0] if user_request_data.get('file_names') else None,
                user_request_data.get('sheet_name')
            )
        except Exception as webhook_exc:
            logger.error(f"[Job {job_id}] Failed to send error webhook: {str(webhook_exc)}")

        # Update task state to reflect failure
        self.update_state(
            state='FAILURE',
            meta={'error': str(exc)}
        )

        raise exc

