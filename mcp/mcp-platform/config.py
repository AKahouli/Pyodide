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
    """Single deployment configuration for every platform tool module.

    Shared settings use the MCP_ prefix; tool-module-specific settings keep
    their module prefix (e.g. PLAYBOOK_MCP_SEARCH_LIMIT_MAX).
    """

    backend_url: str
    timeout_seconds: float
    max_response_bytes: int
    search_limit_max: int
    port: int
    host: str
    transport: str
    jwt_public_key_file: str
    jwt_issuer: str = "yellowstorm"
    jwt_audience: str = "mcp-platform"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            backend_url=os.getenv("YELLOWSTORM_BACKEND_URL", "http://localhost:3000").rstrip("/"),
            timeout_seconds=float(os.getenv("MCP_TIMEOUT_SECONDS", "190")),
            max_response_bytes=int(os.getenv("MCP_MAX_RESPONSE_BYTES", str(2 * 1024 * 1024))),
            search_limit_max=int(os.getenv("PLAYBOOK_MCP_SEARCH_LIMIT_MAX", "25")),
            port=int(os.getenv("PORT", "8030")),
            host=os.getenv("HOST", "0.0.0.0"),
            transport=os.getenv("MCP_TRANSPORT", "streamable-http"),
            jwt_public_key_file=os.getenv("MCP_JWT_PUBLIC_KEY_FILE", ""),
            jwt_issuer=os.getenv("MCP_JWT_ISSUER", "yellowstorm"),
            jwt_audience=os.getenv("MCP_JWT_AUDIENCE", "mcp-platform"),
        )

    def validate(self) -> None:
        if self.transport != "streamable-http":
            raise ValueError("MCP_TRANSPORT must be streamable-http (stateless)")
        if not all(value.strip() for value in (self.jwt_public_key_file, self.jwt_issuer, self.jwt_audience)):
            raise ValueError("JWT authentication requires a public key file, issuer and audience")
        if not self.backend_url.startswith(("http://", "https://")):
            raise ValueError("YELLOWSTORM_BACKEND_URL must be an HTTP(S) URL")
        if not 1 <= self.port <= 65535:
            raise ValueError("PORT is invalid")
        if not 1 <= self.timeout_seconds <= 300:
            raise ValueError("MCP_TIMEOUT_SECONDS must be between 1 and 300")
        if not 1024 <= self.max_response_bytes <= 8 * 1024 * 1024:
            raise ValueError("MCP_MAX_RESPONSE_BYTES must be between 1024 and 8388608")
        if not 1 <= self.search_limit_max <= 25:
            raise ValueError("PLAYBOOK_MCP_SEARCH_LIMIT_MAX must be between 1 and 25")
