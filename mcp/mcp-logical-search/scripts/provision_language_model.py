#!/usr/bin/env python
"""Provision a verified fastText language model before application startup."""

import argparse
import hashlib
import os
import shutil
import tempfile
import urllib.request
from pathlib import Path

MODEL_SHA256 = "7e69ec5451bc261cc7844e49e4792a85d7f09c06789ec800fc4a44aec362764e"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def provision(
    destination: Path,
    expected_sha256: str,
    *,
    source: Path | None = None,
    url: str | None = None,
    timeout: float = 30.0,
) -> None:
    expected_sha256 = expected_sha256.lower()
    if destination.is_file() and sha256(destination) == expected_sha256:
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temp:
            temp_name = temp.name
            if source is not None:
                with source.open("rb") as local_source:
                    shutil.copyfileobj(local_source, temp)
            else:
                with urllib.request.urlopen(url, timeout=timeout) as response:
                    shutil.copyfileobj(response, temp)

        temp_path = Path(temp_name)
        actual_sha256 = sha256(temp_path)
        if actual_sha256 != expected_sha256:
            raise RuntimeError(
                f"Language model checksum mismatch: expected {expected_sha256}, "
                f"got {actual_sha256}"
            )
        os.replace(temp_path, destination)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument("--source", type=Path, help="Local artifact for offline builds")
    origin.add_argument("--url", help="Artifact URL")
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--sha256", default=MODEL_SHA256)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()
    provision(
        args.destination,
        args.sha256,
        source=args.source,
        url=args.url,
        timeout=args.timeout,
    )


if __name__ == "__main__":
    main()
