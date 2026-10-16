"""Semantic Model attribute extraction.

Fills the concepts no spreadsheet column carries by reading document evidence
with an LLM. Graph construction, ontology generation and mapping planning moved
to the semantic-model-runtime service.
"""

from .attribute_extractor import AttributeExtractionAgent

__all__ = ["AttributeExtractionAgent"]
