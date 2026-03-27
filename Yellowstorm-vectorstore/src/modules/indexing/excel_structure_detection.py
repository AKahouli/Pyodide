"""
Excel Structure Detection Module

This module provides functionality to detect whether an Excel file is structured
(tabular data with headers) or unstructured (narrative text, reports, etc.)
using LLM-based classification.
"""

import os
import pandas as pd
from typing import List, Optional
from pydantic import BaseModel, Field

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.modules.indexing.prompts import (
    EXCEL_STRUCTURE_DETECTION_SYSTEM_PROMPT,
    EXCEL_STRUCTURE_DETECTION_USER_PROMPT
)

logger = get_logger(__name__)

# ============================================================
# Pydantic Models for Structured Output
# ============================================================


class ExcelStructureResult(BaseModel):
    """Result of Excel structure classification"""
    classification: str = Field(
        description="One of: structured, unstructured"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in the classification"
    )
    header_row: Optional[int] = Field(
        default=None,
        description="1-based index of header row, or null if none"
    )
    table_count: int = Field(
        default=1,
        description="Number of logical tables detected"
    )
    reasoning: List[str] = Field(
        default_factory=list,
        description="Short bullet-point explanations"
    )

    def is_structured(self) -> bool:
        """Check if the Excel file is classified as structured"""
        return self.classification.lower() == "structured"

# ============================================================
# Excel Snapshot Generation
# ============================================================


def excel_to_snapshot(path: str, max_rows: int = 15, max_cols: int = 10) -> str:
    """
    Converts an Excel sheet into a compact textual snapshot
    suitable for LLM reasoning.

    Parameters
    ----------
    path : str
        Path to the Excel file
    max_rows : int
        Maximum number of rows to include in snapshot
    max_cols : int
        Maximum number of columns to include in snapshot

    Returns
    -------
    str
        Textual representation of the Excel sheet
    """
    try:
        df = pd.read_excel(path, header=None)
        rows, cols = df.shape

        lines = [f"Sheet size: {rows} rows x {cols} columns\n"]

        for i in range(min(max_rows, rows)):
            row_cells = []
            for j in range(min(max_cols, cols)):
                value = df.iat[i, j]
                row_cells.append("EMPTY" if pd.isna(value) else str(value))
            lines.append(f"Row {i+1}: {row_cells}")

        return "\n".join(lines)
    except Exception as e:
        logger.error(f"Error creating Excel snapshot: {e}")
        raise


# ============================================================
# LLM-based Structure Classification
# ============================================================


async def classify_excel_structure_async(path: str) -> ExcelStructureResult:
    """
    Async classify an Excel file as structured or unstructured using LLM.

    Uses settings.LITELLM_API_KEY, settings.LITELLM_BASE_URL,
    and settings.LLM_CLASSIFICATION_MODEL for configuration.

    Parameters
    ----------
    path : str
        Path to the Excel file to classify

    Returns
    -------
    ExcelStructureResult
        Classification result with confidence and reasoning
    """
    settings = get_settings()

    api_key = settings.LITELLM_API_KEY
    base_url = settings.LITELLM_BASE_URL
    model_name = settings.LLM_CLASSIFICATION_MODEL

    if not api_key:
        raise ValueError("LITELLM_API_KEY not configured")

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )
    except ImportError:
        raise ImportError("OpenAI package is required for Excel structure detection")

    # Generate snapshot for LLM analysis
    snapshot = excel_to_snapshot(path)

    messages = [
        {
            "role": "system",
            "content": EXCEL_STRUCTURE_DETECTION_SYSTEM_PROMPT
        },
        {
            "role": "user",
            "content": EXCEL_STRUCTURE_DETECTION_USER_PROMPT.format(snapshot=snapshot)
        }
    ]

    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "excel_structure_result",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "classification": {
                                "type": "string",
                                "enum": ["structured", "unstructured"]
                            },
                            "confidence": {
                                "type": "number",
                                "minimum": 0.0,
                                "maximum": 1.0
                            },
                            "header_row": {
                                "type": ["integer", "null"],
                                "description": "1-based index of header row if present"
                            },
                            "table_count": {
                                "type": "integer",
                                "minimum": 0
                            },
                            "reasoning": {
                                "type": "array",
                                "items": {"type": "string"}
                            }
                        },
                        "required": [
                            "classification",
                            "confidence",
                            "header_row",
                            "table_count",
                            "reasoning"
                        ],
                        "additionalProperties": False
                    }
                }
            }
        )

        # Parse the JSON response
        import json
        result_data = json.loads(response.choices[0].message.content)
        return ExcelStructureResult(**result_data)

    except Exception as e:
        logger.error(f"Error during async LLM classification: {e}")
        # Return unstructured as fallback
        return ExcelStructureResult(
            classification="unstructured",
            confidence=0.0,
            header_row=None,
            table_count=0,
            reasoning=[f"Classification failed: {str(e)}"]
        )


