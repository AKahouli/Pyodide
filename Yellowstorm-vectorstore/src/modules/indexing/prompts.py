"""
Prompts for indexing-related tasks.

This module contains prompts used by various LLM-based operations
during the document indexing process.
"""

# ============================================================
# Excel Structure Detection Prompts
# ============================================================

EXCEL_STRUCTURE_DETECTION_SYSTEM_PROMPT = (
    "You are a senior data engineering expert. "
    "You analyze spreadsheet layout and structure."
)

EXCEL_STRUCTURE_DETECTION_USER_PROMPT = """
You are a senior data engineering expert.

Your task is to determine whether an Excel sheet is:
- structured
- unstructured

Definitions:
- Structured: A single machine-readable table with a header row, multiple columns, and consistent rows.
- Unstructured: Narrative text, reports, lists, or repeated descriptive blocks that are not tabular.

Important rules:
- Repeated text patterns (e.g., "Customer: X") are NOT tables.
- Pure text consistency does NOT imply structure.

Analyze layout, repetition, and intent — not keywords.

Sheet snapshot:
{snapshot}
"""

# ============================================================
# Classification Prompts (for reference)
# ============================================================

DOCUMENT_CLASSIFICATION_SYSTEM_PROMPT = "You are a document classifier. Follow the user's instructions precisely."

DOCUMENT_CLASSIFICATION_USER_PROMPT = """You are an expert document classifier. You will receive partial chunks from the beginning
of a document. Your task is to:

1. Analyze the content to identify the main topic and purpose
2. Classify the document into one of the provided categories
3. Provide a confidence score for your classification

Categories:
{categories}

Document Content:
{content}

Output your response as JSON with the following structure:
{{
    "predicted_category": "<category name>",
    "confidence": <0.0 to 1.0>,
    "reasoning": "<brief explanation>"
}}
"""
