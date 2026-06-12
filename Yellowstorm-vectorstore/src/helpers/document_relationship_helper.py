peux tu trouver le doc Suivi des candidats.xlsx and import it in the current workspace @Auditor 

import json
from typing import List, Dict, Any

import fitz
import re2 as re
from fastapi import HTTPException
from openai import AsyncAzureOpenAI, OpenAI, AsyncOpenAI

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.middleware.correlation import get_user
from src.schema.workers.doc_relationship import AttributeSpec

logger = get_logger("api.main")


def load_pdf_pages(path: str) -> List[str]:
    logger.info("Loading PDF pages")
    """
    Load PDF from a local file path using PyMuPDF and return a list of page texts.
    """
    pdf = fitz.open(path)
    pages = [page.get_text("text") or "" for page in pdf]
    pdf.close()
    logger.info(f"Loaded {len(pages)} pages from PDF")
    return pages


settings = get_settings()
client = AsyncOpenAI(
    api_key=settings.LITELLM_API_KEY,
    base_url=settings.LITELLM_BASE_URL,

)


async def extract_attributes(
    pages: List[str],
    specs: List[AttributeSpec]
) -> Dict[str, Any]:
    logger.info(f"Starting attribute extraction for {len(specs)} specifications")
    """
    Use the LLM to extract a dynamic list of attributes (with descriptions) from PDF pages.
    Returns a dict mapping each spec.name to its extracted value or null.
    """
    logger.info(f"Processing {len(pages)} pages for attribute extraction")
    # Build a bullet list of the fields to extract
    fields_desc = "\n".join(
        f"- `{spec.name}`: {spec.description}"
        for spec in specs
    )

    joined = "\n\n".join(f"Page {i + 1}: {p}" for i, p in enumerate(pages))
    prompt = (
        "You are a JSON-only assistant.\n"
        "Extract these fields from the PDF pages in JSON only (no commentary):\n"
        f"{fields_desc}\n"
        "- `description`: a brief description/summary of the document content"
        "If a field is missing, return null.\n\n"
        f"PDF pages:\n{joined}"
    )

    logger.info("Making API call for attribute extraction")
    resp = await client.chat.completions.create(
        model="gpt-4.1",
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )
    logger.info("Attribute extraction API call completed")
    content = resp.choices[0].message.content.strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content).strip()

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        logger.exception(f"JSON decode error in extract_hierarchy: {e}")
        raise HTTPException(status_code=500, detail=f"Invalid JSON from LLM: {content}")

    # If a list is returned, take the first object
    if isinstance(data, list):
        if data and isinstance(data[0], dict):
            data = data[0]
        else:
            raise HTTPException(status_code=500, detail=f"Unexpected JSON format from LLM: {content}")

    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail=f"Expected JSON object, got: {content}")

    return data


async def generate_relationships(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Ask the LLM to infer parent/child relationships among documents based on metadata.
    Returns a list of {"children": [...]} entries parallel to the input list.
    """
    prompt = (
        "You are given a list of documents with metadata fields. Based on these fields, determine which document is "
        "the child of which. Each document can have a 'children' field that lists its related documents.\n\n"
        "ONLY return a json without any additional commentary where each entry has a \"children\" field listing doc_ids of its child documents.\n"
        "Example output format:\n"
        "[ { \"children\": [\"doc2\"] }, { \"children\": [] } ]\n"
        f"Input documents:\n{json.dumps(docs, indent=2)}"
    )
    resp = await client.chat.completions.create(
        model="gpt-4.1",
        messages=[{"role": "user", "content": prompt}],
        user=get_user(),
        temperature=0
    )
    content = resp.choices[0].message.content.strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content).strip()

    try:
        rels = json.loads(content)
    except json.JSONDecodeError as e:
        logger.exception(f"JSON decode error in extract_relationships: {e}")
        raise HTTPException(status_code=500, detail=f"Invalid relationships JSON from LLM: {content}")
    if not isinstance(rels, list):
        raise HTTPException(status_code=500, detail=f"Expected list of relationships, got: {content}")
    return rels

