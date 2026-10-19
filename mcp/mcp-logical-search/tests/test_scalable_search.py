import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch, AsyncMock

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from src.db.models import LogicalBlock, LogicalDocument
from src.mcp_server import db_helpers as db, logical_indexing_server as server
from src.mcp_server import router
from src.mcp_server.search_scope import SearchScope
from src.modules import operations


class ScalableScopeTests(unittest.TestCase):
    def test_scope_keeps_all_filters_in_sql_and_only_reads_two_identity_rows(self):
        session = Mock()
        session.execute.side_effect = [SimpleNamespace(scalar=lambda: False),
            SimpleNamespace(all=lambda: [("a",), ("b",)]),
            SimpleNamespace(all=lambda: [("english",), ("fr",)])]
        scope = SearchScope("revenue", user_id="user", workspace_id=["a", "b"],
                            file_name=["one.pdf", "two.pdf"], document_id="doc").prepare(session)
        self.assertEqual(scope.configs, ["english", "french"])
        self.assertEqual(scope.metadata, {})
        self.assertFalse(scope.single_document)
        identity = session.execute.call_args_list[1].args[0]
        self.assertEqual(identity._limit_clause.value, 2)
        for _, statement in scope.groups():
            compiled = statement.compile()
            for value in ("user", ["a", "b"], ["one.pdf", "two.pdf"], ["doc"]):
                self.assertIn(value, compiled.params.values())

    def test_candidate_query_uses_subquery_scope_and_direct_workspace_predicate(self):
        scope = SearchScope("revenue", workspace_id="workspace")
        scope.configs = ["english"]
        statement = db._apply_workspace_partition_filter(select(LogicalBlock.id).where(
            LogicalBlock.document_id.in_(db._search_document_ids(scope))), LogicalBlock, scope)
        compiled = statement.compile(dialect=postgresql.dialect())
        self.assertIn("IN (SELECT logical_documents.id", str(compiled))
        self.assertIn("logical_blocks.workspace_id IN", str(compiled))
        self.assertNotIn("file_name_embedding", str(compiled))
        self.assertEqual(scope.metadata, {})

    def test_filename_candidates_bound_both_positive_and_zero_branches(self):
        session = Mock()
        session.execute.return_value.all.return_value = [("a", "a.pdf")]
        scope = SearchScope("revenue", workspace_id="workspace")
        self.assertEqual(scope.filename_candidates(session, 100), {"a": {"file_name": "a.pdf"}})
        statement = session.execute.call_args.args[0]
        sql = str(statement.compile())
        self.assertEqual(sql.count("LIMIT"), 3)
        self.assertIn('COLLATE "C"', sql)
        self.assertIn("IS NOT NULL", sql)  # Non-issuer zero-overlap names must survive NULLs.

    def test_numeric_lookup_keeps_alias_collisions_without_casting_primary_key(self):
        predicate = db._block_identity_predicate(["101", "00101", "p1_b1", "999999999999999"])
        compiled = predicate.compile()
        self.assertNotIn("CAST", str(compiled))
        self.assertIn([101], compiled.params.values())
        self.assertIn(["101", "00101", "p1_b1", "999999999999999"], compiled.params.values())

    def test_deferred_document_resolution_never_fetches_workspace_id_list(self):
        session = Mock()
        statement = db._resolve_document_id(session, workspace_id="workspace", defer=True)
        session.execute.assert_not_called()
        self.assertIn(["workspace"], statement.compile().params.values())

    def test_bm25_scores_are_materialized_before_scope_join_and_candidate_limit(self):
        scope = SearchScope("revenue", workspace_id="workspace", file_name="allowed.pdf")
        scope.configs = ["english"]
        for helper in (db._bm25_section_candidates, db._bm25_block_candidates):
            session = Mock()
            session.execute.return_value.all.return_value = []
            helper(session, scope, "revenue", None, 30)
            statement = session.execute.call_args.args[0]
            compiled = statement.compile(dialect=postgresql.dialect())
            sql = str(compiled)
            self.assertIn("AS MATERIALIZED", sql)
            self.assertEqual(sql.count("LIMIT"), 1)
            self.assertIn("IN (SELECT logical_documents.id", sql)
            self.assertIn(["allowed.pdf"], compiled.params.values())
            self.assertNotIn("LIMIT", sql[:sql.index(")\n SELECT")])

    def test_workspace_only_search_avoids_document_join_and_language_mix_keeps_it(self):
        scope = SearchScope("revenue", workspace_id="workspace")
        scope.configs = ["english"]
        session = Mock()
        session.execute.return_value.all.return_value = []
        db._bm25_block_candidates(session, scope, "revenue", None, 30)
        sql = str(session.execute.call_args.args[0].compile())
        self.assertNotIn("logical_documents", sql)
        self.assertIn("logical_blocks.workspace_id IN", sql)
        self.assertNotIn("document_id IN", str(db._search_document_predicate(LogicalBlock, scope)))
        scope.configs.append("french")
        db._bm25_block_candidates(session, scope, "revenue", None, 30)
        self.assertIn("AS MATERIALIZED", str(session.execute.call_args.args[0].compile()))
        scope.has_issuers = True
        self.assertIn("document_id IN", str(db._search_document_predicate(LogicalBlock, scope)))


