"""
Hybrid filter utilities for Qdrant queries.
Supports:
- Hard filters (must)
- Soft keyword filters (should)
"""

from typing import Any, Dict, List, Optional

from qdrant_client.models import (
    Filter,
    FieldCondition,
    MatchValue,
    MatchAny,
)

from src.logger.logging import get_logger

logger = get_logger(__name__)


# Only allow fields that actually exist in payload
ALLOWED_FIELDS = {
    "brain_id": "metadata.brain_id",
    "language": "metadata.language",
    "external_id": "metadata.external_id",
    "type": "metadata.type",
}


def _is_valid_value(value: Any) -> bool:
    """Remove empty / invalid values."""
    if value is None:
        return False
    if isinstance(value, str) and value.strip() == "":
        return False
    if isinstance(value, list) and (
        len(value) == 0 or all(v in ("", None) for v in value)
    ):
        return False
    return True


def dict_to_qdrant_filter(
    filter: Optional[Dict[str, Any]] = None
) -> Optional[Filter]:

    if not filter:
        return None

    must_conditions: List[FieldCondition] = []
    should_conditions: List[FieldCondition] = []
    must_not_conditions: List[FieldCondition] = []

    # If external_id is present, only use external_id for filtering (ignore brain_id)
    # If brain_id is present without external_id, use brain_id for filtering
    has_external_id = "external_id" in filter and _is_valid_value(filter["external_id"])

    for key, value in filter.items():

        # Skip invalid values
        if not _is_valid_value(value):
            continue

        # Skip brain_id if external_id is present (external_id takes precedence)
        if has_external_id and key == "brain_id":
            continue

        try:
            # ---------- HARD FILTERS ----------

            if key in ALLOWED_FIELDS:

                qdrant_key = ALLOWED_FIELDS[key]

                # Use should (OR) for brain_id to allow searching across multiple brains
                # Use must (AND) for external_id to restrict search to specific documents
                # Use must (AND) for other fields like language, type
                use_should = key == "brain_id"

                if isinstance(value, list):
                    condition = FieldCondition(
                        key=qdrant_key,
                        match=MatchAny(any=value),
                    )
                else:
                    condition = FieldCondition(
                        key=qdrant_key,
                        match=MatchValue(value=value),
                    )

                if use_should:
                    should_conditions.append(condition)
                else:
                    must_conditions.append(condition)

            # ---------- IDS CLASSIFICATION ----------

            elif key == "ids_classification" and isinstance(value, list):

                must_conditions.append(
                    FieldCondition(
                        key="id",
                        match=MatchAny(any=value),
                    )
                )

            # ---------- KEYWORDS (disabled for hybrid vector search) ----------

            elif key == "keywords":
                logger.warning(
                    "Keywords filter ignored for hybrid/vector search."
                )
                continue

            # ---------- IMAGE (only if you truly store it) ----------

            elif key == "image":
                # If user sends image=True → filter only images
                if value is True:
                    must_conditions.append(
                        FieldCondition(
                            key="metadata.type",
                            match=MatchValue(value="image"),
                        )
                    )
                # If image=False → exclude images
                elif value is False:
                    must_not_conditions.append(
                        FieldCondition(
                            key="metadata.type",
                            match=MatchValue(value="image"),
                        )
                    )

            # ---------- UNKNOWN FIELD ----------

            else:
                logger.warning(
                    f"Ignoring unsupported filter field: {key}"
                )
                continue

        except Exception as e:
            logger.warning(
                f"Error processing filter key={key}, value={value}: {str(e)}"
            )

    if not must_conditions and not should_conditions:
        return None

    return Filter(
        must=must_conditions or None,
        should=should_conditions or None,
    )


def build_exclusion_filter(ids_to_exclude: List[str]) -> Optional[Filter]:
    """Exclude specific Qdrant point IDs."""

    if not ids_to_exclude:
        return None

    return Filter(
        must_not=[
            FieldCondition(
                key="id",
                match=MatchValue(value=id_),
            )
            for id_ in ids_to_exclude
        ]
    )
