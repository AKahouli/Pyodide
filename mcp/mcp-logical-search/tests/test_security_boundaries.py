import asyncio
import base64
import io
import json
import ssl
import os
from pathlib import Path
import tempfile
import logging
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
from PIL import Image
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from src.config.settings import Settings
from src.db import session as database
from src.logger import file_request_logging as logs
from src.mcp_server import db_helpers as db, logical_indexing_server as server, router
from src.mcp_server.http_security import APIKeyAuthMiddleware, RequestBodyLimitMiddleware
from src.modules.model_security import model_http_client, validate_model_endpoint


class SecurityBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.settings = router.get_settings()
        policy = patch.multiple(self.settings, HEALTH_ALLOWED_NETWORKS=["127.0.0.0/8", "::1/128"],
                                HTTP_REQUESTS_PER_MINUTE=120, HTTP_MODEL_REQUESTS_PER_MINUTE=10)
        policy.start()
        self.addCleanup(policy.stop)
        self.client = TestClient(router.create_mcp_starlette_app())
        self.auth_headers = {"Authorization": "Bearer " + self.settings.MCP_API_KEY}
        self.headers = {**self.auth_headers, "Workspace-Id": "a"}

    def test_new_workspaces_are_accepted_from_header_without_configuration(self):
        import uuid
        with patch.object(router, "search_native", AsyncMock(return_value=[])) as search:
            for _ in range(2):
                workspace = uuid.uuid4().hex
                response = self.client.post("/search_native", headers={**self.headers, "Workspace-Id": workspace},
                                            json={"query": "q", "workspace_id": workspace})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(search.await_args.kwargs["workspace_id"], workspace)

    def test_body_cannot_override_fixed_header_and_batch_rejects_before_any_call(self):
        for endpoint, payload in (
            ("/search_native", {"query": "q", "workspace_id": "b"}),
            ("/summarize", {"workspace_id": ["a", "b"], "file_name": "x"}),
            ("/routing-profile", {"workspace_id": "b", "file_name": "x"}),
            ("/search_native/batch", {"requests": [
                {"id": "1", "query": "q", "workspace_id": "a", "file_name": "x"},
                {"id": "2", "query": "q", "workspace_id": "b", "file_name": "x"}]}),
        ):
            with self.subTest(endpoint=endpoint), patch.object(router, "search_native", AsyncMock()) as search, patch.object(
                    router, "generate_document_routing_profile", AsyncMock()) as generate, patch.object(router, "run_sync_db", AsyncMock()) as read:
                response = self.client.post(endpoint, headers={**self.headers, "Workspace-Id": "a"}, json=payload)
                self.assertEqual(response.status_code, 403)
                search.assert_not_awaited()
                generate.assert_not_awaited()
                read.assert_not_awaited()

    def test_valid_http_calls_preserve_arguments_and_payload(self):
        expected = [{"content": "evidence", "workspace_id": "a", "section_id": 42}]
        with patch.object(router, "search_native", AsyncMock(return_value=expected)) as search:
            response = self.client.post("/search_native", headers={**self.headers, "Workspace-Id": "a"},
                                        json={"query": "original query", "workspace_id": "a"})
        self.assertEqual(response.json(), expected)
        search.assert_awaited_once_with(query="original query", workspace_id="a", file_name=None)

    def test_workspace_header_does_not_replace_bearer_authentication(self):
        with patch.object(router, "search_native", AsyncMock()) as search:
            for authorization in ("", "Bearer invalid-key"):
                response = self.client.post("/search_native", headers={"Authorization": authorization, "Workspace-Id": "a"},
                                            json={"query": "q", "workspace_id": "a"})
                self.assertEqual(response.status_code, 401)
            search.assert_not_awaited()

    def test_missing_workspace_header_fails_closed(self):
        with patch.object(router, "search_native", AsyncMock()) as search:
            response = self.client.post("/search_native", headers=self.auth_headers,
                                        json={"query": "q", "workspace_id": "a"})
        self.assertEqual(response.status_code, 403)
        search.assert_not_awaited()

    def test_comma_separated_arguments_cannot_authorize_a_literal_workspace_id(self):
        with patch.object(router, "search_native", AsyncMock()) as search:
            response = self.client.post("/search_native", headers={**self.headers, "Workspace-Id": "a,b"},
                                        json={"query": "q", "workspace_id": "a,b"})
            self.assertEqual(response.status_code, 403)
            search.assert_not_awaited()
        with patch.object(server, "_get_effective_workspace_ids", return_value=["a", "b"]):
            for value in ("a,b", ["a,b"], " a "):
                with self.subTest(value=value), self.assertRaises(server.AuthorizationScopeError):
                    server._require_search_scope(value)

    def test_mcp_header_remains_required_and_cannot_expand_tool_scope(self):
        async def endpoint(request):
            server._require_search_scope(request.query_params.get("workspace"))
            return JSONResponse({"allowed": server._get_effective_workspace_ids()})
        app = Starlette(routes=[Route("/http", endpoint)], middleware=[
            Middleware(APIKeyAuthMiddleware, api_key=self.settings.MCP_API_KEY),
            Middleware(router.MCPWorkspaceIdMiddleware)])
        client = TestClient(app)
        self.assertEqual(client.get("/http?workspace=a", headers=self.auth_headers).status_code, 403)
        self.assertEqual(client.get("/http?workspace=a", headers={**self.headers, "Workspace-Id": "a"}).json(), {"allowed": ["a"]})
        with self.assertRaises(server.AuthorizationScopeError):
            client.get("/http?workspace=b", headers={**self.headers, "Workspace-Id": "a"})
        # Context from an authenticated request cannot survive its completion.
        with self.assertRaises(server.AuthorizationScopeError):
            server._get_effective_workspace_ids()

    def test_docs_and_remote_health_require_authentication(self):
        with patch.object(router, "get_engine") as engine:
            for path in ("/docs", "/openapi.json"):
                self.assertEqual(self.client.get(path).status_code, 401)
            for path in ("/health/live", "/health/ready"):
                self.assertEqual(self.client.get(path).status_code, 403)
                self.assertEqual(self.client.get(path, headers=self.auth_headers).status_code, 403)
            engine.assert_not_called()
        self.assertEqual(self.client.get("/openapi.json", headers=self.headers).status_code, 200)

    def test_internal_readiness_is_cached_and_failure_does_not_expose_errors(self):
        async def run():
            connection = AsyncMock()
            engine = Mock()
            engine.connect.return_value.__aenter__ = AsyncMock(return_value=connection)
            engine.connect.return_value.__aexit__ = AsyncMock(return_value=None)
            app = router.create_mcp_starlette_app()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 123)), base_url="http://local") as client:
                with patch.object(router, "get_engine", return_value=engine):
                    self.assertEqual((await client.get("/health/ready")).status_code, 401)
                    responses = await asyncio.gather(*(client.get("/health/ready", headers=self.auth_headers) for _ in range(8)))
                    self.assertTrue(all(response.json() == {"status": "ready"} for response in responses))
                    connection.execute.assert_awaited_once()
                    app.state.readiness_result = None
                    connection.execute.side_effect = RuntimeError("sensitive-db-information")
                    response = await client.get("/health/ready", headers=self.auth_headers)
                    self.assertEqual(response.status_code, 503)
                    self.assertNotIn("sensitive", response.text)
        asyncio.run(run())

    def test_body_and_pair_limits_apply_before_work(self):
        with patch.object(self.settings, "HTTP_BODY_MAX_BYTES", 30), patch.object(router, "search_native", AsyncMock()) as search:
            response = self.client.post("/search_native", headers=self.headers, content=b"x" * 31)
            self.assertEqual(response.status_code, 413)
            search.assert_not_awaited()
        with patch.object(self.settings, "HTTP_SUMMARY_MAX_PAIRS", 3), patch.object(router, "run_sync_db", AsyncMock()) as read:
            response = self.client.post("/summarize", headers=self.headers,
                                        json={"workspace_id": ["a", "b"], "file_name": ["x", "y"]})
            self.assertEqual(response.status_code, 422)
            read.assert_not_awaited()

    def test_chunked_body_limit_does_not_trust_content_length(self):
        async def run():
            downstream = AsyncMock()
            middleware = RequestBodyLimitMiddleware(downstream)
            receive = AsyncMock(side_effect=[{"type": "http.request", "body": b"123", "more_body": True},
                                             {"type": "http.request", "body": b"456", "more_body": False}])
            send = AsyncMock()
            with patch.object(self.settings, "HTTP_BODY_MAX_BYTES", 5):
                await middleware({"type": "http", "method": "POST", "headers": []}, receive, send)
            downstream.assert_not_awaited()
            self.assertEqual(send.await_args_list[0].args[0]["status"], 413)
        asyncio.run(run())

    def test_per_credential_rate_limit_blocks_before_model_work(self):
        with patch.object(self.settings, "HTTP_MODEL_REQUESTS_PER_MINUTE", 1), patch.object(
                router, "generate_document_routing_profile", AsyncMock(return_value={"document_id": "d"})) as generate:
            first = self.client.post("/routing-profile", headers=self.headers, json={"workspace_id": "a", "file_name": "x"})
            second = self.client.post("/routing-profile", headers=self.headers, json={"workspace_id": "a", "file_name": "x"})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        generate.assert_awaited_once()

    def test_image_limits_precede_decoding_and_pixel_processing(self):
        with patch.object(db.settings, "IMAGE_MAX_ENCODED_BYTES", 8), patch.object(db.base64, "b64decode") as decode:
            self.assertIsNone(db._decode_image_base64("A" * 12))
            decode.assert_not_called()
        with patch.object(db.settings, "IMAGE_MAX_DECODED_BYTES", 2):
            self.assertIsNone(db._decode_image_base64(base64.b64encode(b"123").decode()))
        buffer = io.BytesIO()
        Image.new("RGB", (10, 10)).save(buffer, format="PNG")
        raw = base64.b64encode(buffer.getvalue()).decode()
        with patch.object(db.settings, "IMAGE_MAX_PIXELS", 50):
            self.assertEqual(db._first_decodable_image_base64(raw), "")
            self.assertEqual(db._image_content_raw(SimpleNamespace(content=raw)), "")
            with self.assertRaisesRegex(ValueError, "pixel limit"):
                db._compress_image_base64(raw)
        self.assertTrue(db._compress_image_base64(raw))

    def test_logs_omit_payloads_sql_and_error_values(self):
        sensitive = "private-query-or-document"
        result = logs._safe_json_value({"input": {"query": sensitive}, "output": {"text": sensitive},
                                       "statement": sensitive, "parameters": sensitive, "error": sensitive,
                                       "source": sensitive, "document_id": sensitive, "workspace_ids": [sensitive],
                                       "event": "tool_call_returned", "duration_ms": 12})
        self.assertNotIn(sensitive, json.dumps(result))
        self.assertEqual(result["duration_ms"], 12)

    def test_provider_error_cannot_leak_document_content_to_console(self):
        secret = "confidential-document-fragment"
        with patch.object(router, "generate_document_routing_profile", AsyncMock(side_effect=RuntimeError(secret))), self.assertLogs(
                router.logger, level="ERROR") as captured:
            response = self.client.post("/routing-profile", headers=self.headers,
                                        json={"workspace_id": "a", "file_name": "x"})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(secret, response.text)
        self.assertNotIn(secret, "\n".join(captured.output))

    def test_workspace_ids_are_not_settings(self):
        self.assertNotIn("MCP_ALLOWED_WORKSPACES", Settings.model_fields)
        self.assertNotIn("MCP_CLIENT_WORKSPACES", Settings.model_fields)

    @unittest.skipIf(os.name == "nt", "POSIX file permissions")
    def test_rotated_log_files_remain_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "requests.jsonl"
            handler = logs.PrivateRotatingFileHandler(path, maxBytes=10, backupCount=1, encoding="utf-8")
            try:
                record = logging.LogRecord("test", logging.INFO, "", 0, "metadata-only", (), None)
                handler.emit(record)
                handler.emit(record)
            finally:
                handler.close()
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(Path(str(path) + ".1").stat().st_mode & 0o777, 0o600)


