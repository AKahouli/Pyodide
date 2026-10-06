from dataclasses import dataclass
import os
from pathlib import Path


def _load_local_env() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_local_env()


@dataclass(frozen=True)
class Settings:
    backend_url: str
    internal_token: str
    ingress_token: str
    timeout_seconds: float
    port: int
    max_response_bytes: int
    default_timeout_seconds: int
    max_timeout_seconds: int
    max_code_bytes: int
    max_input_bytes: int
    max_log_bytes: int
    max_result_bytes: int
    max_queue: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            backend_url=os.getenv("YELLOWSTORM_BACKEND_URL", "http://localhost:3000").rstrip("/"),
            internal_token=os.getenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", ""),
            ingress_token=os.getenv("PYODIDE_MCP_INGRESS_TOKEN", ""),
            timeout_seconds=float(os.getenv("PYODIDE_MCP_TIMEOUT_SECONDS", "100")),
            port=int(os.getenv("MCP_PORT", "8027")),
            max_response_bytes=int(os.getenv("PYODIDE_MCP_MAX_RESPONSE_BYTES", str(512 * 1024))),
            default_timeout_seconds=int(os.getenv("PYODIDE_MCP_DEFAULT_TIMEOUT_SECONDS", "30")),
            max_timeout_seconds=int(os.getenv("PYODIDE_MCP_MAX_TIMEOUT_SECONDS", "90")),
            max_code_bytes=int(os.getenv("PYODIDE_MCP_MAX_CODE_BYTES", str(64 * 1024))),
            max_input_bytes=int(os.getenv("PYODIDE_MCP_MAX_INPUT_BYTES", str(2 * 1024 * 1024))),
            max_log_bytes=int(os.getenv("PYODIDE_MCP_MAX_LOG_BYTES", str(256 * 1024))),
            max_result_bytes=int(os.getenv("PYODIDE_MCP_MAX_RESULT_BYTES", str(512 * 1024))),
            max_queue=int(os.getenv("PYODIDE_MCP_MAX_QUEUE", "3")),
        )

    def validate(self) -> None:
        if not self.internal_token:
            raise ValueError("YELLOWSTORM_INTERNAL_SERVICE_TOKEN is required")
        if not self.ingress_token:
            raise ValueError("PYODIDE_MCP_INGRESS_TOKEN is required")
        if not self.backend_url.startswith(("http://", "https://")):
            raise ValueError("YELLOWSTORM_BACKEND_URL must be an HTTP(S) URL")
        if not 1 <= self.port <= 65535:
            raise ValueError("MCP_PORT is invalid")
        if not 1 <= self.timeout_seconds <= 300:
            raise ValueError("PYODIDE_MCP_TIMEOUT_SECONDS must be between 1 and 300")
        if not 1024 <= self.max_response_bytes <= 8 * 1024 * 1024:
            raise ValueError("PYODIDE_MCP_MAX_RESPONSE_BYTES must be between 1024 and 8388608")
        if not 1 <= self.default_timeout_seconds <= self.max_timeout_seconds <= 90:
            raise ValueError("Pyodide timeouts must satisfy 1 <= default <= max <= 90")
        if not 1024 <= self.max_code_bytes <= 1024 * 1024:
            raise ValueError("PYODIDE_MCP_MAX_CODE_BYTES must be between 1024 and 1048576")
        if not 1024 <= self.max_input_bytes <= 8 * 1024 * 1024:
            raise ValueError("PYODIDE_MCP_MAX_INPUT_BYTES must be between 1024 and 8388608")
        if not 1 <= self.max_queue <= 10:
            raise ValueError("PYODIDE_MCP_MAX_QUEUE must be between 1 and 10")
