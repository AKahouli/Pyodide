import asyncio
import math
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from sqlalchemy.dialects import postgresql

from src.mcp_server import logical_indexing_server as server
from src.modules import query_embeddings as vectors, query_translation, operations
from src.mcp_server import db_helpers as db


class QueryEmbeddingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        patcher = patch.multiple(server.settings, EMBEDDING_DIMENSION=2, EMBEDDING_MATRYOSHKA=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        operations.start_admission()

    async def asyncTearDown(self):
        await operations.drain()

    async def test_repeated_queries_generate_fresh_vectors(self):
        model = Mock(embed_query=Mock(side_effect=[[1., 2.], [3., 4.]]))
        with patch.object(vectors, "get_embeddings", return_value=model):
            first = await vectors.get_query_embedding("exact Query", "ws", "search", timeout=1)
            self.assertEqual(first, [1 / math.sqrt(5), 2 / math.sqrt(5)])
            first[0] = 99
            second = await vectors.get_query_embedding("exact Query", "ws", "search", timeout=1)
        self.assertEqual(second, [.6, .8])
        self.assertEqual(model.embed_query.call_count, 2)

    async def test_concurrent_identical_queries_are_independent(self):
        started, finish = asyncio.Event(), asyncio.Event()
        calls = 0

        async def embed(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                started.set()
            await finish.wait()
            return [1., 2.]

        with patch.object(vectors, "run_sync_model_request", side_effect=embed) as provider:
            cancelled = asyncio.create_task(vectors.get_query_embedding("q", "ws", "s", timeout=1))
            survivor = asyncio.create_task(vectors.get_query_embedding("q", "ws", "s", timeout=1))
            await started.wait()
            cancelled.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await cancelled
            finish.set()
            self.assertEqual(await survivor, [1., 2.])
            self.assertEqual(provider.await_count, 2)

    async def test_failure_retry_and_success_both_generate_new_vectors(self):
        model = Mock(embed_query=Mock(side_effect=[RuntimeError("offline"), [1., 0.], [0., 2.]]))
        with patch.object(vectors, "get_embeddings", return_value=model):
            with self.assertRaisesRegex(RuntimeError, "offline"):
                await vectors.get_query_embedding("q", "ws", "s", timeout=1)
            self.assertEqual(await vectors.get_query_embedding("q", "ws", "s", timeout=1), [1., 0.])
            self.assertEqual(await vectors.get_query_embedding("q", "ws", "s", timeout=1), [0., 1.])
        self.assertEqual(model.embed_query.call_count, 3)

    async def test_expired_caller_does_not_start_provider(self):
        with patch.object(vectors, "get_embeddings") as provider:
            with self.assertRaises(asyncio.TimeoutError):
                await vectors.get_query_embedding("q", "ws", "s", timeout=1,
                                                  deadline=time.monotonic() - 1)
            provider.assert_not_called()


class ParallelPreparationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Existing tests cover the rollback path; scalable scope has its own
        # SQL and live-regression coverage in test_scalable_search.py.
        patcher = patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", False)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_preparation_overlaps_and_reuses_only_request_metadata(self):
        docs = {"a": {"file_name": "a.pdf", "fts_config": "english", "workspace_id": "ws"}}
        started = set()
        ready = asyncio.Event()

        async def stage(name, value):
            started.add(name)
            if len(started) == 3:
                ready.set()
            await asyncio.wait_for(ready.wait(), 1)
            return value

        async def run(operation, **kwargs):
            return operation(Mock())

        context = server.SearchContext()
        with patch.object(server, "_run_db", side_effect=run) as database, patch.object(
                server, "get_search_document_metadata", return_value=docs) as metadata, patch.object(
                server, "get_query_embedding", side_effect=self._stage_call(stage, "embedding", [.1])), patch.object(
                server, "build_fts_query_variants", side_effect=self._stage_call(stage, "translation", {"english": ["q"]})), patch.object(
                server, "filename_semantic_scores", side_effect=self._stage_call(stage, "filename", {"a": 1.})), patch.object(
                server, "unified_search", return_value=[]) as retrieve, patch.multiple(
                server.settings, LITELLM_BASE_URL="http://model.invalid", LITELLM_API_KEY="test"):
            prepared = await server._prepare_hybrid_search("q", "ws", None, "s", search_context=context)
            await server._run_unified_search("q", prepared.query_embedding, workspace_id="ws", file_name=None,
                fts_query_variants=prepared.fts_query_variants, search_context=context)
        self.assertEqual(started, {"embedding", "translation", "filename"})
        metadata.assert_called_once()
        self.assertEqual(database.await_count, 2)  # one metadata load, one retrieval worker
        self.assertIs(retrieve.call_args.kwargs["scoped_documents"], docs)
        self.assertEqual(retrieve.call_args.kwargs["filename_semantic_scores"], {"a": 1.})
        self.assertIsNone(server.SearchContext().documents)

    @staticmethod
    def _stage_call(stage, name, value):
        async def call(*args, **kwargs):
            return await stage(name, value)
        return call

    async def test_empty_scope_starts_no_model_calls(self):
        async def run(operation, **kwargs):
            return operation(Mock())
        with patch.object(server, "_run_db", side_effect=run), patch.object(
                server, "get_search_document_metadata", return_value={}), patch.object(
                server, "get_query_embedding", AsyncMock()) as embedding, patch.object(
                server, "filename_semantic_scores", AsyncMock()) as filenames:
            result = await server._prepare_hybrid_search("q", "ws", None, "s", search_context=server.SearchContext())
        self.assertEqual(result, (None, None))
        embedding.assert_not_awaited()
        filenames.assert_not_awaited()

    async def test_preparation_cancellation_cleans_up_siblings(self):
        ready = asyncio.Event()
        started, stopped = set(), set()

        async def stall(name):
            started.add(name)
            if started == {"embedding", "translation"}:
                ready.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.add(name)

        async def embedding(*args, **kwargs):
            return await stall("embedding")

        async def translation(*args, **kwargs):
            return await stall("translation")

        with patch.object(server, "_run_db", AsyncMock(return_value=["english"])), patch.object(
                server, "get_query_embedding", side_effect=embedding), patch.object(
                server, "build_fts_query_variants", side_effect=translation), patch.multiple(
                server.settings, LITELLM_BASE_URL="http://model.invalid", LITELLM_API_KEY="test"):
            task = asyncio.create_task(server._prepare_hybrid_search("q", "ws", None, "s"))
            try:
                await asyncio.wait_for(ready.wait(), 1)
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(stopped, {"embedding", "translation"})

    async def test_translation_reuses_client_and_closes_at_shutdown(self):
        client = SimpleNamespace(close=AsyncMock())
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
            content='{"translations":{"french":"quantite"}}'))])
        with patch.object(query_translation, "model_http_client"), patch.object(query_translation, "AsyncOpenAI", return_value=client) as create, patch.object(
                query_translation, "detect_language", return_value="en"), patch.object(
                query_translation, "run_async_model_request", AsyncMock(return_value=response)), patch.multiple(
                query_translation.get_settings(), QUERY_TRANSLATION_ENABLED=True,
                LITELLM_BASE_URL="http://model.invalid", LITELLM_API_KEY="test"):
            try:
                await query_translation.build_fts_query_variants("quantity", ["french"])
                await query_translation.build_fts_query_variants("quantity", ["french"])
                self.assertEqual(create.call_count, 1)
                client.close.assert_not_awaited()
            finally:
                await query_translation.close_translation_client()
        client.close.assert_awaited_once()


