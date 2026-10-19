import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from src.logger import file_request_logging as request_logging


class FileRequestLoggingTests(unittest.IsolatedAsyncioTestCase):
    def test_large_content_and_image_bodies_are_omitted_before_serializing(self):
        body = MagicMock()
        body.__len__.return_value = 2_000_000

        sanitized = request_logging._safe_json_value({
            "content": body,
            "image_base64": body,
            "duration_ms": 12.5,
        })

        self.assertEqual(sanitized["content"], {"omitted": True})
        self.assertEqual(sanitized["image_base64"], {"omitted": True})
        self.assertEqual(sanitized["duration_ms"], 12.5)

    def test_mcp_image_objects_are_reduced_to_metadata(self):
        class Image:
            type = "image"
            data = "encoded-image" * 1000

            def __repr__(self):
                raise AssertionError("image repr must not be called")

        self.assertEqual(
            request_logging._safe_json_value(Image()),
            {"type": "image", "data": {"omitted": True, "size": 13_000}},
        )

    async def test_unsampled_tool_call_does_not_create_a_file_logger(self):
        operation = AsyncMock(return_value={"content": "large result"})
        wrapped = request_logging.log_tool_call(operation)
        settings = MagicMock(REQUEST_LOG_ENABLED=True, REQUEST_LOG_SAMPLE_RATE=0.0)

        with patch.object(request_logging, "get_settings", return_value=settings), patch.object(
            request_logging, "get_tool_file_logger"
        ) as get_logger:
            result = await wrapped()

        self.assertEqual(result, {"content": "large result"})
        get_logger.assert_not_called()


if __name__ == "__main__":
    unittest.main()
