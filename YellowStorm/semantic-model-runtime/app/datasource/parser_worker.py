"""Private subprocess entry point for bounded datasource parsing."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


def _apply_resource_limits() -> None:
    if os.name != "posix":
        return
    import resource
    from .datasets import MAX_DATASET_BYTES

    try:
        memory_mb = int(os.environ.get("SEMANTIC_PARSER_MEMORY_MB", "512"))
        timeout = int(os.environ.get("SEMANTIC_PARSER_TIMEOUT_SECONDS", "30"))
    except ValueError:
        memory_mb, timeout = 512, 30
    memory_bytes = max(128, min(memory_mb, 4096)) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_DATASET_BYTES, MAX_DATASET_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def main() -> int:
    if len(sys.argv) != 4:
        return 2
    try:
        _apply_resource_limits()
    except Exception:
        sys.stdout.write('{"ok":false,"infrastructureError":"parser_bootstrap_failed"}')
        return 3
    try:
        request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        source = request.get("source")
        options = request.get("options")
        operation = request.get("operation", "preview")
        if not isinstance(source, dict) or (options is not None and not isinstance(options, dict)):
            raise ValueError("invalid_command")
        data = Path(sys.argv[2]).read_bytes()
        if operation == "preview":
            from .discovery import preview_source
            result = preview_source(source, options, data)
        elif operation == "prepare":
            from .datasets import prepare_parquet
            from .discovery import preview_source
            result = preview_source(source, options, data)
            result["dataset"] = prepare_parquet(source, options, data, Path(sys.argv[3]))
        else:
            raise ValueError("invalid_operation")
        envelope = {"ok": True, "result": result}
    except ValueError as exc:
        envelope = {"ok": False, "errorCode": str(exc) or "parser_failed"}
    except Exception:
        envelope = {"ok": False, "infrastructureError": "parser_runtime_failed"}
    sys.stdout.write(json.dumps(envelope, separators=(",", ":"), allow_nan=False))
    return 0 if envelope["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
