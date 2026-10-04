"""Graph search settings: how records are cut into searchable text, and how a request is matched.

Two groups, both set by an administrator in YellowStorm and sent by NestJS with each index or
search request (only the values the administrator set; the rest are the defaults below, which
were the module constants before the settings existed):

* ``IndexSettings`` decide the text that is indexed (card caps, passages). They are part of the
  index generation's fingerprint: a change builds a new generation on the next request.
  A concept field can override the passage settings (``FieldIndexSettings``), for instance to
  search an e-mail body to its end with smaller passages.
* ``SearchSettings`` decide how one request is answered (candidates, fusion, stop words, excerpt
  sizes). They apply per request and never rebuild anything.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

__all__ = ["FieldIndexSettings", "IndexSettings", "SearchSettings", "SettingsPayload",
           "ValidationError", "index_fingerprint"]


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


class FieldIndexSettings(BaseModel):
    """One concept field's own passage settings; anything left out uses the global value."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True, frozen=True)

    passages: bool | None = None
    long_field_chars: int | None = Field(default=None, alias="longFieldChars", ge=50, le=2000)
    passage_target_chars: int | None = Field(default=None, alias="passageTargetChars", ge=200, le=4000)
    passage_min_chars: int | None = Field(default=None, alias="passageMinChars", ge=100, le=4000)
    passage_max_chars: int | None = Field(default=None, alias="passageMaxChars", ge=200, le=6000)
    passage_overlap_chars: int | None = Field(default=None, alias="passageOverlapChars", ge=0, le=1000)
    max_passages_per_field: int | None = Field(default=None, alias="maxPassagesPerField", ge=1, le=200)


