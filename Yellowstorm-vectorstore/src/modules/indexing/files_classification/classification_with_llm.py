"""Document classification module using LLM."""
import json
from pathlib import Path
from typing import List, Dict, Any, Optional
import openai
import pandas as pd
from src.schema.workers.base import WebhookNotificationPayload
from src.config.settings import get_settings
from src.logger.logging import get_logger

settings = get_settings()
logger = get_logger("classifier-api.main")

class ClassificationConstants:
    """Constants for document classification."""
    DEFAULT_PAGES_TO_ANALYZE = 5
    DEFAULT_CONTENT_LIMIT = 8000
    DEFAULT_EXCEL_SAMPLE_SIZE = 50
    CONFIDENCE_LEVELS = ["faible", "moyen", "eleve"]

class DocumentClassificationError(Exception):
    """Custom exception for document classification errors."""
    pass

def classify_document_with_llm_task(
    documents: List,  # split_documents_task result
    file: str,
    structure_template: List[Dict[str, Any]],
    webhook_url: Optional[str] = None,
    webhook_metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    from worker import send_webhook_sync
    try:
        logger.info(f"Début de la classification LLM pour le fichier: {file}")
        logger.info(f"Structure template: {len(structure_template)} catégories")
        # Appeler la fonction de classification
        result = classify_document(
            document_pages=documents,
            file_path=file,
            structure_template=structure_template,
        )

        # Extraire les informations principales du résultat
        predicted_category = result.get("predicted_category", "unknown")
        final_confidence = result.get("final_confidence", 0.0)

        logger.info(f"Classification terminée: {predicted_category} (confiance: {final_confidence:.3f})")

        if webhook_url and webhook_metadata:
            webhook_payload = WebhookNotificationPayload(
                event_type="file_classification_task",
                task_id=webhook_metadata.get("task_id"),
                detected_category=predicted_category,
                category_confidence=final_confidence,
                metadata=webhook_metadata.copy()
            ).model_dump()
            send_webhook_sync(webhook_url, webhook_payload)

    except Exception as e:
        error_msg = f"Erreur lors de la classification LLM du fichier {file}: {str(e)}"
        logger.exception(error_msg)

def classify_document(
    document_pages: List[Dict[str, Any]],
    file_path: str,
    structure_template: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Classify a document using LLM based on its content and structure template.

    Args:
        document_pages: List of document pages with content and metadata
        file_path: Path to the source file
        structure_template: Template structure for classification

    Returns:
        Dict containing classification results with predicted_category and confidence

    Raises:
        DocumentClassificationError: For classification-specific errors
        ValueError: For invalid input parameters
    """
    try:
        # Validate inputs
        _validate_classification_inputs(document_pages, file_path, structure_template)

        file_name = Path(file_path).stem
        logger.info(f"Starting classification for document: {file_name}")

        # Select pages for analysis based on file type
        file_extension = Path(file_path).suffix.lower()

        if file_extension in ['.xlsx', '.xls']:
            # For Excel files: process all sheets but limit to first 50 rows per sheet
            first_pages = _select_excel_pages(document_pages)
        else:
            # For other files: take first 5 pages as before
            first_pages = document_pages[:ClassificationConstants.DEFAULT_PAGES_TO_ANALYZE]

        if not first_pages:
            raise DocumentClassificationError(
                f"No pages available for classification in document: {file_name}"
            )

        # Prepare content for classification
        content_summary = _prepare_content_for_classification(file_name, first_pages)

        # Classify with LLM
        classification_result = _classify_document_with_llm(
            model=settings.LLM_CLASSIFICATION_MODEL,
            file_name=file_name,
            content_summary=content_summary,
            structure_template=structure_template,
            temperature=0.0,
            settings=settings,
            logger=logger
        )

        logger.info(
            f"Classification completed for {file_name}: "
            f"{classification_result.get('predicted_category', 'unknown')} "
            f"(confidence: {classification_result.get('final_confidence', 0.0):.3f})"
        )

        return classification_result

    except DocumentClassificationError:
        raise
    except Exception as e:
        error_msg = f"Unexpected error in classify_document for {file_path}: {str(e)}"
        logger.exception(error_msg)
        raise DocumentClassificationError(error_msg) from e


def _validate_classification_inputs(
    document_pages: List[Dict[str, Any]],
    file_path: str,
    structure_template: List[Dict[str, Any]]
) -> None:
    """Validate inputs for document classification."""
    if not document_pages or not isinstance(document_pages, list):
        raise ValueError("document_pages must be a non-empty list")

    if not file_path or not isinstance(file_path, str):
        raise ValueError("file_path must be a non-empty string")

    if not structure_template or not isinstance(structure_template, list):
        raise ValueError("structure_template must be a non-empty list")


def _select_excel_pages(document_pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Select and process Excel pages, limiting to first 50 rows per sheet.

    Args:
        document_pages: List of document pages with content and metadata

    Returns:
        List of processed pages with limited rows per sheet
    """
    try:
        selected_pages = []
        sheet_counts = {}  # Track how many pages we've processed per sheet

        for page in document_pages:
            metadata = page.get("metadata", {})
            sheet_name = metadata.get("sheet name", "")
            page_content = page.get("page_content", "")

            # Initialize count for this sheet if not seen before
            if sheet_name not in sheet_counts:
                sheet_counts[sheet_name] = 0

            # Skip if we already have 50 rows for this sheet
            if sheet_counts[sheet_name] >= ClassificationConstants.DEFAULT_EXCEL_SAMPLE_SIZE:
                continue

            # Process the page content to limit rows
            limited_content = _limit_excel_rows(page_content,
                                              ClassificationConstants.DEFAULT_EXCEL_SAMPLE_SIZE - sheet_counts[sheet_name])

            if limited_content:
                # Count actual rows in this page content
                rows_in_page = len([line for line in limited_content.split('\n') if line.strip()])
                sheet_counts[sheet_name] += rows_in_page

                # Create new page with limited content
                limited_page = {
                    **page,
                    "page_content": limited_content
                }
                selected_pages.append(limited_page)

        return selected_pages
    except Exception as e:
        logger.error(f"error occured in _select_excel_pages: {str(e)}")


def _limit_excel_rows(page_content: str, max_rows: int) -> str:
    """
    Limit Excel page content to specified number of rows.

    Args:
        page_content: Original page content in CSV-like format
        max_rows: Maximum number of rows to keep

    Returns:
        Limited content string
    """
    if not page_content or max_rows <= 0:
        return ""

    lines = page_content.split('\n')
    limited_lines = []
    row_count = 0

    for line in lines:
        if line.strip():  # Only count non-empty lines as rows
            if row_count >= max_rows:
                break
            limited_lines.append(line)
            row_count += 1
        else:
            # Keep empty lines but don't count them
            limited_lines.append(line)

    return '\n'.join(limited_lines)


def _classify_document_with_llm(
    model: str,
    file_name: str,
    content_summary: Dict[str, Any],
    structure_template: List[Dict[str, Any]],
    temperature: float,
    settings,
    logger
) -> Dict[str, Any]:
    """
    Classify document using LLM with Azure OpenAI.

    Args:
        model: LLM model to use
        file_name: Name of the file
        content_summary: Summary of content
        structure_template: Template structure
        temperature: Temperature parameter
        settings: Settings instance
        logger: Logger instance

    Returns:
        Dict: Classification result with metadata

    Raises:
        DocumentClassificationError: For classification-specific issues
        ValueError: For invalid parameters
    """
    try:
        # Validate LLM configuration
        if not settings.LITELLM_API_KEY or not settings.LITELLM_BASE_URL:
            raise ValueError("LLM configuration incomplete: missing API key or base URL")

        # Configure OpenAI client
        client = openai.OpenAI(
            api_key=settings.LITELLM_API_KEY,
            base_url=settings.LITELLM_BASE_URL
        )

        # Build classification prompt
        classification_prompt = _build_classification_prompt(
            file_name, content_summary, structure_template
        )

        logger.info(f"Starting Azure OpenAI classification for {file_name} with model {model}")

        # Call LLM
        response = _call_llm(client, model, classification_prompt, temperature)

        # Process response
        return _process_llm_response(response, file_name, content_summary, model, logger)

    except DocumentClassificationError:
        raise
    except openai.OpenAIError as e:
        error_msg = f"OpenAI API error for {file_name}: {str(e)}"
        logger.error(error_msg)
        raise DocumentClassificationError(error_msg) from e
    except Exception as e:
        error_msg = f"Unexpected error in LLM classification for {file_name}: {str(e)}"
        logger.exception(error_msg)
        raise DocumentClassificationError(error_msg) from e


def _call_llm(client, model: str, classification_prompt: str, temperature: float):
    """Call the LLM with the classification prompt."""
    try:
        system_message = _get_system_message()

        return client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": classification_prompt}
            ],
            #temperature=temperature,
            #top_p=0.95,
            #frequency_penalty=0,
            #presence_penalty=0,
        )
    except openai.OpenAIError as e:
        logger.error(f"OpenAI API error for {model}: {str(e)}")


