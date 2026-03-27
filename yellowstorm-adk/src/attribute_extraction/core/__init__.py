"""Core extraction service and webhook processing."""

from src.attribute_extraction.core.extraction_service import AttributeExtractionService
from src.attribute_extraction.core.webhook_processor import process_extraction_and_webhook, send_error_to_webhook

__all__ = ["AttributeExtractionService", "process_extraction_and_webhook", "send_error_to_webhook"]