class IndexSettings(BaseModel):
    """What one record's indexed text is made of. ``fields``: concept key -> field key -> override."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True, frozen=True)

    card_value_chars: int = Field(default=300, alias="cardValueChars", ge=100, le=2000)
    card_text_chars: int = Field(default=2000, alias="cardTextChars", ge=500, le=10000)
    # None: the card value cap (a value cut on the card is always searched through passages).
    long_field_chars: int | None = Field(default=None, alias="longFieldChars", ge=50, le=2000)
    passage_target_chars: int = Field(default=1000, alias="passageTargetChars", ge=200, le=4000)
    passage_min_chars: int = Field(default=700, alias="passageMinChars", ge=100, le=4000)
    passage_max_chars: int = Field(default=1200, alias="passageMaxChars", ge=200, le=6000)
    passage_overlap_chars: int = Field(default=150, alias="passageOverlapChars", ge=0, le=1000)
    max_passages_per_field: int = Field(default=20, alias="maxPassagesPerField", ge=1, le=200)
    max_passages_per_record: int = Field(default=50, alias="maxPassagesPerRecord", ge=1, le=500)
    passage_header: bool = Field(default=True, alias="passageHeader")
    fields: dict[str, dict[str, FieldIndexSettings]] = Field(default_factory=dict, max_length=500)

    @model_validator(mode="after")
    def consistent(self) -> "IndexSettings":
        if self.card_text_chars < self.card_value_chars:
            raise ValueError("cardTextChars must be at least cardValueChars")
        if self.long_field_chars is not None and self.long_field_chars > self.card_value_chars:
            raise ValueError("longFieldChars must be at most cardValueChars")
        if self.max_passages_per_record < self.max_passages_per_field:
            raise ValueError("maxPassagesPerRecord must be at least maxPassagesPerField")
        _check_passage(self.passage_min_chars, self.passage_target_chars, self.passage_max_chars,
                       self.passage_overlap_chars, "")
        for concept, overrides in self.fields.items():
            for field in overrides:
                plan = self.for_field(concept, field)
                _check_passage(plan.min_chars, plan.target_chars, plan.max_chars, plan.overlap_chars,
                               f"fields.{concept}.{field}: ")
        return self

    @property
    def threshold(self) -> int:
        return self.long_field_chars if self.long_field_chars is not None else self.card_value_chars

    def for_field(self, concept_key: str, field: str) -> "PassagePlan":
        """The passage settings of one field: its own over the global ones."""
        own = (self.fields.get(concept_key) or {}).get(field) or FieldIndexSettings()

        def pick(name: str) -> Any:
            value = getattr(own, name)
            return getattr(self, name) if value is None else value

        threshold = own.long_field_chars if own.long_field_chars is not None else self.threshold
        return PassagePlan(
            # A value cut on the card stays searchable unless the field says otherwise.
            enabled=own.passages is not False, threshold=min(threshold, self.card_value_chars),
            target_chars=pick("passage_target_chars"), min_chars=pick("passage_min_chars"),
            max_chars=pick("passage_max_chars"), overlap_chars=pick("passage_overlap_chars"),
            max_per_field=pick("max_passages_per_field"))

    def is_default(self) -> bool:
        return self.canonical() == _DEFAULT_CANONICAL

    def canonical(self) -> dict[str, Any]:
        """Every value that shapes the indexed text, empty overrides left out (stable for hashing)."""
        body = self.model_dump(by_alias=True, exclude={"fields"})
        body["longFieldChars"] = self.threshold
        fields = {concept: {field: own.model_dump(by_alias=True, exclude_none=True)
                            for field, own in sorted(overrides.items())
                            if own.model_dump(exclude_none=True)}
                  for concept, overrides in sorted(self.fields.items())}
        body["fields"] = {concept: overrides for concept, overrides in fields.items() if overrides}
        return body


class PassagePlan(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool = True
    threshold: int = 300
    target_chars: int = 1000
    min_chars: int = 700
    max_chars: int = 1200
    overlap_chars: int = 150
    max_per_field: int = 20


def _check_passage(low: int, target: int, high: int, overlap: int, where: str) -> None:
    if not low < target < high:
        raise ValueError(f"{where}passage sizes must be min < target < max")
    if overlap >= low:
        raise ValueError(f"{where}passageOverlapChars must be below passageMinChars")


_DEFAULT_CANONICAL = IndexSettings().canonical()


class SearchSettings(BaseModel):
    """How one request is matched; applies per request."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True, frozen=True)

    lexical_candidates: int = Field(default=50, alias="lexicalCandidates", ge=5, le=500)
    vector_candidates: int = Field(default=50, alias="vectorCandidates", ge=5, le=500)
    # 0.4 from first live qwen3 probes: unrelated records scored 0.34-0.37 against a key,
    # related ones 0.46-0.59; calibrate on gold queries (plan G5).
    min_similarity: float = Field(default_factory=lambda: _env_float("SEMANTIC_SEARCH_MIN_SIMILARITY", 0.4),
                                  alias="minSimilarity", ge=0, le=1)
    rrf_k: int = Field(default=60, alias="rrfK", ge=1, le=1000)
    default_limit: int = Field(default=10, alias="defaultLimit", ge=1, le=100)
    max_limit: int = Field(default=25, alias="maxLimit", ge=1, le=100)
    passages_per_record: int = Field(default=2, alias="passagesPerRecord", ge=0, le=10)
    excerpt_chars: int = Field(default=400, alias="excerptChars", ge=100, le=4000)
    snippet_chars: int = Field(default=400, alias="snippetChars", ge=100, le=4000)
    stop_words: bool = Field(default=True, alias="stopWords")
    extra_stop_words: tuple[str, ...] = Field(default=(), alias="extraStopWords", max_length=500)
    max_query_terms: int = Field(default=16, alias="maxQueryTerms", ge=1, le=64)

    @model_validator(mode="after")
    def consistent(self) -> "SearchSettings":
        if self.default_limit > self.max_limit:
            raise ValueError("defaultLimit must be at most maxLimit")
        if any(not isinstance(word, str) or not 1 <= len(word) <= 40 for word in self.extra_stop_words):
            raise ValueError("extraStopWords must be words of 1 to 40 characters")
        return self

    def limit(self, asked: int | None) -> int:
        return min(asked if asked is not None else self.default_limit, self.max_limit)


class SettingsPayload(BaseModel):
    """What NestJS sends with a request: the values an administrator set (and field overrides)."""
    model_config = ConfigDict(extra="forbid")

    index: IndexSettings = Field(default_factory=IndexSettings)
    search: SearchSettings = Field(default_factory=SearchSettings)


def index_fingerprint(embedding_fingerprint: str, settings: IndexSettings | None) -> str:
    """The generation fingerprint: the embedding profile's, plus the index settings when they
    differ from the defaults (default settings keep the generations built before settings existed)."""
    if settings is None or settings.is_default():
        return embedding_fingerprint
    body = json.dumps(settings.canonical(), sort_keys=True, separators=(",", ":"))
    return f"{embedding_fingerprint}:ix:{hashlib.sha256(body.encode('utf-8')).hexdigest()[:16]}"
