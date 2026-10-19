import hashlib
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from scripts.provision_language_model import provision


class ProvisionLanguageModelTests(unittest.TestCase):
    def test_concurrent_provision_uses_verified_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.bin"
            destination = root / "models" / "model.bin"
            content = b"verified model artifact"
            source.write_bytes(content)
            expected = hashlib.sha256(content).hexdigest()

            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(
                    executor.map(
                        lambda _: provision(destination, expected, source=source),
                        range(2),
                    )
                )

            self.assertEqual(results, [None, None])
            self.assertEqual(destination.read_bytes(), content)
            self.assertEqual(list(destination.parent.glob("tmp*")), [])

    def test_rejects_unverified_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.bin"
            destination = root / "model.bin"
            source.write_bytes(b"bad model")

            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                provision(destination, "0" * 64, source=source)

            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