def classify_excel_structure(path: str) -> ExcelStructureResult:
    """
    Classify an Excel file as structured or unstructured using LLM.

    Uses settings.LITELLM_API_KEY, settings.LITELLM_BASE_URL,
    and settings.LLM_CLASSIFICATION_MODEL for configuration.

    Parameters
    ----------
    path : str
        Path to the Excel file to classify

    Returns
    -------
    ExcelStructureResult
        Classification result with confidence and reasoning
    """
    settings = get_settings()

    api_key = settings.LITELLM_API_KEY
    base_url = settings.LITELLM_BASE_URL
    model_name = settings.LLM_CLASSIFICATION_MODEL

    if not api_key:
        raise ValueError("LITELLM_API_KEY not configured")

    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )
    except ImportError:
        raise ImportError("OpenAI package is required for Excel structure detection")

    # Generate snapshot for LLM analysis
    snapshot = excel_to_snapshot(path)

    messages = [
        {
            "role": "system",
            "content": EXCEL_STRUCTURE_DETECTION_SYSTEM_PROMPT
        },
        {
            "role": "user",
            "content": EXCEL_STRUCTURE_DETECTION_USER_PROMPT.format(snapshot=snapshot)
        }
    ]

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "excel_structure_result",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "classification": {
                                "type": "string",
                                "enum": ["structured", "unstructured"]
                            },
                            "confidence": {
                                "type": "number",
                                "minimum": 0.0,
                                "maximum": 1.0
                            },
                            "header_row": {
                                "type": ["integer", "null"],
                                "description": "1-based index of header row if present"
                            },
                            "table_count": {
                                "type": "integer",
                                "minimum": 0
                            },
                            "reasoning": {
                                "type": "array",
                                "items": {"type": "string"}
                            }
                        },
                        "required": [
                            "classification",
                            "confidence",
                            "header_row",
                            "table_count",
                            "reasoning"
                        ],
                        "additionalProperties": False
                    }
                }
            }
        )

        # Parse the JSON response
        import json
        result_data = json.loads(response.choices[0].message.content)
        return ExcelStructureResult(**result_data)

    except Exception as e:
        logger.error(f"Error during LLM classification: {e}")
        # Return unstructured as fallback
        return ExcelStructureResult(
            classification="unstructured",
            confidence=0.0,
            header_row=None,
            table_count=0,
            reasoning=[f"Classification failed: {str(e)}"]
        )


# ============================================================
# Convenience Function for Chain Processing
# ============================================================


async def detect_and_classify_excel_async(file_path: str) -> dict:
    """
    Async detect if file is Excel and classify its structure.

    This is a convenience function for use in async workflows.
    Returns a dict that can be easily serialized.

    Parameters
    ----------
    file_path : str
        Path to the file to check

    Returns
    -------
    dict
        Dictionary with keys:
        - is_excel: bool
        - is_structured: bool (only if is_excel=True)
        - classification: dict (only if is_excel=True)
        - error: str (present if classification failed)
    """
    ext = os.path.splitext(file_path)[-1].lower()

    if ext not in ['.xls', '.xlsx']:
        return {
            "is_excel": False,
            "is_structured": False,
            "classification": None
        }

    try:
        result = await classify_excel_structure_async(file_path)
        return {
            "is_excel": True,
            "is_structured": result.is_structured(),
            "classification": result.model_dump()
        }
    except Exception as e:
        logger.error(f"Error classifying Excel file {file_path}: {e}")
        # Default to unstructured on error
        return {
            "is_excel": True,
            "is_structured": False,
            "classification": None,
            "error": str(e)
        }


def detect_and_classify_excel(file_path: str) -> dict:
    """
    Detect if file is Excel and classify its structure.

    This is a convenience function for use in Celery tasks.
    Returns a dict that can be easily serialized.

    Parameters
    ----------
    file_path : str
        Path to the file to check

    Returns
    -------
    dict
        Dictionary with keys:
        - is_excel: bool
        - is_structured: bool (only if is_excel=True)
        - classification: dict (only if is_excel=True)
        - error: str (present if classification failed)
    """
    ext = os.path.splitext(file_path)[-1].lower()

    if ext not in ['.xls', '.xlsx']:
        return {
            "is_excel": False,
            "is_structured": False,
            "classification": None
        }

    try:
        result = classify_excel_structure(file_path)
        return {
            "is_excel": True,
            "is_structured": result.is_structured(),
            "classification": result.model_dump()
        }
    except Exception as e:
        logger.error(f"Error classifying Excel file {file_path}: {e}")
        # Default to unstructured on error
        return {
            "is_excel": True,
            "is_structured": False,
            "classification": None,
            "error": str(e)
        }