class ScalablePreparationTests(unittest.IsolatedAsyncioTestCase):
    async def test_retrieval_without_preparation_passes_scope_to_filename_stage(self):
        scope = SearchScope("query", workspace_id="workspace")
        scope.configs = ["english"]
        with patch.multiple(server.settings, SEARCH_SCALABLE_SCOPE_ENABLED=True,
            SEARCH_FILENAME_SEMANTIC_ENABLED=True), patch.object(SearchScope, "prepare", return_value=scope), patch.object(
            server, "_run_db", AsyncMock(side_effect=lambda operation, **kw: operation(Mock()))), patch.object(
            server, "_prepare_filename_semantic_scores", AsyncMock(return_value={})) as semantic, patch.object(
            server, "unified_search", return_value=[]) as retrieve:
            await server._run_unified_search("query", [.1], workspace_id="workspace", file_name=None,
                                            fts_query_variants={})
        self.assertIs(semantic.call_args.kwargs["documents"], scope)
        self.assertIs(retrieve.call_args.kwargs["scoped_documents"], scope)

    async def test_preparation_passes_sql_scope_without_loading_corpus_metadata(self):
        scope = SearchScope("query", workspace_id="workspace")
        scope.configs = ["english"]
        with patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", True), patch.object(
            SearchScope, "prepare", return_value=scope), patch.object(server, "_run_db",
            AsyncMock(side_effect=lambda operation, **kw: operation(Mock()))), patch.object(
            server, "get_search_document_metadata") as metadata, patch.object(
            server, "get_query_embedding", AsyncMock(return_value=[.1])), patch.object(
            server, "build_fts_query_variants", AsyncMock(return_value={"english": ["query"]})), patch.object(
            server, "_prepare_filename_semantic_scores", AsyncMock(return_value={})), patch.multiple(
            server.settings, LITELLM_BASE_URL="http://model.invalid", LITELLM_API_KEY="test"):
            context = server.SearchContext()
            await server._prepare_hybrid_search("query", "workspace", None, "search", search_context=context)
        self.assertIs(context.documents, scope)
        metadata.assert_not_called()


class CapacityTests(unittest.IsolatedAsyncioTestCase):
    async def test_http_search_overload_is_retryable_503(self):
        with patch.object(router, "_get_effective_workspace_ids", return_value=["workspace"]), patch.object(router, "search_native", AsyncMock(side_effect=operations.CapacityExceededError)):
            response = await router.starlette_search_native(router.SearchNativeRequest(
                query="revenue", workspace_id="workspace"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Retry-After"], "1")
        self.assertIn(b'"retryable":true', response.body)

    async def test_full_queue_rejects_then_cancellation_releases_waiting_slot(self):
        semaphore = asyncio.Semaphore(0)
        waiting = asyncio.create_task(operations.acquire_capacity(semaphore, queue_limit=1))
        await asyncio.sleep(0)
        with self.assertRaises(operations.CapacityExceededError):
            await operations.acquire_capacity(semaphore, queue_limit=1)
        waiting.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiting
        semaphore.release()
        await operations.acquire_capacity(semaphore, queue_limit=1)
        self.assertEqual(semaphore._admission_waiters, 0)

    async def test_timeout_releases_waiting_slot_without_adding_capacity(self):
        semaphore = asyncio.Semaphore(0)
        with self.assertRaises(asyncio.TimeoutError):
            await operations.acquire_capacity(semaphore, queue_limit=1, timeout=.01)
        self.assertEqual(semaphore._admission_waiters, 0)
        self.assertTrue(semaphore.locked())


if __name__ == "__main__":
    unittest.main()
