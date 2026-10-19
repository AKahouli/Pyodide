import asyncio
import json
import re
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.routing import Route
from starlette.testclient import TestClient

from src.mcp_server import router
from src.mcp_server.logical_indexing_server import mcp
from src.modules import document_resume


def _authorization_headers(api_key: str, workspace_ids=("workspace", "workspace-a", "workspace-b")) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    if workspace_ids:
        headers["Workspace-Id"] = ",".join(workspace_ids)
    return headers


class DocumentRoutingProfileEndpointTests(unittest.TestCase):
    def setUp(self):
        app = Starlette(
            routes=[
                Route(
                    "/routing-profile",
                    endpoint=router.starlette_routing_profile,
                    methods=["POST"],
                )
            ],
            middleware=[
                Middleware(
                    router.APIKeyAuthMiddleware,
                    api_key="test-api-key",
                ),
            ],
        )
        self.client = TestClient(app)
        self.headers = _authorization_headers("test-api-key")

    def test_returns_generated_routing_profile(self):
        expected = {
            "document_id": "507f1f77bcf86cd799439011",
            "description": "A detailed search-oriented report description.",
            "document_type": "technical_documentation",
            "main_topics": ["distributed systems"],
            "secondary_topics": ["deployment"],
            "entities": ["PostgreSQL"],
            "topic_summaries": [],
            "generated_at": "2026-07-20T12:00:00Z",
        }
        with patch.object(
            router,
            "generate_document_routing_profile",
            new=AsyncMock(return_value=expected),
        ) as generate:
            response = self.client.post(
                "/routing-profile",
                headers=self.headers,
                json={"workspace_id": "workspace", "file_name": "report.pdf"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        generate.assert_awaited_once_with(
            file_name="report.pdf",
            workspace_id="workspace",
        )

    def test_rejects_file_or_workspace_lists(self):
        payloads = (
            {"workspace_id": ["workspace"], "file_name": "report.pdf"},
            {"workspace_id": "workspace", "file_name": ["report.pdf"]},
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/routing-profile",
                    headers=self.headers,
                    json=payload,
                )
                self.assertEqual(response.status_code, 422)
                self.assertIn("lists are not accepted", response.json()["detail"])

    def test_rejects_body_workspace_without_workspace_header(self):
        expected = {
            "document_id": "507f1f77bcf86cd799439011",
            "description": "Detailed description",
            "document_type": "report",
            "main_topics": ["topic"],
            "secondary_topics": [],
            "entities": [],
            "topic_summaries": [],
            "generated_at": "2026-07-20T12:00:00Z",
        }
        with patch.object(
            router,
            "generate_document_routing_profile",
            new=AsyncMock(return_value=expected),
        ) as generate:
            response = self.client.post(
                "/routing-profile",
                headers=_authorization_headers("test-api-key", []),
                json={"workspace_id": "body-workspace", "file_name": "report.pdf"},
            )

        self.assertEqual(response.status_code, 403)
        generate.assert_not_awaited()

    def test_requires_bearer_token(self):
        response = self.client.post(
            "/routing-profile",
            json={"workspace_id": "workspace", "file_name": "report.pdf"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"error": "unauthorized"})

    def test_returns_not_found_for_unknown_document(self):
        with patch.object(
            router,
            "generate_document_routing_profile",
            new=AsyncMock(side_effect=document_resume.DocumentNotFoundError("Document not found")),
        ):
            response = self.client.post(
                "/routing-profile",
                headers=self.headers,
                json={"workspace_id": "workspace", "file_name": "missing.pdf"},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "document_not_found")

    def test_old_resume_path_is_not_registered(self):
        response = self.client.post(
            "/resume",
            headers=self.headers,
            json={"workspace_id": "workspace", "file_name": "report.pdf"},
        )
        self.assertEqual(response.status_code, 404)

    def test_is_not_exposed_as_an_mcp_tool(self):
        tools = asyncio.run(mcp.get_tools())
        self.assertNotIn("generate_document_routing_profile", tools)
        self.assertNotIn("starlette_routing_profile", tools)


class DocumentSummaryEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(router.create_mcp_starlette_app())
        self.headers = _authorization_headers(router.get_settings().MCP_API_KEY)

    def test_returns_stored_outline_outside_mcp(self):
        outline = {"table_of_contents": "Introduction\nResults"}

        async def run(operation):
            return operation(object())

        with (
            patch.object(router, "run_sync_db", side_effect=run),
            patch.object(
                router,
                "get_document_summary_outline",
                return_value=outline,
            ) as get_outline,
        ):
            response = self.client.post(
                "/summarize",
                headers=self.headers,
                json={"workspace_id": "workspace", "file_name": "report.pdf"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), outline)
        get_outline.assert_called_once_with(
            unittest.mock.ANY,
            "report.pdf",
            workspace_id="workspace",
        )
        tools = asyncio.run(mcp.get_tools())
        self.assertNotIn("summarize", tools)

    def test_preserves_batched_workspace_and_file_results(self):
        async def run(operation):
            return operation(object())

        def get_outline(session, file_name, workspace_id):
            if file_name == "missing.pdf":
                return None
            return {"table_of_contents": f"{workspace_id}:{file_name}"}

        with (
            patch.object(router, "run_sync_db", side_effect=run),
            patch.object(router, "get_document_summary_outline", side_effect=get_outline),
        ):
            response = self.client.post(
                "/summarize",
                headers=_authorization_headers(router.get_settings().MCP_API_KEY),
                json={
                    "workspace_id": ["workspace-a", "workspace-b"],
                    "file_name": ["report.pdf", "missing.pdf"],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 4)
        self.assertEqual(response.json()[-1], {
            "error": "Document not found",
            "workspace_id": "workspace-b",
            "file_name": "missing.pdf",
        })


class SwaggerDocumentationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(router.create_mcp_starlette_app())

    def test_swagger_and_openapi_schema_require_authentication(self):
        self.assertEqual(self.client.get("/docs").status_code, 401)
        self.assertEqual(self.client.get("/openapi.json").status_code, 401)
        headers = _authorization_headers(router.settings.MCP_API_KEY)
        docs_response = self.client.get("/docs", headers=headers)
        schema_response = self.client.get("/openapi.json", headers=headers)

        self.assertEqual(docs_response.status_code, 200)
        self.assertIn("swagger-ui", docs_response.text.lower())
        self.assertEqual(schema_response.status_code, 200)

        schema = schema_response.json()
        self.assertEqual(
            set(schema["paths"]),
            {
                "/", "/tools", "/resources", "/routing-profile",
                "/summarize",
                "/search_documents", "/search_native", "/search_native/batch",
            },
        )
        self.assertEqual(
            schema["security"],
            [{"BearerAuth": []}],
        )
        self.assertEqual(
            schema["components"]["securitySchemes"]["BearerAuth"]["scheme"],
            "bearer",
        )

    def test_documented_endpoints_remain_protected(self):
        response = self.client.get("/tools")

        self.assertEqual(response.status_code, 401)

    def test_search_documents_groups_results_with_hardcoded_search_limit(self):
        document_id = "507f1f77bcf86cd799439011"
        expected_documents = [{
            "document_id": document_id,
            "file_name": "manual.pdf",
            "workspace_id": "workspace",
            "source": "manual.pdf",
            "total_pages": 20,
            "overview": "Product manual",
            "score": 0.03,
            "metadata_match": None,
            "matches": [],
        }]
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(
            router,
            "search_documents_grouped",
            new=AsyncMock(return_value=expected_documents),
        ) as search:
            response = self.client.post(
                "/search_documents",
                headers=_authorization_headers(api_key),
                json={"query": "installation", "file_names": ["manual.pdf"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "query": "installation",
            "behavior": "best_matches",
            "documents": [{
                "document_id": document_id,
                "file_name": "manual.pdf",
                "workspace_id": "workspace",
                "score": 0.03,
                "rank": 1,
            }],
            "total": 1,
            "debug": None,
        })
        search.assert_awaited_once_with(
            query="installation",
            file_names=["manual.pdf"],
            debug=False,
        )

    def test_search_documents_debug_returns_match_details(self):
        document_id = "507f1f77bcf86cd799439011"
        expected = [{
            "document_id": document_id,
            "file_name": "manual.pdf",
            "workspace_id": "workspace",
            "score": 0.81,
            "matches": [{"content": {"blocks": []}}],
        }]
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(
            router, "search_documents_grouped", new=AsyncMock(return_value=expected),
        ) as search:
            response = self.client.post(
                "/search_documents",
                headers=_authorization_headers(api_key),
                json={
                    "query": "installation", "file_names": ["manual.pdf"],
                    "debug": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "query": "installation",
            "behavior": "best_matches",
            "documents": [{
                "document_id": document_id,
                "file_name": "manual.pdf",
                "workspace_id": "workspace",
                "score": 0.81,
                "rank": 1,
            }],
            "total": 1,
            "debug": expected,
        })
        search.assert_awaited_once_with(
            query="installation", file_names=["manual.pdf"],
            debug=True,
        )

    def test_search_documents_coverage_returns_status_partitions(self):
        hit_id = "507f1f77bcf86cd799439011"
        no_hit_id = "507f191e810c19729de860ea"
        pending_id = "507f191e810c19729de860eb"
        result = {
            "documents": [{
                "document_id": hit_id, "file_name": "manual.pdf",
                "workspace_id": "workspace", "score": 0.81,
            }],
            "evaluated_documents": [
                {"document_id": hit_id, "file_name": "manual.pdf", "workspace_id": "workspace"},
                {"document_id": no_hit_id, "file_name": "appendix.pdf", "workspace_id": "workspace"},
            ],
            "no_hit_documents": [
                {"document_id": no_hit_id, "file_name": "appendix.pdf", "workspace_id": "workspace"},
            ],
            "not_evaluated_documents": [
                {"document_id": pending_id, "file_name": "archive.pdf", "workspace_id": "workspace"},
            ],
        }
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(
            router, "search_documents_grouped", new=AsyncMock(return_value=result),
        ) as search:
            response = self.client.post(
                "/search_documents",
                headers=_authorization_headers(api_key),
                json={
                    "query": "installation",
                    "file_names": ["manual.pdf", "appendix.pdf", "archive.pdf"],
                    "behavior": "coverage",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["behavior"], "coverage")
        self.assertEqual(payload["documents"][0]["document_id"], hit_id)
        self.assertEqual(payload["no_hit_documents"][0]["document_id"], no_hit_id)
        self.assertEqual(payload["not_evaluated_documents"][0]["document_id"], pending_id)
        search.assert_awaited_once_with(
            query="installation",
            file_names=["manual.pdf", "appendix.pdf", "archive.pdf"],
            debug=False,
            behavior="coverage",
        )

    def test_search_documents_requires_workspace_header(self):
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(
            router,
            "search_documents_grouped",
            new=AsyncMock(return_value=[]),
        ):
            response = self.client.post(
                "/search_documents",
                headers=_authorization_headers(api_key, []),
                json={"query": "installation", "file_names": ["manual.pdf"]},
            )

        self.assertEqual(response.status_code, 403)

    def test_search_documents_request_schema_has_no_limit(self):
        api_key = router.get_settings().MCP_API_KEY
        response = self.client.get(
            "/openapi.json",
            headers=_authorization_headers(api_key),
        )

        self.assertEqual(response.status_code, 200)
        request_schema = response.json()["components"]["schemas"]["SearchDocumentsRequest"]
        self.assertNotIn("limit", request_schema["properties"])
        self.assertNotIn("user_id", request_schema["properties"])
        self.assertEqual(
            request_schema["properties"]["query"]["maxLength"],
            router.settings.REQUEST_QUERY_MAX_CHARS,
        )
        self.assertEqual(
            request_schema["properties"]["file_names"]["maxItems"],
            router.settings.REQUEST_COLLECTION_MAX_ITEMS,
        )

    def test_search_documents_requires_file_names(self):
        api_key = router.get_settings().MCP_API_KEY
        response = self.client.post(
            "/search_documents",
            headers=_authorization_headers(api_key),
            json={"query": "installation"},
        )

        self.assertEqual(response.status_code, 422)

    def test_search_native_is_http_only_and_preserves_search_arguments(self):
        expected = [{
            "section_id": 12,
            "section_title": "Installation",
            "content": "Install the package.",
            "page_range": "2",
            "score": 0.8,
            "file_name": "manual.pdf",
            "workspace_id": "workspace",
        }]
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(
            router, "search_native", new=AsyncMock(return_value=expected),
        ) as search:
            response = self.client.post(
                "/search_native",
                headers=_authorization_headers(api_key),
                json={
                    "query": "installation",
                    "workspace_id": "workspace",
                    "file_name": ["manual.pdf"],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        search.assert_awaited_once_with(
            query="installation",
            workspace_id="workspace",
            file_name=["manual.pdf"],
        )
        tools = asyncio.run(mcp.get_tools())
        self.assertNotIn("search_native", tools)

    def test_search_native_rejects_body_workspace_without_workspace_header(self):
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(router, "search_native", new=AsyncMock(return_value=[])) as search:
            response = self.client.post(
                "/search_native",
                headers=_authorization_headers(api_key, []),
                json={"query": "installation", "workspace_id": "workspace"},
            )

        self.assertEqual(response.status_code, 403)
        search.assert_not_awaited()

    def test_search_native_rejects_body_workspace_outside_header(self):
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(router, "search_native", new=AsyncMock(return_value=[])):
            response = self.client.post(
                "/search_native",
                headers=_authorization_headers(api_key, ("workspace",)),
                json={"query": "installation", "workspace_id": "other-workspace"},
            )

        self.assertEqual(response.status_code, 403)

    def test_rejects_missing_workspace_header(self):
        api_key = router.get_settings().MCP_API_KEY
        with patch.object(router, "search_native", new=AsyncMock(return_value=[])):
            response = self.client.post(
                "/search_native",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"query": "installation", "workspace_id": "workspace"},
            )

        self.assertEqual(response.status_code, 403)

    def test_search_native_batch_returns_one_correlated_entry_per_request(self):
        api_key = router.get_settings().MCP_API_KEY

        async def search_side_effect(**kwargs):
            if kwargs["query"] == "fails":
                raise RuntimeError("database unavailable")
            return [{
                "content": "Contract type: fixed term",
                "file_name": kwargs["file_name"],
                "page_range": "1",
                "workspace_id": kwargs["workspace_id"],
                "section_id": 123,
                "score": 0.9,
                "section_title": "Contract",
            }]

        with patch.object(router, "search_native", side_effect=search_side_effect):
            response = self.client.post(
                "/search_native/batch",
                headers=_authorization_headers(api_key),
                json={"requests": [
                    {
                        "id": "0", "query": "CONTRAT: type",
                        "workspace_id": "workspace", "file_name": "document.pdf",
                    },
                    {
                        "id": "1", "query": "fails",
                        "workspace_id": "workspace", "file_name": "document.pdf",
                    },
                ]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"results": [
            {"id": "0", "result": [{
                "content": "Contract type: fixed term",
                "file_name": "document.pdf",
                "page_range": "1",
                "workspace_id": "workspace",
                "section_id": 123,
            }]},
            {"id": "1", "error": {"message": "Search failed"}},
        ]})

    def test_search_native_batch_rejects_duplicate_ids_and_invalid_size(self):
        api_key = router.get_settings().MCP_API_KEY
        headers = _authorization_headers(api_key)
        item = {
            "id": "same", "query": "contract",
            "workspace_id": "workspace", "file_name": "document.pdf",
        }

        duplicate_response = self.client.post(
            "/search_native/batch", headers=headers,
            json={"requests": [item, item]},
        )
        empty_response = self.client.post(
            "/search_native/batch", headers=headers, json={"requests": []},
        )
        oversized_response = self.client.post(
            "/search_native/batch", headers=headers,
            json={"requests": [dict(item, id=str(index)) for index in range(11)]},
        )

        self.assertEqual(duplicate_response.status_code, 422)
        self.assertEqual(empty_response.status_code, 422)
        self.assertEqual(oversized_response.status_code, 422)

    def test_search_native_batch_requires_bearer_token(self):
        response = self.client.post(
            "/search_native/batch",
            json={"requests": [{
                "id": "0", "query": "contract",
                "workspace_id": "workspace", "file_name": "document.pdf",
            }]},
        )

        self.assertEqual(response.status_code, 401)


class SearchDocumentsGroupingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        scope = patch("src.mcp_server.logical_indexing_server._get_effective_workspace_ids",
                      return_value=["w", "a", "b", "workspace"])
        scope.start()
        self.addCleanup(scope.stop)

    async def test_keeps_distinct_document_ids_and_filters_relative_to_best(self):
        block_matches = [
            {
                "document_id": 7, "file_name": "recipes.pdf", "workspace_id": "w",
                "source": "recipes.pdf", "block_id": 101, "block_type": "text",
                "score": 0.03, "retrieval_scores": {"vector": 0.7, "bm25": 0.5},
                "content": "Recette de couscous", "page_number": 2,
            },
            {
                "document_id": 8, "file_name": "recipes.pdf", "workspace_id": "w",
                "source": "recipes.pdf", "block_id": 102, "block_type": "text",
                "score": 0.02, "retrieval_scores": {"vector": 0.6, "bm25": 0.4},
                "content": "Semoule et legumes", "page_number": 3,
            },
            {
                "document_id": 9, "file_name": "CV.docx", "workspace_id": "w",
                "source": "CV.docx", "block_id": 103, "block_type": "text",
                "score": 0.01, "retrieval_scores": {"vector": 0.5, "bm25": None},
                "content": "Experience professionnelle", "page_number": 1,
            },
        ]
        session_context = MagicMock()
        session_context.__enter__.return_value = MagicMock()
        session_context.__exit__.return_value = False
        with (
            patch("src.mcp_server.logical_indexing_server._prepare_hybrid_search", new=AsyncMock(
                return_value=([0.1], {"french": ["couscous", "recette"]}),
            )) as prepare_search,
            patch("src.mcp_server.logical_indexing_server.get_db_session_sync", return_value=session_context),
            patch(
                "src.mcp_server.logical_indexing_server.search_blocks_hybrid",
                return_value=block_matches,
            ) as content_search,
        ):
            result = await router.search_documents_grouped(
                query="couscous recette",
                file_names=["recipes.pdf", "CV.docx"],
            )

        self.assertEqual([item["document_id"] for item in result], [7, 8])
        self.assertEqual([item["file_name"] for item in result], ["recipes.pdf", "recipes.pdf"])
        self.assertEqual(len(result[0]["matches"]), 1)
        self.assertEqual(result[0]["relative_score"], 1.0)
        self.assertTrue(result[0]["semantic_match"])
        self.assertTrue(result[0]["keyword_match"])
        prepare_search.assert_awaited_once()
        self.assertEqual(prepare_search.await_args.args, (
            "couscous recette", ["w", "a", "b", "workspace"], ["recipes.pdf", "CV.docx"],
            "http_search_documents",
        ))
        self.assertGreater(prepare_search.await_args.kwargs["deadline"], 0)
        self.assertNotIn("user_id", content_search.call_args.kwargs)
        self.assertEqual(content_search.call_args.kwargs["workspace_id"], ["w", "a", "b", "workspace"])
        self.assertEqual(content_search.call_args.kwargs["file_name"], ["recipes.pdf", "CV.docx"])
        self.assertEqual(content_search.call_args.kwargs["limit"], 100)
        self.assertEqual(content_search.call_args.kwargs["per_document_limit"], 3)
        self.assertFalse(content_search.call_args.kwargs["include_section_context"])
        self.assertTrue(content_search.call_args.kwargs["include_document_id"])

    async def test_coverage_reports_hits_no_hits_and_unevaluated_documents(self):
        hit_id = "507f1f77bcf86cd799439011"
        no_hit_id = "507f191e810c19729de860ea"
        pending_id = "507f191e810c19729de860eb"
        scoped_documents = [
            {"document_id": hit_id, "file_name": "one.pdf", "workspace_id": "w"},
            {"document_id": no_hit_id, "file_name": "two.pdf", "workspace_id": "w"},
            {"document_id": pending_id, "file_name": "three.pdf", "workspace_id": "w"},
        ]
        hit = {
            "document_id": hit_id, "file_name": "one.pdf", "workspace_id": "w",
            "source": "one.pdf", "block_id": 101, "block_type": "text",
            "score": 0.03, "retrieval_scores": {"vector": 0.8, "bm25": None},
            "content": "Relevant content", "page_number": 1,
        }

        def search_side_effect(*args, **kwargs):
            return [hit] if kwargs["document_id"] == hit_id else []

        with (
            patch(
                "src.mcp_server.logical_indexing_server.get_scoped_document_refs",
                return_value=scoped_documents,
            ),
            patch(
                "src.mcp_server.logical_indexing_server._prepare_hybrid_search",
                new=AsyncMock(return_value=([0.1], {"english": ["query"]})),
            ),
            patch(
                "src.mcp_server.logical_indexing_server.search_blocks_hybrid",
                side_effect=search_side_effect,
            ) as block_search,
            patch(
                "src.mcp_server.logical_indexing_server.settings.SEARCH_COVERAGE_DOCUMENT_LIMIT",
                2,
            ),
        ):
            result = await router.search_documents_grouped(
                query="query",
                file_names=["one.pdf", "two.pdf", "three.pdf"],
                behavior="coverage",
            )

        self.assertEqual([item["document_id"] for item in result["documents"]], [hit_id])
        self.assertEqual(
            [item["document_id"] for item in result["evaluated_documents"]],
            [hit_id, no_hit_id],
        )
        self.assertEqual(
            [item["document_id"] for item in result["no_hit_documents"]],
            [no_hit_id],
        )
        self.assertEqual(
            [item["document_id"] for item in result["not_evaluated_documents"]],
            [pending_id],
        )
        self.assertEqual(block_search.call_count, 2)

    async def test_keeps_a_confident_semantic_only_document(self):
        block_match = {
            "document_id": 7, "file_name": "recipes.pdf", "workspace_id": "w",
            "source": "recipes.pdf", "block_id": 101, "block_type": "text",
            "score": 0.03, "retrieval_scores": {"vector": 0.68, "bm25": None},
            "content": "Semolina dish with vegetables", "page_number": 2,
        }
        session_context = MagicMock()
        session_context.__enter__.return_value = MagicMock()
        session_context.__exit__.return_value = False
        with (
            patch("src.mcp_server.logical_indexing_server._prepare_hybrid_search", new=AsyncMock(
                return_value=([0.1], {"english": ["north african semolina dish"]}),
            )),
            patch("src.mcp_server.logical_indexing_server.get_db_session_sync", return_value=session_context),
            patch("src.mcp_server.logical_indexing_server.search_blocks_hybrid", return_value=[block_match]),
        ):
            result = await router.search_documents_grouped(
                query="north african semolina dish",
                file_names=["recipes.pdf"],
            )

        self.assertEqual([item["file_name"] for item in result], ["recipes.pdf"])
        self.assertTrue(result[0]["semantic_match"])
        self.assertFalse(result[0]["keyword_match"])

    async def test_does_not_merge_same_filename_across_workspaces(self):
        matches = [{
            "document_id": document_id,
            "file_name": "report.pdf",
            "workspace_id": workspace_id,
            "source": "report.pdf",
            "block_id": document_id * 10,
            "block_type": "text",
            "score": 0.03,
            "retrieval_scores": {"vector": 0.8, "bm25": 0.5},
            "content": "Relevant report content",
            "page_number": 1,
        } for document_id, workspace_id in ((7, "a"), (8, "b"))]

        with (
            patch(
                "src.mcp_server.logical_indexing_server._prepare_hybrid_search",
                new=AsyncMock(return_value=([0.1], {"english": ["report"]})),
            ),
            patch(
                "src.mcp_server.logical_indexing_server.search_blocks_hybrid",
                return_value=matches,
            ),
        ):
            result = await router.search_documents_grouped(
                query="report",
                file_names=["report.pdf"],
            )

        self.assertEqual(
            [(item["workspace_id"], item["document_id"]) for item in result],
            [("a", 7), ("b", 8)],
        )

    async def test_groups_block_matches_without_loading_sections_or_metadata(self):
        block_matches = [
            {
                "document_id": 7,
                "file_name": "manual.pdf",
                "workspace_id": "workspace",
                "source": "manual.pdf",
                "block_id": 101,
                "block_type": "text",
                "score": 0.031,
                "retrieval_scores": {"vector": 0.8, "bm25": 0.7},
                "content": "Install the package.",
                "page_number": 2,
            },
            {
                "document_id": 7,
                "file_name": "manual.pdf",
                "workspace_id": "workspace",
                "source": "manual.pdf",
                "block_id": 102,
                "block_type": "text",
                "score": 0.02,
                "retrieval_scores": {"vector": None, "bm25": 0.5},
                "content": "Configure the service.",
                "page_number": 4,
            },
        ]
        session_context = MagicMock()
        session_context.__enter__.return_value = MagicMock()
        session_context.__exit__.return_value = False

        with (
            patch(
                "src.mcp_server.logical_indexing_server._prepare_hybrid_search",
                new=AsyncMock(return_value=([0.1, 0.2], {"english": ["installation"]})),
            ),
            patch(
                "src.mcp_server.logical_indexing_server.get_db_session_sync",
                return_value=session_context,
            ),
            patch(
                "src.mcp_server.logical_indexing_server.search_blocks_hybrid",
                return_value=block_matches,
            ),
            patch("src.mcp_server.logical_indexing_server.read_section_with_blocks") as read_section,
        ):
            result = await router.search_documents_grouped(
                query="installation",
                file_names=["manual.pdf"],
            )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["file_name"], "manual.pdf")
        self.assertEqual(result[0]["score"], 0.9325)
        self.assertEqual(len(result[0]["matches"]), 2)
        self.assertNotIn("section_id", result[0]["matches"][0])
        self.assertNotIn("image_count", result[0]["matches"][0])
        read_section.assert_not_called()


class DocumentRoutingProfileGenerationTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _source(total_pages=50):
        return {
            "document_id": "507f1f77bcf86cd799439011",
            "file_name": "report.pdf",
            "workspace_id": "workspace",
            "total_pages": total_pages,
            "sections": [
                {
                    "title": "System architecture",
                    "content": "Services communicate through PostgreSQL-backed APIs.",
                },
                {
                    "title": "Monitoring",
                    "content": "Prometheus metrics and alerts monitor availability.",
                },
            ],
        }

    @staticmethod
    def _generated_response(**extra):
        response = {
            "description": "The document explains architecture and monitoring in detail.",
            "document_type": "technical_documentation",
            "main_topics": ["distributed systems", "monitoring"],
            "secondary_topics": ["deployment"],
            "entities": ["Prometheus"],
        }
        response.update(extra)
        return response

    @staticmethod
    def _section_digest_response():
        return {
            "section_summaries": [
                {
                    "section_index": 0,
                    "title": "Ignored model title",
                    "summary": "Explains PostgreSQL-backed service communication.",
                    "keywords": ["service architecture", "PostgreSQL"],
                    "entities": ["PostgreSQL"],
                },
                {
                    "section_index": 1,
                    "title": "Ignored model title",
                    "summary": "Explains Prometheus metrics and availability alerts.",
                    "keywords": ["monitoring", "alerts"],
                    "entities": ["Prometheus"],
                },
            ]
        }

    @staticmethod
    def _topic_digest_response():
        return {
            "topic_summaries": [{
                "title": "Architecture and operations",
                "summary": "Covers service communication and operational monitoring.",
                "keywords": ["architecture", "monitoring"],
                "entities": ["PostgreSQL", "Prometheus"],
            }]
        }

    @staticmethod
    def _settings():
        return SimpleNamespace(
            LITELLM_BASE_URL="https://litellm.example/v1",
            MODEL_ALLOWED_ORIGINS=["https://litellm.example"],
            MODEL_ALLOW_HTTP_LOOPBACK=False,
            ROUTING_PROFILE_MAX_SECTIONS=200,
            LITELLM_API_KEY="test-key",
            OPENAI_MAX_RETRIES=2,
            RESUME_MODEL="test-resume-model",
        )

    async def _generate(self, source, model_responses):
        completions = [
            SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content=json.dumps(model_response))
            )])
            for model_response in model_responses
        ]
        completion = AsyncMock(side_effect=completions)
        client = MagicMock()
        client.chat.completions.create = completion
        with (
            patch.object(document_resume, "_load_document_source", return_value=source),
            patch.object(document_resume, "get_settings", return_value=self._settings()),
            patch.object(document_resume, "AsyncOpenAI", return_value=client),
        ):
            result = await document_resume.generate_document_routing_profile(
                file_name="report.pdf",
                workspace_id="workspace",
            )
        return result, completion

    async def test_returns_grounded_profile_and_empty_topics_at_fifty_pages(self):
        result, completion = await self._generate(
            self._source(total_pages=50),
            [self._section_digest_response(), self._generated_response()],
        )

        self.assertEqual(result["document_id"], "507f1f77bcf86cd799439011")
        self.assertNotIn("workspace_id", result)
        self.assertNotIn("content_version", result)
        self.assertIn("architecture", result["description"])
        self.assertEqual(result["topic_summaries"], [])
        self.assertTrue(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", result["generated_at"]))

        section_call = completion.await_args_list[0].kwargs
        profile_call = completion.await_args_list[1].kwargs
        self.assertEqual(profile_call["model"], "test-resume-model")
        self.assertEqual(profile_call["response_format"], {"type": "json_object"})
        self.assertIn("PostgreSQL-backed APIs", section_call["messages"][1]["content"])
        self.assertIn("grounded source", profile_call["messages"][1]["content"])
        self.assertIn(
            "regardless of the source document's language",
            section_call["messages"][0]["content"],
        )
        self.assertIn(
            "regardless of the source document's language",
            profile_call["messages"][0]["content"],
        )
        self.assertIn("Do not return topic_summaries", profile_call["messages"][0]["content"])

    async def test_returns_hierarchical_topic_summaries_above_fifty_pages(self):
        topic_summaries = [{
            "topic_index": 7,
            "title": "System architecture",
            "summary": "Describes architecture and service relationships.",
        }]
        result, completion = await self._generate(
            self._source(total_pages=51),
            [
                self._section_digest_response(),
                self._topic_digest_response(),
                self._generated_response(topic_summaries=topic_summaries),
            ],
        )

        self.assertEqual(result["topic_summaries"][0]["topic_index"], 0)
        self.assertNotIn("section_ids", result["topic_summaries"][0])
        self.assertEqual(completion.await_count, 3)
        topic_call = completion.await_args_list[1].kwargs
        profile_call = completion.await_args_list[2].kwargs
        self.assertIn("at most five coherent topics", topic_call["messages"][0]["content"])
        self.assertIn(
            "regardless of the source document's language",
            topic_call["messages"][0]["content"],
        )
        self.assertIn("Include detailed topic_summaries", profile_call["messages"][0]["content"])

    async def test_rejects_topic_section_ids(self):
        topic_summaries = [{
            "topic_index": 0,
            "title": "Unknown",
            "summary": "Invalid section mapping.",
            "section_ids": ["section-999"],
        }]
        with self.assertRaisesRegex(ValueError, "section_ids"):
            await self._generate(
                self._source(total_pages=51),
                [
                    self._section_digest_response(),
                    self._topic_digest_response(),
                    self._generated_response(topic_summaries=topic_summaries),
                ],
            )

    async def test_rejects_missing_section_digest(self):
        incomplete = self._section_digest_response()
        incomplete["section_summaries"] = incomplete["section_summaries"][:1]
        with self.assertRaisesRegex(RuntimeError, "incomplete section summaries"):
            await self._generate(
                self._source(total_pages=50),
                [incomplete],
            )

    async def test_accepts_and_truncates_overlong_section_summaries(self):
        section_response = self._section_digest_response()
        section_response["section_summaries"][0]["summary"] = "A" * 2000

        result, completion = await self._generate(
            self._source(total_pages=50),
            [section_response, self._generated_response()],
        )

        self.assertIn("description", result)
        profile_prompt = completion.await_args_list[1].kwargs["messages"][1]["content"]
        profile_source = json.loads(profile_prompt.split("\n", 1)[1])
        summary = profile_source["summaries"][0]["summary"]
        self.assertLessEqual(len(summary), document_resume.SECTION_DIGEST_MAX_CHARS)
        self.assertTrue(summary.endswith("..."))


if __name__ == "__main__":
    unittest.main()
