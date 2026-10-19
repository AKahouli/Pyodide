import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import src.mcp_server.logical_indexing_server as server
from src.modules import model_requests, query_translation


class SearchBudgetTests(unittest.TestCase):
    def setUp(self):
        transport = patch.object(query_translation, "model_http_client")
        transport.start()
        self.addCleanup(transport.stop)

    def test_slow_translation_or_admission_leaves_time_for_retrieval(self):
        async def run(saturated):
            async def stalled_provider(**kwargs):
                await asyncio.Event().wait()

            completion = AsyncMock(side_effect=stalled_provider)
            client = SimpleNamespace(
                chat=SimpleNamespace(completions=SimpleNamespace(create=completion)),
                close=AsyncMock(),
            )
            calls = []

            async def run_db(operation, *, deadline):
                calls.append(deadline)
                if len(calls) == 1:
                    return {"doc": {"file_name": "test.pdf", "fts_config": "french"}}, ["french"]
                # Translation must leave the reserved 300 ms for retrieval.
                self.assertGreater(deadline - time.monotonic(), 0.2)
                return operation(object())

            with patch.multiple(
                server.settings, SEARCH_REQUEST_TIMEOUT_SECONDS=0.5,
                SEARCH_RETRIEVAL_RESERVE_SECONDS=0.3,
                QUERY_TRANSLATION_TIMEOUT_SECONDS=30.0,
                LITELLM_BASE_URL="https://model.invalid", LITELLM_API_KEY="test",
            ), patch.object(server, "_require_search_scope"), patch.object(
                server, "_run_db", side_effect=run_db,
            ), patch.object(server, "_prepare_filename_semantic_scores", AsyncMock(return_value={})), patch.object(server, "search_section_evidence", return_value=[]), patch.object(
                server, "get_query_embedding", AsyncMock(return_value=[0.1]),
            ), patch.object(server, "unified_search", return_value=[{"section_id": 101}]) as search, patch.object(
                query_translation, "detect_language", return_value="en",
            ), patch.object(query_translation, "AsyncOpenAI", return_value=client), patch.object(
                model_requests, "_semaphore", return_value=asyncio.Semaphore(0 if saturated else 1),
            ):
                result = await server.search.fn.__wrapped__(query="quantity", workspace_id="workspace")
                client.close.assert_not_awaited()
                await query_translation.close_translation_client()

            self.assertEqual([section["section_id"] for document in result["documents"] for section in document["sections"]], [101])
            self.assertEqual(search.call_args.kwargs["fts_query_variants"], {"french": ["quantity"]})
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0], calls[1])
            self.assertEqual(completion.await_count, 0 if saturated else 1)
            client.close.assert_awaited_once()

        for saturated in (False, True):
            with self.subTest(saturated=saturated):
                asyncio.run(run(saturated))

    def test_translation_is_skipped_when_only_retrieval_reserve_remains(self):
        with patch.multiple(
            server.settings, SEARCH_RETRIEVAL_RESERVE_SECONDS=5.0,
            LITELLM_BASE_URL="https://model.invalid", LITELLM_API_KEY="test",
        ), patch.object(server, "_run_db", AsyncMock(return_value=["french"])), patch.object(
            server, "get_query_embedding", AsyncMock(return_value=[0.1]),
        ), patch.object(
            query_translation, "detect_language",
        ) as detect, patch.object(query_translation, "AsyncOpenAI") as client:
            result = asyncio.run(server._prepare_hybrid_search(
                "quantity", "workspace", None, "test", deadline=time.monotonic() + 1,
            ))

        self.assertEqual(result.fts_query_variants, {"french": ["quantity"]})
        detect.assert_not_called()
        client.assert_not_called()
