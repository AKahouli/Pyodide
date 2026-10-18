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
    auth_mode: str = "Bearer"
    jwt_public_key_file: str = ""
    jwt_issuer: str = ""
    jwt_audience: str = "mcp-agent"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            backend_url=os.getenv("YELLOWSTORM_BACKEND_URL", "http://localhost:3000").rstrip("/"),
            internal_token=os.getenv("AGENT_MCP_BACKEND_SERVICE_TOKEN", ""),
            ingress_token=os.getenv("AGENT_MCP_INGRESS_TOKEN", ""),
            timeout_seconds=float(os.getenv("AGENT_MCP_TIMEOUT_SECONDS", "60")),
            port=int(os.getenv("MCP_PORT", "8026")),
            max_response_bytes=int(os.getenv("AGENT_MCP_MAX_RESPONSE_BYTES", str(2 * 1024 * 1024))),
            auth_mode=os.getenv("AGENT_MCP_AUTH_MODE", "Bearer"),
            jwt_public_key_file=os.getenv("AGENT_MCP_JWT_PUBLIC_KEY_FILE", ""),
            jwt_issuer=os.getenv("AGENT_MCP_JWT_ISSUER", ""),
            jwt_audience=os.getenv("AGENT_MCP_JWT_AUDIENCE", "mcp-agent"),
        )

    def validate(self) -> None:
        if not self.internal_token.strip() or self.internal_token != self.internal_token.strip():
            raise ValueError("AGENT_MCP_BACKEND_SERVICE_TOKEN is required without surrounding whitespace")
        if os.getenv("ENVIRONMENT") == "production" and len(self.internal_token) < 32:
            raise ValueError("AGENT_MCP_BACKEND_SERVICE_TOKEN must be at least 32 characters in production")
        if self.auth_mode not in ("JWT", "Bearer"):
            raise ValueError("AGENT_MCP_AUTH_MODE must be JWT or Bearer")
        if self.auth_mode == "JWT" and not (self.jwt_public_key_file and self.jwt_issuer and self.jwt_audience):
            raise ValueError("JWT mode requires a public key file, issuer and audience")
        if self.auth_mode == "Bearer" and not self.ingress_token:
            raise ValueError("AGENT_MCP_INGRESS_TOKEN is required")
        if not self.backend_url.startswith(("http://", "https://")):
            raise ValueError("YELLOWSTORM_BACKEND_URL must be an HTTP(S) URL")
        if not 1 <= self.port <= 65535:
            raise ValueError("MCP_PORT is invalid")
        if not 1 <= self.timeout_seconds <= 300:
            raise ValueError("AGENT_MCP_TIMEOUT_SECONDS must be between 1 and 300")
        if not 1024 <= self.max_response_bytes <= 8 * 1024 * 1024:
            raise ValueError("AGENT_MCP_MAX_RESPONSE_BYTES must be between 1024 and 8388608")
