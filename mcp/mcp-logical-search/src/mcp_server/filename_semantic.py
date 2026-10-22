"""Bounded semantic filename scoring without changes to stored indexing data."""
import math

from src.config.settings import get_settings
from src.modules.embeddings import embedding_configured, get_embeddings, prepare_embedding
from src.modules.model_requests import run_sync_model_request
from src.mcp_server.filename_relevance import filename_search_query, normalized_filename


def _embed(texts, dimension):
    unique_texts = list(dict.fromkeys(texts))
    returned = get_embeddings("mcp_filename_search").embed_documents(unique_texts)
    if len(returned) != len(unique_texts):
        raise ValueError("filename embedding count mismatch")
    vectors = {}
    for value, vector in zip(unique_texts, returned):
        vector = prepare_embedding(vector)
        if len(vector) != dimension or not all(math.isfinite(number) for number in vector):
            raise ValueError("invalid filename embedding")
        vectors[value] = tuple(vector)
    return vectors


def _scores(query, documents, dimension):
    focused_query = filename_search_query(query, documents)
    if not focused_query:
        return {}
    names = {key: normalized_filename(value["file_name"]) for key, value in documents.items()}
    vectors = _embed([focused_query, *names.values()], dimension)
    query_vector = vectors[focused_query]
    query_norm = math.sqrt(sum(value * value for value in query_vector))
    scores = {}
    for key, name in names.items():
        vector = vectors[name]
        denominator = query_norm * math.sqrt(sum(value * value for value in vector))
        cosine = sum(a * b for a, b in zip(query_vector, vector)) / denominator if denominator else 0.0
        # Raw cosine is used only to order filenames; final fusion uses ranks.
        scores[key] = max(0.0, min(1.0, cosine))
    eligible = {key: value for key, value in scores.items() if value >= get_settings().SEARCH_MIN_SCORE}
    levels = sorted(set(eligible.values()), reverse=True)
    ranks = {value: rank for rank, value in enumerate(levels, 1)}
    rrf_k = get_settings().HYBRID_RRF_K
    return {key: (rrf_k + 1) / (rrf_k + ranks[value]) for key, value in eligible.items()}


async def filename_semantic_scores(query, documents, deadline=None):
    settings = get_settings()
    if not documents or not embedding_configured(settings):
        return {}
    return await run_sync_model_request(lambda: _scores(query, documents, settings.EMBEDDING_DIMENSION),
        timeout=settings.SEARCH_FILENAME_SEMANTIC_TIMEOUT_SECONDS, deadline=deadline)
