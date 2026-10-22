import asyncio
from contextlib import nullcontext
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
from sqlalchemy.exc import OperationalError

import src.mcp_server.logical_indexing_server as server
from src.modules import query_embeddings


def _call_search(**kwargs):
    response = asyncio.run(server.search.fn.__wrapped__(**kwargs))
    if "error" in response:
        return response
    # Existing loop assertions inspect discovery order across document groups.
    return sorted((section for document in response["documents"]
                   for section in document["sections"]), key=lambda section: section["rank"])


class SearchDependencyTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", False)
        patcher.start()
        self.addCleanup(patcher.stop)

        scope_patch = patch.object(server, "_require_search_scope", lambda **_: None)
        session_patch = patch.object(
            server,
            "get_db_session_sync",
            lambda: nullcontext(object()),
        )
        for name, mock in (("search_section_evidence", Mock(return_value=[])),
                           ("_prepare_filename_semantic_scores", AsyncMock(return_value={}))):
            dependency_patch = patch.object(server, name, mock)
            dependency_patch.start()
            self.addCleanup(dependency_patch.stop)
        scope_patch.start()
        session_patch.start()
        self.addCleanup(scope_patch.stop)
        self.addCleanup(session_patch.stop)


    def test_grouped_sections_include_exact_block_evidence(self):
        match = {
            "section_id": 101,
            "section_title": "Revenue",
            "preview_section": "Revenue rose",
            "score": 0.8,
            "retrieval_scores": {"block_keyword_match": True},
            "matched_block": {
                "block_id": 77,
                "content": "Revenue rose by 10%.",
                "retrieval_scores": {"vector": 0.9, "bm25": 0.6},
            },
            "block_ids": [77, 78],
            "search_details": {"unused": True},
            "required_followup_args": {"unused": True},
        }
        with patch.object(
            server, "_prepare_hybrid_search", AsyncMock(return_value=([0.1], {})),
        ), patch.object(server, "unified_search", Mock(return_value=[
            match, {**match, "section_id": 102, "section_title": "Expenses"},
        ])):
            result = _call_search(query="revenue", workspace_id="workspace", top_k=2)

        self.assertEqual(result[0]["section_id"], 101)
        self.assertEqual(result[0]["title"], "Revenue")
        self.assertEqual(result[0]["blocks"][0]["content"], "Revenue rose by 10%.")
        self.assertEqual(result[1]["section_id"], 102)
        for item in result:
            self.assertNotIn("search_query", item)
            self.assertNotIn("search_iteration", item)
            self.assertNotIn("block_ids", item)
            self.assertNotIn("search_details", item)
            self.assertNotIn("required_followup_args", item)


    def test_embedding_unavailable_runs_lexical_only_search(self):
        with patch.object(
            server,
            "_prepare_hybrid_search",
            AsyncMock(return_value=(None, {"english": ["query"]})),
        ), patch.object(
            server,
            "unified_search",
            Mock(return_value=[{"section_id": 101}]),
        ) as search_once:
            result = _call_search(query="query", workspace_id="workspace")

        self.assertEqual([item["section_id"] for item in result], [101])
        self.assertIsNone(search_once.call_args.args[2])
        self.assertTrue(search_once.call_args.kwargs["include_lexical"])


    def test_first_database_failure_is_not_reported_as_empty_results(self):
        database_error = OperationalError("SELECT documents", {}, Exception("offline"))
        with patch.object(
            server,
            "_prepare_hybrid_search",
            AsyncMock(side_effect=database_error),
        ):
            with self.assertRaises(OperationalError):
                _call_search(query="query", workspace_id="workspace")


    def test_paradedb_failure_retries_vector_only_in_fresh_session(self):
        database_error = OperationalError(
            "SELECT paradedb.score(logical_sections.id)",
            {},
            Exception("lexical dependency unavailable"),
        )
        sessions = []

        async def run_db(operation):
            session = object()
            sessions.append(session)
            if len(sessions) == 1:
                raise database_error
            return operation(session)

        with patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", False), patch.object(server, "_run_db", side_effect=run_db), patch.object(
            server,
            "unified_search",
            Mock(return_value=[{"section_id": 101}]),
        ) as unified:
            result = asyncio.run(server._run_unified_search(
                "query",
                [0.1],
                workspace_id="workspace",
                file_name=None,
                fts_query_variants={"english": ["query"]},
            ))

        self.assertEqual(result, [{"section_id": 101}])
        self.assertEqual(len(sessions), 2)
        self.assertFalse(unified.call_args.kwargs["include_lexical"])


    def test_paradedb_failure_without_embedding_propagates(self):
        database_error = OperationalError(
            "SELECT paradedb.score(logical_sections.id)",
            {},
            Exception("lexical dependency unavailable"),
        )
        with patch.object(server, "_run_db", AsyncMock(side_effect=database_error)):
            with self.assertRaises(OperationalError):
                asyncio.run(server._run_unified_search(
                    "query",
                    None,
                    workspace_id="workspace",
                    file_name=None,
                    fts_query_variants={"english": ["query"]},
                ))


    def test_embedding_connection_failure_keeps_lexical_preparation(self):
        embeddings = Mock()
        embeddings.embed_query.side_effect = server.APIConnectionError(
            request=httpx.Request("POST", "https://embeddings.invalid"),
        )
        configured = Mock(LITELLM_BASE_URL="https://litellm.invalid", LITELLM_API_KEY="key",
                          SEARCH_RETRIEVAL_RESERVE_SECONDS=0.1)
        with patch.object(server, "settings", configured), patch.object(
            server,
            "_run_db",
            AsyncMock(return_value=["english"]),
        ), patch.object(
            query_embeddings,
            "get_embeddings",
            return_value=embeddings,
        ), patch.object(
            server,
            "build_fts_query_variants",
            AsyncMock(return_value={"english": ["query"]}),
        ):
            preparation = asyncio.run(server._prepare_hybrid_search(
                "query",
                "workspace",
                None,
                "test",
                deadline=server.time.monotonic() + 1,
                allow_lexical_only=True,
            ))

        self.assertIsNone(preparation.query_embedding)
        self.assertEqual(preparation.fts_query_variants, {"english": ["query"]})


    def test_embedding_programming_error_propagates(self):
        embeddings = Mock()
        embeddings.embed_query.side_effect = RuntimeError("bad embedding adapter")
        configured = Mock(LITELLM_BASE_URL="https://litellm.invalid", LITELLM_API_KEY="key",
                          SEARCH_RETRIEVAL_RESERVE_SECONDS=0.1)
        with patch.object(server, "settings", configured), patch.object(
            server,
            "_run_db",
            AsyncMock(return_value=["english"]),
        ), patch.object(
            query_embeddings,
            "get_embeddings",
            return_value=embeddings,
        ), patch.object(
            server,
            "build_fts_query_variants",
            AsyncMock(return_value={"english": ["query"]}),
        ):
            with self.assertRaisesRegex(RuntimeError, "bad embedding adapter"):
                asyncio.run(server._prepare_hybrid_search(
                    "query",
                    "workspace",
                    None,
                    "test",
                    deadline=server.time.monotonic() + 1,
                ))


