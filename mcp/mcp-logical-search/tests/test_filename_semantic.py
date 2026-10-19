import asyncio
import time
import unittest
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy.dialects import postgresql
from src.mcp_server import filename_semantic as semantic
from src.mcp_server import logical_indexing_server as server
from src.mcp_server.filename_relevance import filename_search_query, filename_relevance


class FilenameSemanticTests(unittest.TestCase):
    def test_feature_switches_parse_true_false_and_reject_invalid_values(self):
        from pydantic import ValidationError
        from src.config.settings import Settings

        for flag in ("QUERY_TRANSLATION_ENABLED", "SEARCH_FILENAME_SEMANTIC_ENABLED"):
            for value, expected in (("true", True), ("false", False)):
                parsed = Settings(_env_file=None, DATABASE_URL="postgresql://test", MCP_HOST="localhost",
                                  MCP_API_KEY="test", **{flag: value})
                self.assertIs(getattr(parsed, flag), expected)
            with self.assertRaises(ValidationError):
                Settings(_env_file=None, DATABASE_URL="postgresql://test", MCP_HOST="localhost",
                         MCP_API_KEY="test", **{flag: "not-a-boolean"})

    def test_disabled_skips_metadata_and_filename_embedding(self):
        with patch.object(server.settings, "SEARCH_FILENAME_SEMANTIC_ENABLED", False), patch.object(
                server, "_run_db", AsyncMock()) as database, patch.object(
                server, "filename_semantic_scores", AsyncMock()) as embed:
            result = asyncio.run(server._prepare_filename_semantic_scores(
                "3M 2018", "ws", None, None, time.monotonic() + 30))
        self.assertEqual(result, {})
        database.assert_not_awaited()
        embed.assert_not_awaited()

    def test_disabled_ignores_precomputed_filename_scores_but_keeps_content_search(self):
        context = server.SearchContext()
        context.filename_scores = {"a": 1.0}
        with patch.object(server.settings, "SEARCH_FILENAME_SEMANTIC_ENABLED", False), patch.object(
                server, "_prepare_filename_semantic_scores", AsyncMock()) as prepare, patch.object(
                server, "_run_db", AsyncMock(side_effect=lambda operation: operation(None))), patch.object(
                server, "unified_search", return_value=[]) as retrieve:
            asyncio.run(server._run_unified_search("query", [.1], workspace_id="ws", file_name=None,
                fts_query_variants={"english": ["query"]}, search_context=context))
        prepare.assert_not_awaited()
        self.assertEqual(retrieve.call_args.kwargs["filename_semantic_scores"], {})
        self.assertEqual(retrieve.call_args.args[2], [.1])
        self.assertEqual(retrieve.call_args.kwargs["workspace_id"], "ws")

    def setUp(self):
        embedding_settings = patch.multiple(semantic.get_settings(),
                                            EMBEDDING_DIMENSION=2, EMBEDDING_MATRYOSHKA=False)
        embedding_settings.start()
        self.addCleanup(embedding_settings.stop)
        patcher = patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_query_decomposition_normalizes_fiscal_year_and_multiword_issuer(self):
        docs = {"a": {"file_name": "3M_2018_10K.pdf"}, "b": {"file_name": "3M_2019_10K.pdf"}}
        self.assertEqual(filename_search_query("What is FY2018 capital expenditure for 3M?", docs), "2018 3m")
        scores, _ = filename_relevance("3M fiscal year 2018", docs)
        self.assertGreater(scores["a"], scores["b"])
        self.assertEqual(filename_search_query("Lockheed Martin FY 2018 revenue", {
            "a": {"file_name": "LOCKHEEDMARTIN_2018_10K.pdf"}}), "2018 lockheedmartin")

    def test_normalized_vectors_are_batched_fresh_on_every_call(self):
        docs = {"a": {"file_name": "3M_2018_10K.pdf"}, "b": {"file_name": "3M_2019_10K.pdf"}}
        vectors = {"3m 2018": [1., 0.], "3m 2018 10k": [1., 0.], "3m 2019 10k": [.5, .5]}
        model = Mock()
        model.embed_documents.side_effect = lambda values: [vectors[value] for value in values]
        with patch.object(semantic, "get_embeddings", return_value=model):
            first = semantic._scores("3M FY2018 revenue", docs, 2)
            second = semantic._scores("3M FY2018 revenue", docs, 2)
            self.assertEqual(first, second)
            self.assertEqual(model.embed_documents.call_count, 2)
            model.embed_documents.assert_called_with(["3m 2018", "3m 2018 10k", "3m 2019 10k"])
            self.assertGreater(first["a"], first["b"])

    def test_zero_and_malformed_vectors_do_not_supply_false_relevance(self):
        docs = {"a": {"file_name": "3M_2018_10K.pdf"}}
        with patch.object(semantic, "get_embeddings", return_value=Mock(
                embed_documents=Mock(return_value=[[0., 0.], [0., 0.]]))):
            with self.assertRaisesRegex(ValueError, "zero or non-finite norm"):
                semantic._scores("3M 2018", docs, 2)
        with patch.object(semantic, "get_embeddings", return_value=Mock(
                embed_documents=Mock(return_value=[[1.], [1.]]))):
            with self.assertRaises(ValueError):
                semantic._scores("3M 2018", docs, 2)

    def test_scope_and_issuer_selection_precede_embedding(self):
        session = Mock()
        session.execute.return_value.all.return_value = [
            ("a", "3M_2018_10K.pdf"), ("b", "COSTCO_2018_10K.pdf")]
        async def run(operation, **kwargs):
            return operation(session)
        with patch.object(server, "_run_db", side_effect=run), patch.object(
                server, "filename_semantic_scores", AsyncMock(return_value={"a": 1.})) as embed:
            result = asyncio.run(server._prepare_filename_semantic_scores(
                "3M FY2018", ["authorized"], ["3M_2018_10K.pdf"], ["a"], time.monotonic() + 30))
        self.assertEqual(result, {"a": 1.})
        self.assertEqual(embed.await_args.args[1], {"a": {"file_name": "3M_2018_10K.pdf"}})
        compiled = session.execute.call_args.args[0].compile(dialect=postgresql.dialect())
        for expected in (["authorized"], ["3M_2018_10K.pdf"], ["a"]):
            self.assertIn(expected, compiled.params.values())

    def test_embedding_timeout_preserves_other_signals_and_cancellation_propagates(self):
        for error, cancelled in ((asyncio.TimeoutError(), False), (asyncio.CancelledError(), True)):
            with self.subTest(cancelled=cancelled), patch.object(server, "_run_db", AsyncMock(return_value={
                    "a": {"file_name": "3M_2018_10K.pdf"}})), patch.object(
                    server, "filename_semantic_scores", AsyncMock(side_effect=error)):
                operation = server._prepare_filename_semantic_scores("3M", "ws", None, None, time.monotonic() + 30)
                if cancelled:
                    with self.assertRaises(asyncio.CancelledError):
                        asyncio.run(operation)
                else:
                    self.assertEqual(asyncio.run(operation), {})

    def test_retrieval_reserve_skips_optional_embedding(self):
        with patch.object(server, "_run_db", AsyncMock()) as database, patch.object(
                server, "filename_semantic_scores", AsyncMock()) as embed:
            result = asyncio.run(server._prepare_filename_semantic_scores(
                "3M", "ws", None, None, time.monotonic() + 1))
        self.assertEqual(result, {})
        database.assert_not_awaited()
        embed.assert_not_awaited()