class TransportSecurityTests(unittest.TestCase):
    def test_invalid_startup_policy_stops_before_model_loading(self):
        async def run():
            configured = SimpleNamespace(MCP_API_KEY="key", LANGUAGE_MODEL_PATH="unused", SHUTDOWN_GRACE_SECONDS=1,
                                         LITELLM_BASE_URL="https://unapproved.example/v1", LITELLM_API_KEY="secret",
                                         MODEL_ALLOWED_ORIGINS=[], MODEL_ALLOW_HTTP_LOOPBACK=False)
            with patch.object(router, "get_settings", return_value=configured), patch.object(router, "validate_database_transport"), patch.object(
                    router, "initialize_language_model") as load, patch.object(router, "shutdown_resources", AsyncMock()):
                app = router.create_mcp_starlette_app()
                with self.assertRaisesRegex(ValueError, "not approved"):
                    async with app.router.lifespan_context(app):
                        self.fail("Unapproved model settings reached readiness")
                load.assert_not_called()
            configured.LITELLM_BASE_URL = None
            configured.LITELLM_API_KEY = None
            with patch.object(router, "get_settings", return_value=configured), patch.object(router, "validate_database_transport", side_effect=ValueError("TLS required")), patch.object(
                    router, "initialize_language_model") as load, patch.object(router, "shutdown_resources", AsyncMock()):
                app = router.create_mcp_starlette_app()
                with self.assertRaisesRegex(ValueError, "TLS required"):
                    async with app.router.lifespan_context(app):
                        self.fail("Invalid TLS settings reached readiness")
                load.assert_not_called()
        asyncio.run(run())

    def test_model_origin_https_and_redirect_policy(self):
        settings = SimpleNamespace(LITELLM_BASE_URL="https://models.example/v1",
                                   MODEL_ALLOWED_ORIGINS=["https://models.example"], MODEL_ALLOW_HTTP_LOOPBACK=False)
        with model_http_client(settings) as client:
            self.assertFalse(client.follow_redirects)
            self.assertFalse(client.trust_env)
        for endpoint in ("http://models.example/v1", "https://evil.example/v1", "https://models.example.evil/v1",
                         "https://models.example:8443/v1", "https://models.example:0/v1", "https://user:secret@models.example/v1"):
            with self.subTest(endpoint=endpoint), patch.object(settings, "LITELLM_BASE_URL", endpoint), self.assertRaises(ValueError):
                validate_model_endpoint(settings)
        settings.LITELLM_BASE_URL = "http://127.0.0.1:8000/v1"
        settings.MODEL_ALLOWED_ORIGINS = ["http://127.0.0.1:8000"]
        with self.assertRaises(ValueError):
            validate_model_endpoint(settings)
        settings.MODEL_ALLOW_HTTP_LOOPBACK = True
        validate_model_endpoint(settings)

    def test_database_tls_is_verified_for_both_drivers(self):
        settings = SimpleNamespace(DB_TLS_MODE="verify-full", DB_TLS_CA_FILE=None)
        with patch.object(database, "settings", settings):
            url, options = database._database_transport("postgresql+asyncpg://u:p@db.example/db?sslmode=verify-full", asynchronous=True)
            self.assertNotIn("sslmode", url.query)
            self.assertEqual(options["ssl"].verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(options["ssl"].check_hostname)
            _, options = database._database_transport("postgresql+psycopg2://u:p@db.example/db", asynchronous=False)
            self.assertEqual(options["sslmode"], "verify-full")
            for mode in ("disable", "require", "prefer", "allow", "verify-ca"):
                with self.subTest(mode=mode), self.assertRaises(ValueError):
                    database._database_transport("postgresql://u:p@db.example/db?sslmode=" + mode, asynchronous=True)
            _, options = database._database_transport("postgresql://localhost/db?sslmode=disable", asynchronous=True)
            self.assertFalse(options["ssl"])
            with self.assertRaises(ValueError):
                database._database_transport("postgresql://localhost/db?host=remote.example&sslmode=disable", asynchronous=True)
            with self.assertRaises(ValueError):
                database._database_transport("postgresql://localhost/db?sslmode=verify-full&ssl=disable", asynchronous=True)
