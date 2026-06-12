import os
from typing import Any, Dict, List, Optional

from src.logger.logging import get_logger
from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

logger = get_logger(__name__)


def get_directory_id_from_category(predicted_category: str, structure_template: List[Dict[str, Any]]) -> Optional[str]:
    """
    Map predicted category to directory_id from structure template.

    Args:
        predicted_category: The predicted category name (e.g., "Marketing", "Finances")
        structure_template: The structure template containing directory information

    Returns:
        The directory_id if found, None otherwise
    """
    if not predicted_category or not structure_template:
        return None

    # Search through the structure template for matching directory name
    for folder in structure_template:
        if folder.get("directory") == predicted_category:
            return folder.get("id")

    # If no exact match found, try partial matching (in case of hierarchical categories)
    for folder in structure_template:
        folder_name = folder.get("directory", "")
        if predicted_category.startswith(folder_name) or folder_name.startswith(predicted_category):
            return folder.get("id")

    return None


def send_webhook_sync(webhook_url: str, payload: dict):
    """Send webhook notification synchronously from Celery task"""
    try:
        # Print the webhook payload before sending
        print("\n" + "="*80)
        print("🚀 WEBHOOK PAYLOAD BEING SENT:")
        print(f"URL: {webhook_url}")
        print(f"Payload: {payload}")
        print("="*80 + "\n")

        import requests
        response = requests.post(webhook_url, json=payload, timeout=10)
        response.raise_for_status()
        logger.info(f"Webhook sent successfully: {response.status_code}")
    except Exception as e:
        logger.exception(f"Error sending webhook: {e}")


def _classify_with_llm_direct(
    classifier: 'DocumentClassifier',
    external_id: str,
    structure_template: List[Dict[str, Any]],
    include_images: bool,
    chunk_filter: Optional[Dict[str, Any]],
    sheet_name: Optional[str],
    vectorstore_name: str,
    username: str
) -> Dict[str, Any]:
    """Helper function for LLM-only classification using direct chunk retrieval."""
    try:
        # Get classification result from the classifier
        result = classifier.classify_document_by_external_id(
            include_images=include_images,
            chunk_filter=chunk_filter,
            sheet_name=sheet_name
        )

        # Validate and normalize the predicted category
        predicted_category = result.get("predicted_category", "Unknown")
        is_existing, normalized_name, category_id = validate_and_normalize_category(
            predicted_category, structure_template
        )

        # Update the result with validation information
        result["predicted_category"] = normalized_name
        result["is_existing_category"] = is_existing
        result["category_id"] = category_id
        result["classification_source"] = "llm_existing" if is_existing else "llm_new"

        return result
    except Exception as e:
        logger.error(f"LLM classification failed: {str(e)}")
        raise




def _classify_with_majority_voting_direct(
    classifier: 'DocumentClassifier',
    external_id: str,
    structure_template: List[Dict[str, Any]],
    include_images: bool,
    chunk_filter: Optional[Dict[str, Any]],
    sheet_name: Optional[str],
    vectorstore_name: str,
    username: str
) -> Dict[str, Any]:
    """Helper function for majority voting classification using direct chunk retrieval."""
    try:
        # This would need to be implemented in DocumentClassifier
        raise NotImplementedError("Majority voting classification not yet implemented for direct chunk retrieval")
    except Exception as e:
        logger.error(f"Majority voting classification failed: {str(e)}")
        raise


def validate_and_normalize_category(
    predicted_category: str,
    structure_template: List[Dict[str, Any]]
) -> tuple[bool, Optional[str], Optional[str]]:
    """
    Check if category exists in structure template and return normalized name with ID

    Args:
        predicted_category: The category name predicted by LLM
        structure_template: List of directory categories with IDs

    Returns:
        tuple: (is_existing, normalized_category_name, category_id)
               - is_existing: True if category exists in template
               - normalized_category_name: The exact name from template or the new category name
               - category_id: ID from template if existing, None if new
    """
    if not predicted_category or not structure_template:
        return False, predicted_category, None

    def search_categories(categories, target_name):
        """Recursively search for category in nested structure"""
        for cat in categories:
            cat_name = cat.get("directory", "")
            cat_id = cat.get("id")

            # Exact match
            if cat_name.lower() == target_name.lower():
                return True, cat_name, cat_id

            # Check subdirectories
            subdirs = cat.get("sous_directories", [])
            if subdirs:
                found, found_name, found_id = search_categories(subdirs, target_name)
                if found:
                    return found, found_name, found_id

        return False, None, None

    is_existing, normalized_name, category_id = search_categories(structure_template, predicted_category)

    if not is_existing:
        # Return the predicted category as-is for new categories
        return False, predicted_category, None

    return True, normalized_name, category_id


def _classify_text_with_llm(
    text_content: str,
    structure_template: List[Dict[str, Any]],
    prompt: Optional[str] = None,
    username: str = "unknown"
) -> Dict[str, Any]:
    """
    Classify document using extracted text content with LLM.

    This function creates a DocumentClassifier instance and uses its
    _classify_document_topic_llm method for classification.

    Args:
        text_content: Extracted text from PDF pages
        structure_template: List of directory categories with IDs
        prompt: Optional custom prompt with {structure_template} and {content} placeholders
        username: Username making the request

    Returns:
        Dictionary containing classification results
    """
    try:
        from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

        # Create a DocumentClassifier instance with the structure template
        # Note: We pass dummy values for index_name and external_id since we're not using Azure Search
        classifier = DocumentClassifier(
            index_name="pdf_classification",  # Dummy index name
            directories=structure_template,    # The structure template with categories
            external_id="pdf_classification", # Dummy external ID
            username=username,
            prompt=prompt
        )

        # Use the existing _classify_document_topic_llm method
        classification_result = classifier._classify_document_topic_llm(text_content)

        # The function already returns the correct format with:
        # - predicted_category
        # - is_new_category
        # - confidence
        # - reasoning
        # - matched_existing_id

        # Add compatibility fields
        classification_result["is_existing_category"] = not classification_result.get("is_new_category", False)
        classification_result["category_id"] = classification_result.get("matched_existing_id")
        classification_result["classification_source"] = "llm_existing" if not classification_result.get("is_new_category", False) else "llm_new"

        return classification_result

    except Exception as e:
        logger.error(f"LLM text classification failed: {str(e)}")
        # Return fallback result
        return {
            "predicted_category": "Unknown",
            "confidence": 0.0,
            "reasoning": f"Classification failed: {str(e)}",
            "is_new_category": True,
            "matched_existing_id": None,
            "is_existing_category": False,
            "category_id": None,
            "classification_source": "llm_new"
        }