class MetadataReuseTests(unittest.TestCase):
    def test_snapshot_preserves_all_scope_filters(self):
        session = Mock()
        session.execute.return_value.all.return_value = [("doc", "user", "a.pdf", "ws", "source", "english")]
        result = db.get_search_document_metadata(session, "user", "ws", "a.pdf", "doc")
        compiled = session.execute.call_args.args[0].compile(dialect=postgresql.dialect())
        for value in ("user", ["ws"], ["a.pdf"], ["doc"]):
            self.assertIn(value, compiled.params.values())
        self.assertEqual(result["doc"]["workspace_id"], "ws")

    def test_metadata_reuse_keeps_scores_evidence_and_candidate_sql(self):
        doc_rows = [("doc", "user", "a.pdf", "ws", "source", "english")]
        candidate_rows = [[], [(10, "doc", "s", .9)], [], [(10, "doc", "s", 1)]]
        results, statements = [], []
        for reuse in (False, True):
            session = Mock()
            session.execute.side_effect = [SimpleNamespace(all=lambda rows=rows: rows)
                                          for rows in ([] if reuse else [doc_rows]) + candidate_rows]
            docs = {"doc": {"user_id": "user", "file_name": "a.pdf", "workspace_id": "ws",
                            "source": "source", "fts_config": "english"}}
            with patch.object(db, "_bm25_section_candidates", return_value=({}, {})), patch.object(
                    db, "_bm25_block_candidates", return_value=({}, {})), patch.object(
                    db, "_resolve_section_metadata", return_value={("doc", "s"): (100, "Title")}), patch.object(
                    db, "_get_block_contents_by_internal_ids", return_value={10: "Exact source evidence"}), patch.object(
                    db, "_get_image_counts_by_section", return_value={}):
                results.append(db.unified_search(session, "q", [.1], workspace_id="ws", limit=5,
                    scoped_documents=docs if reuse else None))
            statements.append([str(call.args[0]) for call in session.execute.call_args_list])
        self.assertEqual(len(results[0]), 1)
        self.assertEqual(results[0], results[1])
        self.assertEqual(statements[0][1:], statements[1])