def _process_llm_response(response, file_name: str, content_summary: Dict, model: str, logger):
    """Process the LLM response and return structured result."""
    # Validate response
    if not response.choices or not response.choices[0].message.content:
        raise DocumentClassificationError(f"Empty response from LLM for file: {file_name}")

    content = response.choices[0].message.content.strip()

    # Extract token usage information
    usage_info = {
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
        "total_tokens": response.usage.total_tokens
    }

    logger.info(f"Azure OpenAI response received. Tokens used: {usage_info['total_tokens']}")

    # Parse LLM response
    classification_result = _parse_llm_response(content, file_name)

    # Validate and enrich result
    return _validate_and_enrich_result(classification_result, content_summary, usage_info, model)


def _get_system_message() -> str:
    """Get the system message for LLM classification."""
    return """Tu es un expert en classification de documents. Analyse le titre du fichier et le contenu des premières pages pour classifier le document exactement selon la structure fournie.

Réponds UNIQUEMENT avec un JSON valide contenant:
- "files_classification": la catégorie principale identifiée
- "sub_classification": sous-catégorie si applicable
- "confidence": niveau de confiance (faible, moyen ou eleve)
- "reasoning": explication détaillée de ton analyse
- "key_elements": éléments clés trouvés dans le titre et contenu
- "document_type": type de document identifié

Format de réponse attendu:
{
    "files_classification": "...",
    "sub_classification": "...",
    "confidence": "eleve",
    "reasoning": "...",
    "key_elements": ["element1", "element2"],
    "document_type": "..."
}

IMPORTANT:
- Ta réponse doit être un JSON valide sans texte supplémentaire.
- Tu dois respecter la nomenclature des attributs de la structure fournie sans ajouter ni modifier les noms des classes."""


