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
    ingress_token: str
    timeout_seconds: float
    port: int
    max_response_bytes: int
    auth_mode: str = "JWT"
    jwt_public_key_file: str = ""
    jwt_issuer: str = ""
    jwt_audience: str = "mcp-semantic-model"
    environment: str = "development"

    @classmethod
    def from_env(cls) -> "Settings":
        environment = os.getenv("ENVIRONMENT", "development")
        auth_mode = os.getenv("SEMANTIC_MODEL_MCP_AUTH_MODE", "JWT")
        return cls(
            backend_url=os.getenv("YELLOWSTORM_BACKEND_URL", "http://localhost:3000").rstrip("/"),
            ingress_token="",
            timeout_seconds=float(os.getenv("SEMANTIC_MODEL_MCP_TIMEOUT_SECONDS", "120")),
            port=int(os.getenv("MCP_PORT", "8027")),
            max_response_bytes=int(os.getenv("SEMANTIC_MODEL_MCP_MAX_RESPONSE_BYTES", str(2 * 1024 * 1024))),
            auth_mode=auth_mode,
            jwt_public_key_file=os.getenv("SEMANTIC_MODEL_MCP_JWT_PUBLIC_KEY_FILE", ""),
            jwt_issuer=os.getenv("SEMANTIC_MODEL_MCP_JWT_ISSUER", ""),
            jwt_audience=os.getenv("SEMANTIC_MODEL_MCP_JWT_AUDIENCE", "mcp-semantic-model"),
            environment=environment,
        )

    def validate(self) -> None:
        if self.auth_mode != "JWT":
            raise ValueError("SEMANTIC_MODEL_MCP_AUTH_MODE must be JWT")
        if not all(value.strip() for value in (self.jwt_public_key_file, self.jwt_issuer, self.jwt_audience)):
            raise ValueError("JWT mode requires a public key file, issuer and audience")
        if not self.backend_url.startswith(("http://", "https://")):
            raise ValueError("YELLOWSTORM_BACKEND_URL must be an HTTP(S) URL")
        if not 1 <= self.port <= 65535:
            raise ValueError("MCP_PORT is invalid")
        if not 1 <= self.timeout_seconds <= 300:
            raise ValueError("SEMANTIC_MODEL_MCP_TIMEOUT_SECONDS must be between 1 and 300")
        if not 1024 <= self.max_response_bytes <= 8 * 1024 * 1024:
            raise ValueError("SEMANTIC_MODEL_MCP_MAX_RESPONSE_BYTES must be between 1024 and 8388608")
