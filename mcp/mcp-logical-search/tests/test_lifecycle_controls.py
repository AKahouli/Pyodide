import asyncio
import unittest
import httpx
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from src.db import session as db_session
from src.modules import embeddings
from src.modules.model_requests import run_sync_model_request


class LifecycleControlTests(unittest.TestCase):
    def tearDown(self):
        embeddings.get_azure_openai_embeddings.cache_clear()

    def test_litellm_endpoint_uses_qwen_model_and_raw_text(self):
        settings = SimpleNamespace(
            EMBEDDING_DIMENSION=2048,
            LITELLM_BASE_URL="https://gateway.example/v1", LITELLM_API_KEY="gateway-secret",
            MODEL_ALLOWED_ORIGINS=["https://gateway.example"], MODEL_ALLOW_HTTP_LOOPBACK=False,
            OPENAI_MODEL="qwen3-vl-embedding", OPENAI_CHUNK_SIZE=100, EMBEDDING_TIMEOUT_SECONDS=4,
            OPENAI_RETRY_MIN_SECONDS=1, OPENAI_RETRY_MAX_SECONDS=2,
        )
        requests = []
        vector = [0.1] * 2048

        def respond(request):
            import json
            requests.append((str(request.url), request.headers, json.loads(request.content)))
            return httpx.Response(200, json={"object": "list", "model": settings.OPENAI_MODEL,
                "data": [{"object": "embedding", "index": 0, "embedding": vector}],
                "usage": {"prompt_tokens": 1, "total_tokens": 1}})

        client = httpx.Client(transport=httpx.MockTransport(respond))
        with patch.object(embeddings, "get_settings", return_value=settings), patch.object(
            embeddings, "model_http_client", return_value=client):
            self.assertTrue(embeddings.embedding_configured(settings))
            result = embeddings.get_embeddings().embed_query("Find the crocodile", user="search")
            embeddings.close_embeddings()
        self.assertEqual(result, vector)
        url, headers, payload = requests[0]
        self.assertEqual(url, settings.LITELLM_BASE_URL + "/embeddings")
        self.assertEqual(payload["model"], settings.OPENAI_MODEL)
        self.assertNotIn("dimensions", payload)
        self.assertEqual(payload["input"], ["Find the crocodile"])
        self.assertEqual(headers["authorization"], "Bearer gateway-secret")

    def test_litellm_requires_both_gateway_settings(self):
        for endpoint, key in (("https://gateway.example/v1", None), (None, "key"), ("", "key")):
            settings = SimpleNamespace(LITELLM_BASE_URL=endpoint, LITELLM_API_KEY=key)
            with self.subTest(endpoint=endpoint, key=key), patch.object(
                embeddings, "get_settings", return_value=settings
            ):
                self.assertFalse(embeddings.embedding_configured(settings))
                with self.assertRaisesRegex(RuntimeError, "LITELLM_BASE_URL and LITELLM_API_KEY"):
                    embeddings.get_embeddings()

    def test_embedding_model_reuses_and_closes_one_http_pool(self):
        http_client = Mock()
        model = SimpleNamespace(http_client=http_client)
        settings = SimpleNamespace(
            EMBEDDING_DIMENSION=2048,
            LITELLM_BASE_URL="https://litellm.example/v1",
            MODEL_ALLOWED_ORIGINS=["https://litellm.example"], MODEL_ALLOW_HTTP_LOOPBACK=False,
            LITELLM_API_KEY="key",
            OPENAI_MODEL="embedding-model",
            OPENAI_CHUNK_SIZE=100,
            EMBEDDING_TIMEOUT_SECONDS=4.0,
            OPENAI_RETRY_MIN_SECONDS=1,
            OPENAI_RETRY_MAX_SECONDS=2,
        )
        with patch.object(embeddings, "get_settings", return_value=settings), patch(
            "httpx.Client", return_value=http_client
        ) as client_type, patch(
            "langchain_openai.OpenAIEmbeddings", return_value=model
        ) as model_type:
            first = embeddings.get_embeddings("first-user")
            second = embeddings.get_embeddings("second-user")
            embeddings.close_embeddings()

        self.assertIs(first, second)
        client_type.assert_called_once_with(timeout=4.0, verify=True, follow_redirects=False, trust_env=False)
        self.assertEqual(model_type.call_args.kwargs["timeout"], 4.0)
        self.assertEqual(model_type.call_args.kwargs["max_retries"], 0)
        http_client.close.assert_called_once_with()

    def test_async_engine_has_checkout_connect_and_statement_timeouts(self):
        engine = SimpleNamespace(sync_engine=object())
        configured = SimpleNamespace(
            DATABASE_URL="postgresql://user:password@database/name",
            DB_POOL_SIZE=2,
            DB_MAX_OVERFLOW=3,
            DB_POOL_TIMEOUT_SECONDS=4.0,
            DB_CONNECT_TIMEOUT_SECONDS=5,
            DB_STATEMENT_TIMEOUT_MS=6000,
            DB_ECHO=False,
            DB_TLS_MODE="verify-full", DB_TLS_CA_FILE=None,
        )
        with patch.object(db_session, "settings", configured), patch.object(
            db_session, "_engine", None
        ), patch.object(
            db_session, "create_async_engine", return_value=engine
        ) as create, patch.object(db_session, "_register_query_file_logging"):
            db_session.get_engine()

        options = create.call_args.kwargs
        self.assertEqual(options["pool_timeout"], 4.0)
        self.assertEqual(options["connect_args"]["timeout"], 5)
        self.assertEqual(
            options["connect_args"]["server_settings"]["statement_timeout"],
            "6000",
        )
        self.assertEqual(options["connect_args"]["server_settings"]["default_transaction_read_only"], "on")


class ModelAdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_timed_out_sync_request_keeps_model_permit_until_worker_finishes(self):
        started = asyncio.Event()
        finish = asyncio.Event()

        def blocking_request():
            self.loop.call_soon_threadsafe(started.set)
            asyncio.run_coroutine_threadsafe(finish.wait(), self.loop).result(1)

        self.loop = asyncio.get_running_loop()
        configured = SimpleNamespace(MODEL_REQUEST_LIMIT=1, MODEL_QUEUE_LIMIT=100)
        with patch("src.modules.model_requests.get_settings", return_value=configured):
            with self.assertRaises(asyncio.TimeoutError):
                await run_sync_model_request(blocking_request, timeout=0.2)
            await asyncio.wait_for(started.wait(), 1)

            second_started = False

            def second_request():
                nonlocal second_started
                second_started = True

            second = asyncio.create_task(run_sync_model_request(
                second_request, timeout=1.0
            ))
            await asyncio.sleep(0.02)
            self.assertFalse(second_started)
            finish.set()
            await second


if __name__ == "__main__":
    unittest.main()