def _parse_llm_response(content: str, file_name: str) -> Dict[str, Any]:
    """Parse the LLM response JSON."""
    logger = get_logger("classifier-api.main")

    try:
        # Clean the response content
        cleaned_content = content.replace("```json", "").replace("```", "").strip()

        # Parse JSON
        result = json.loads(cleaned_content)

        if not isinstance(result, dict):
            raise DocumentClassificationError(
                f"Invalid response format for {file_name}: expected JSON object"
            )

        return result

    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing error for {file_name}: {cleaned_content[:200]}...")
        raise DocumentClassificationError(
            f"Failed to parse LLM response as JSON for {file_name}: {str(e)}"
        ) from e


def _build_classification_prompt(
    file_name: str,
    content_summary: Dict[str, Any],
    structure_template: List[Dict[str, Any]]
) -> str:
    """Build the classification prompt optimized for Azure OpenAI."""

    prompt_parts = [
        "=== ANALYSE DE DOCUMENT ===",
        "",
        f"📄 TITRE DU FICHIER: {file_name}",
        f"📁 TYPE DE FICHIER: {content_summary.get('file_type', 'unknown').upper()}",
        f"📊 PAGES/SHEETS ANALYSÉES: {content_summary.get('pages_analyzed', 0)}",
    ]

    # Add general information
    total_info = content_summary.get('total_info', {})
    if total_info:
        prompt_parts.extend([
            "",
            "📈 INFORMATIONS GÉNÉRALES:"
        ])
        for key, value in total_info.items():
            prompt_parts.append(f"  • {key.replace('_', ' ').title()}: {value}")

    prompt_parts.extend([
        "",
        "📋 CONTENU DES PREMIÈRES PAGES:",
        "=" * 50,
    ])

    # Limit content to avoid exceeding token limits
    content = content_summary.get('content', '')
    if len(content) > ClassificationConstants.DEFAULT_CONTENT_LIMIT:
        content = content[:ClassificationConstants.DEFAULT_CONTENT_LIMIT] + "\n\n[CONTENU TRONQUÉ...]"

    prompt_parts.append(content)

    prompt_parts.extend([
        "",
        "=" * 50,
        "",
        "🏗️ STRUCTURE JSON ATTENDUE (respect strict de la nomenclature des attributs) :",
        json.dumps(structure_template, indent=2, ensure_ascii=False),
        "",
        "🎯 CONSIGNE DE CLASSIFICATION :",
        "1. Analyse uniquement le TITRE et le CONTENU du document.",
        "2. Identifie le TYPE de document et justifie ton choix par les ÉLÉMENTS CLÉS.",
        "3. Utilise STRICTEMENT la STRUCTURE fournie comme modèle de sortie.",
        "   - Aucun attribut supplémentaire.",
        "   - Aucun renommage d'attributs.",
        "   - Aucun changement de format.",
        "4. Fournis un niveau de CONFIANCE parmi :",
        "   - 'faible' : classification incertaine ou document ambigu.",
        "   - 'moyen' : classification probable mais certains doutes subsistent.",
        "   - 'eleve' : classification très sûre, correspondance claire avec le type attendu.",
        "",
        "⚠️ RÈGLE FINALE :",
        "Réponds UNIQUEMENT avec un JSON valide et strictement conforme à la structure fournie.",
        "Aucun texte explicatif, aucun commentaire, aucun préfixe ou suffixe.",
    ])

    return "\n".join(prompt_parts)


