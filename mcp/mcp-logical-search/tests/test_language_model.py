import hashlib
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.modules import language
from src.mcp_server import router


class LanguageModelTests(unittest.TestCase):
    def setUp(self):
        language._model = None
        language._model_path = None

    def tearDown(self):
        router.operations.start_admission()
        language._model = None
        language._model_path = None

    def test_concurrent_first_requests_load_once(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.bin"
            model_path.write_bytes(b"verified model")
            expected = hashlib.sha256(model_path.read_bytes()).hexdigest()
            loaded_model = object()
            workers = 8
            barrier = threading.Barrier(workers)

            def load_model(_path):
                time.sleep(0.02)
                return loaded_model

            def initialize():
                barrier.wait()
                return language.initialize_language_model(model_path, expected)

            with patch.object(language.fasttext, "load_model", side_effect=load_model) as load:
                with ThreadPoolExecutor(max_workers=workers) as executor:
                    results = list(executor.map(lambda _: initialize(), range(workers)))

            self.assertTrue(all(result is loaded_model for result in results))
            load.assert_called_once_with(str(model_path.resolve()))

    def test_missing_artifact_fails_without_downloading(self):
        missing = Path(tempfile.gettempdir()) / "missing-language-model.bin"
        missing.unlink(missing_ok=True)

        with self.assertRaisesRegex(RuntimeError, "Provision it before starting"):
            language.initialize_language_model(missing)

        self.assertFalse(missing.exists())

    def test_application_loads_model_before_transport_readiness(self):
        events = []

        @asynccontextmanager
        async def transport_lifespan(_app):
            events.append("transport-ready")
            yield

        settings = SimpleNamespace(
            LANGUAGE_MODEL_PATH="/models/lid.176.bin",
            MCP_API_KEY="secret",
            SHUTDOWN_GRACE_SECONDS=1,
            LITELLM_BASE_URL=None,
            LITELLM_API_KEY=None,
        )

        async def start_app():
            with patch.object(router, "validate_database_transport"), patch.object(router, "get_settings", return_value=settings), patch.object(
                router.mcp,
                "http_app",
                return_value=SimpleNamespace(lifespan=transport_lifespan),
            ), patch.object(
                router,
                "initialize_language_model",
                side_effect=lambda path: events.append(("model", path)),
            ), patch.object(router, "close_embeddings"), patch.object(
                router, "dispose_engines", new_callable=AsyncMock
            ):
                app = router.create_mcp_starlette_app()
                async with app.router.lifespan_context(app):
                    self.assertEqual(
                        events,
                        [("model", settings.LANGUAGE_MODEL_PATH), "transport-ready"],
                    )

        import asyncio

        asyncio.run(start_app())

    def test_multiple_process_startup_only_reads_shared_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model_path = root / "model.bin"
            model_path.write_bytes(b"shared immutable model")
            expected = hashlib.sha256(model_path.read_bytes()).hexdigest()
            fake_module = root / "fasttext.py"
            fake_module.write_text(
                "class FastText:\n"
                "    class _FastText: pass\n"
                "def load_model(path): return FastText._FastText()\n",
                encoding="utf-8",
            )
            original = model_path.read_bytes()
            original_mtime = model_path.stat().st_mtime_ns
            code = (
                "from src.modules.language import initialize_language_model; "
                f"initialize_language_model({str(model_path)!r}, {expected!r})"
            )
            env = os.environ.copy()
            env["PYTHONPATH"] = os.pathsep.join((str(root), str(Path.cwd())))

            processes = [
                subprocess.Popen([sys.executable, "-c", code], env=env)
                for _ in range(2)
            ]
            return_codes = [process.wait(timeout=10) for process in processes]

            self.assertEqual(return_codes, [0, 0])
            self.assertEqual(model_path.read_bytes(), original)
            self.assertEqual(model_path.stat().st_mtime_ns, original_mtime)


if __name__ == "__main__":
    unittest.main()
