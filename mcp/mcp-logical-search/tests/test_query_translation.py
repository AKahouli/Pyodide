import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.modules import query_translation


class QueryTranslationTests(unittest.TestCase):
    def setUp(self):
        transport = patch.object(query_translation, "model_http_client")
        transport.start()
        self.addCleanup(transport.stop)

    def test_disabled_returns_original_variants_without_detection_or_provider(self):
        with patch.object(query_translation, "get_settings", return_value=SimpleNamespace(
                QUERY_TRANSLATION_ENABLED=False)), patch.object(
                query_translation, "detect_language") as detect, patch.object(
                query_translation, "_get_translation_client") as client, patch.object(
                query_translation, "run_async_model_request", AsyncMock()) as request:
            result = asyncio.run(query_translation.build_fts_query_variants(
                "capital expenditure", ["french", "english", "french"]))
        self.assertEqual(result, {"french": ["capital expenditure"], "english": ["capital expenditure"]})
        detect.assert_not_called()
        client.assert_not_called()
        request.assert_not_awaited()

    def test_retries_share_translation_budget_even_with_long_request_deadline(self):
        responses = [
            SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
            for content in ('{"translations": {}}', '{"translations": {"french": "quantité"}}')
        ]
        settings = SimpleNamespace(
            QUERY_TRANSLATION_ENABLED=True,
            LITELLM_BASE_URL="https://model.invalid", LITELLM_API_KEY="test",
            OPENAI_MAX_RETRIES=0, QUERY_TRANSLATION_MODEL="test",
            QUERY_TRANSLATION_REASONING_EFFORT=None, QUERY_TRANSLATION_TIMEOUT_SECONDS=1.0,
        )
        with patch.object(query_translation, "get_settings", return_value=settings), patch.object(
            query_translation, "detect_language", return_value="en",
        ), patch.object(query_translation, "AsyncOpenAI", return_value=SimpleNamespace()), patch.object(
            query_translation, "run_async_model_request", AsyncMock(side_effect=responses),
        ) as request, patch.object(query_translation.logger, "info") as info:
            started = query_translation.time.monotonic()
            result = asyncio.run(query_translation.build_fts_query_variants(
                "quantity", ["french"], deadline=started + 30,
            ))

        self.assertEqual(result, {"french": ["quantité", "quantity"]})
        deadlines = [call.kwargs["deadline"] for call in request.await_args_list]
        self.assertEqual(len(deadlines), 2)
        self.assertEqual(deadlines[0], deadlines[1])
        self.assertLess(deadlines[0] - started, 1.5)
        self.assertNotIn("quantity", str(info.call_args_list))
        self.assertNotIn(result["french"][0], str(info.call_args_list))

    def test_translates_only_languages_different_from_query_language(self):
        completion = AsyncMock(return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(
                content=json.dumps({
                    "translations": {"french": "quantité de produits"},
                })
            ))]
        ))
        client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=completion),
            ),
        )
        settings = SimpleNamespace(
            QUERY_TRANSLATION_ENABLED=True,
            LITELLM_BASE_URL="https://litellm.example/v1",
            LITELLM_API_KEY="key",
            OPENAI_MAX_RETRIES=1,
            QUERY_TRANSLATION_MODEL="translation-model",
            QUERY_TRANSLATION_REASONING_EFFORT="low",
            QUERY_TRANSLATION_TIMEOUT_SECONDS=1.0,
        )

        with patch.object(query_translation, "detect_language", return_value="en"), patch.object(
            query_translation, "get_settings", return_value=settings
        ), patch.object(query_translation, "AsyncOpenAI", return_value=client):
            result = asyncio.run(query_translation.build_fts_query_variants(
                "quantity of products",
                ["english", "french"],
            ))

        self.assertEqual(result, {
            "english": ["quantity of products"],
            "french": ["quantité de produits", "quantity of products"],
        })
        request = completion.await_args.kwargs
        self.assertEqual(request["model"], "translation-model")
        self.assertEqual(request["reasoning_effort"], "low")
        payload = json.loads(request["messages"][1]["content"])
        self.assertEqual(payload["targets"], {"french": "fr"})

    def test_translation_failure_falls_back_to_original_query(self):
        completion = AsyncMock(side_effect=RuntimeError("translation unavailable"))
        client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=completion),
            ),
        )
        settings = SimpleNamespace(
            QUERY_TRANSLATION_ENABLED=True,
            LITELLM_BASE_URL="https://litellm.example/v1",
            LITELLM_API_KEY="key",
            OPENAI_MAX_RETRIES=1,
            QUERY_TRANSLATION_MODEL="translation-model",
            QUERY_TRANSLATION_REASONING_EFFORT=None,
            QUERY_TRANSLATION_TIMEOUT_SECONDS=1.0,
        )

        with patch.object(query_translation, "detect_language", return_value="en"), patch.object(
            query_translation, "get_settings", return_value=settings
        ), patch.object(query_translation, "AsyncOpenAI", return_value=client):
            result = asyncio.run(query_translation.build_fts_query_variants(
                "quantity",
                ["french"],
            ))

        self.assertEqual(result, {"french": ["quantity"]})

    def test_translation_timeout_falls_back_to_original_query(self):
        async def never_returns(**kwargs):
            await asyncio.sleep(60)

        client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=never_returns),
            ),
        )
        settings = SimpleNamespace(
            QUERY_TRANSLATION_ENABLED=True,
            LITELLM_BASE_URL="https://litellm.example/v1",
            LITELLM_API_KEY="key",
            OPENAI_MAX_RETRIES=1,
            QUERY_TRANSLATION_MODEL="translation-model",
            QUERY_TRANSLATION_REASONING_EFFORT=None,
            QUERY_TRANSLATION_TIMEOUT_SECONDS=0.01,
        )

        with patch.object(query_translation, "detect_language", return_value="en"), patch.object(
            query_translation, "get_settings", return_value=settings
        ), patch.object(query_translation, "AsyncOpenAI", return_value=client):
            result = asyncio.run(query_translation.build_fts_query_variants(
                "quantity",
                ["french"],
            ))

        self.assertEqual(result, {"french": ["quantity"]})

    def test_unchanged_exact_identifier_does_not_retry(self):
        completion = AsyncMock(return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(
                content=json.dumps({"translations": {"french": "ISO-9001"}})
            ))]
        ))
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=completion)),
        )
        settings = SimpleNamespace(
            QUERY_TRANSLATION_ENABLED=True,
            LITELLM_BASE_URL="https://litellm.example/v1",
            LITELLM_API_KEY="key",
            OPENAI_MAX_RETRIES=1,
            QUERY_TRANSLATION_MODEL="translation-model",
            QUERY_TRANSLATION_REASONING_EFFORT=None,
            QUERY_TRANSLATION_TIMEOUT_SECONDS=1.0,
        )

        with patch.object(query_translation, "detect_language", return_value="en"), patch.object(
            query_translation, "get_settings", return_value=settings
        ), patch.object(query_translation, "AsyncOpenAI", return_value=client):
            result = asyncio.run(query_translation.build_fts_query_variants(
                "ISO-9001",
                ["french"],
            ))

        self.assertEqual(result, {"french": ["ISO-9001"]})
        self.assertEqual(completion.await_count, 1)

    def test_all_attempts_share_one_deadline(self):
        async def missing_then_slow(**kwargs):
            if completion.await_count == 1:
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
                    content=json.dumps({"translations": {}})
                ))])
            await asyncio.sleep(60)

        completion = AsyncMock(side_effect=missing_then_slow)
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=completion)),
        )
        settings = SimpleNamespace(
            QUERY_TRANSLATION_ENABLED=True,
            LITELLM_BASE_URL="https://litellm.example/v1",
            LITELLM_API_KEY="key",
            OPENAI_MAX_RETRIES=1,
            QUERY_TRANSLATION_MODEL="translation-model",
            QUERY_TRANSLATION_REASONING_EFFORT=None,
            QUERY_TRANSLATION_TIMEOUT_SECONDS=30.0,
        )

        with patch.object(query_translation, "detect_language", return_value="en"), patch.object(
            query_translation, "get_settings", return_value=settings
        ), patch.object(query_translation, "AsyncOpenAI", return_value=client):
            started = query_translation.time.monotonic()
            result = asyncio.run(query_translation.build_fts_query_variants(
                "quantity",
                ["french"],
                deadline=started + 0.02,
            ))

        self.assertEqual(result, {"french": ["quantity"]})
        self.assertEqual(completion.await_count, 2)
        self.assertLess(query_translation.time.monotonic() - started, 0.5)


if __name__ == "__main__":
    unittest.main()
