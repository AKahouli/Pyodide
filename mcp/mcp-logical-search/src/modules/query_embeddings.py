"""Generate a fresh query vector within model admission and deadline budgets."""
from src.modules.embeddings import get_embeddings, prepare_embedding
from src.modules.model_requests import run_sync_model_request


async def get_query_embedding(query, workspace_id, embedding_user, *, timeout, deadline=None):
    return await run_sync_model_request(
        lambda: prepare_embedding(get_embeddings(embedding_user).embed_query(query, user=embedding_user)),
        timeout=timeout, deadline=deadline)