def _validate_and_enrich_result(
    result: Dict[str, Any],
    content_summary: Dict[str, Any],
    usage_info: Dict[str, Any],
    model: str
) -> Dict[str, Any]:
    """Validate and enrich classification result."""

    # Map LLM response to expected output format
    predicted_category = result.get("files_classification", "unknown")
    confidence_level = result.get("confidence", "faible")

    # Convert confidence level to numeric score
    confidence_mapping = {
        "faible": 0.3,
        "moyen": 0.6,
        "eleve": 0.9
    }

    # Normalize confidence level
    if isinstance(confidence_level, str):
        confidence_level = confidence_level.lower().strip()
        if confidence_level not in ClassificationConstants.CONFIDENCE_LEVELS:
            confidence_level = "faible"

    final_confidence = confidence_mapping.get(confidence_level, 0.3)

    # Validate key elements
    key_elements = result.get("key_elements", [])
    if not isinstance(key_elements, list):
        key_elements = []

    # Build final result
    validated_result = {
        "predicted_category": predicted_category,
        "final_confidence": final_confidence,
        "confidence": confidence_level,
        "reasoning": result.get("reasoning", "No reasoning provided"),
        "key_elements": key_elements,
        "document_type": result.get("document_type", content_summary.get("file_type", "unknown")),
        "sub_classification": result.get("sub_classification"),
        "file_analysis_info": {
            "file_type": content_summary.get("file_type"),
            "pages_analyzed": content_summary.get("pages_analyzed"),
            "total_info": content_summary.get("total_info", {}),
            "content_length": len(content_summary.get("content", "")),
            "model_used": model,
            "token_usage": usage_info
        }
    }

    return validated_result


def _prepare_content_for_classification(file_name: str, pages_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Prepare content from first pages for classification."""

    content_parts = []
    file_type = None
    total_info = {}

    for i, page_data in enumerate(pages_data):
        metadata = page_data["metadata"]
        content = page_data["page_content"]

        if not file_type:
            file_extension = Path(metadata.get("source", "")).suffix.lower()
            if file_extension in ['.xlsx', '.xls']:
                file_type = "excel"
            else:
                file_type = "unknown"

        if file_type == "excel":
            sheet_name = metadata.get("sheet_name", f"Sheet{i + 1}")
            content_parts.append(f"Sheet '{sheet_name}':\n{content}\n")
            total_info["total_sheets"] = metadata.get("total_sheets", len(pages_data))
        else:
            page_num = metadata.get('page_number', i + 1)
            content_parts.append(f"Page {page_num}:\n{content}\n")
            total_info["total_pages"] = metadata.get("total_pages", len(pages_data))

    return {
        "file_name": file_name,
        "file_type": file_type,
        "content": "\n".join(content_parts),
        "pages_analyzed": len(pages_data),
        "total_info": total_info
    }

def _dataframe_to_readable_text(df: pd.DataFrame, sheet_name: str) -> str:
    """Convert DataFrame to readable text for LLM."""

    lines = [f"Sheet: {sheet_name}"]
    lines.append("=" * (len(sheet_name) + 7))
    lines.append("")

    # General information
    lines.append(f"Données: {len(df)} lignes, {len(df.columns)} colonnes")
    lines.append(f"Colonnes: {', '.join(df.columns.tolist())}")
    lines.append("")

    # Data preview
    lines.append("Aperçu des données:")
    lines.append("-" * 20)

    # Convert DataFrame to string with formatting
    df_str = df.to_string(index=True, max_rows=ClassificationConstants.DEFAULT_EXCEL_SAMPLE_SIZE, max_cols=None)
    lines.append(df_str)

    # Basic statistics for numeric columns
    numeric_cols = df.select_dtypes(include=['number']).columns
    if len(numeric_cols) > 0:
        lines.extend([
            "",
            "Statistiques des colonnes numériques:",
            "-" * 35
        ])
        stats = df[numeric_cols].describe()
        lines.append(stats.to_string())

    return "\n".join(lines)
