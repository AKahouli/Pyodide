import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from auth import TrustedIdentityMiddleware
from config import Settings
from test_auth import app


@pytest.fixture(scope="module")
def keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


async def request(keys, claims=None, token=None, extra_headers=()):
    now = int(time.time())
    payload = {"sub": "user-1", "iss": "yellowstorm", "aud": "mcp-semantic-model", "iat": now, "exp": now + 300}
    payload.update(claims or {})
    if token is None:
        token = jwt.encode(payload, keys[0], algorithm="RS256")
    messages = []

    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(app, "ingress-secret", auth_mode="JWT",
        jwt_public_key=keys[1], jwt_issuer="yellowstorm")
    await middleware({"type": "http", "path": "/mcp", "headers": [
        (b"authorization", f"Bearer {token}".encode()), *extra_headers
    ]}, lambda: None, send)
    return messages


@pytest.mark.asyncio
async def test_jwt_identity_cannot_be_overridden_by_header(keys):
    # A header AGREEING with the signed sub is ignored (trace only); a
    # disagreeing header is rejected outright (WP06.3).
    messages = await request(keys, extra_headers=[(b"x-yellowstorm-user-id", b"user-1")])
    assert messages[0]["status"] == 200
    assert messages[1]["body"] == b"user-1"


@pytest.mark.asyncio
async def test_header_disagreeing_with_signed_sub_is_rejected(keys):
    # WP06.3: a header that names a DIFFERENT user than the signed sub must
    # fail closed instead of being silently ignored.
    messages = await request(keys, claims={"sub": "user-2"}, extra_headers=[(b"x-yellowstorm-user-id", b"user-1")])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("lifetime", [301, 3600])
async def test_rejects_tokens_with_lifetimes_over_five_minutes(keys, lifetime):
    # WP06.2: backend-issued tokens live at most five minutes; a longer
    # lifetime means the token was not minted by the backend issuer.
    now = int(time.time())
    messages = await request(keys, claims={"iat": now, "exp": now + lifetime})
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_accepts_token_at_the_five_minute_limit_and_forwards_the_assertion(keys):
    now = int(time.time())
    token = jwt.encode({"sub": "user-1", "iss": "yellowstorm", "aud": "mcp-semantic-model",
        "iat": now, "exp": now + 300}, keys[0], algorithm="RS256")
    from auth import verified_mcp_jwt
    messages = []

    async def assertion_app(scope, receive, send):
        assert verified_mcp_jwt.get() == token
        await app(scope, receive, send)

    middleware = TrustedIdentityMiddleware(assertion_app, "ingress-secret", auth_mode="JWT",
        jwt_public_key=keys[1], jwt_issuer="yellowstorm")

    async def send(message):
        messages.append(message)

    await middleware({"type": "http", "path": "/mcp", "headers": [
        (b"authorization", f"Bearer {token}".encode())]}, lambda: None, send)
    assert messages[0]["status"] == 200
    assert verified_mcp_jwt.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("claims", [
    {"exp": 1}, {"exp": None}, {"exp": []}, {"iss": "other"}, {"aud": "other"},
    {"sub": "invalid user"}, {"sub": None}, {"iat": None},
    {"iat": int(time.time()) + 3600}, {"nbf": int(time.time()) + 3600},
])
async def test_rejects_invalid_claims(keys, claims):
    messages = await request(keys, claims)
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("token", ["ingress-secret", "invalid.jwt.token",
    jwt.encode({"sub": "user-1"}, "s" * 32, algorithm="HS256"),
    jwt.encode({"sub": "user-1"}, "", algorithm="none")])
async def test_jwt_mode_never_falls_back_to_bearer(keys, token):
    assert (await request(keys, token=token))[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_wrong_signature_and_duplicate_authorization(keys):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode({"sub": "user-1", "iss": "yellowstorm", "aud": "mcp-semantic-model",
        "iat": int(time.time()), "exp": int(time.time()) + 300}, other, algorithm="RS256")
    assert (await request(keys, token=token))[0]["status"] == 401
    assert (await request(keys, extra_headers=[(b"authorization", b"Bearer another")]))[0]["status"] == 401


def test_auth_mode_configuration():
    settings = Settings("http://localhost:3000", "internal", "", 120, 8027, 2097152,
        service_token="service-secret", auth_mode="JWT", jwt_public_key_file="public.pem", jwt_issuer="yellowstorm")
    settings.validate()
    for mode in ("invalid", "Bearer"):
        with pytest.raises(ValueError):
            Settings("http://localhost:3000", "internal", "", 120, 8027, 2097152,
                service_token="service-secret", auth_mode=mode).validate()


def test_service_principal_token_is_required():
    # WP07.2: without the scoped secret the backend rejects every assistant
    # call, so startup must fail instead.
    with pytest.raises(ValueError, match="SEMANTIC_MODEL_MCP_SERVICE_TOKEN is required"):
        Settings("http://localhost:3000", "internal", "", 120, 8027, 2097152).validate()


@pytest.fixture
def production_env(monkeypatch):
    # Override local .env values so configuration tests are deployment-independent.
    for key, value in {
        "ENVIRONMENT": "production",
        "YELLOWSTORM_INTERNAL_SERVICE_TOKEN": "internal-test-token",
        "SEMANTIC_MODEL_MCP_AUTH_MODE": "Bearer",
        "SEMANTIC_MODEL_MCP_INGRESS_TOKEN": "ingress-secret",
        "SEMANTIC_MODEL_MCP_SERVICE_TOKEN": "service-secret",
        "SEMANTIC_MODEL_MCP_JWT_PUBLIC_KEY_FILE": "public.pem",
        "SEMANTIC_MODEL_MCP_JWT_ISSUER": "yellowstorm",
        "SEMANTIC_MODEL_MCP_JWT_AUDIENCE": "mcp-semantic-model",
        "YELLOWSTORM_BACKEND_URL": "http://localhost:3000",
        "MCP_PORT": "8027",
        "SEMANTIC_MODEL_MCP_TIMEOUT_SECONDS": "120",
        "SEMANTIC_MODEL_MCP_MAX_RESPONSE_BYTES": "2097152",
    }.items():
        monkeypatch.setenv(key, value)


def test_production_accepts_explicit_bearer_mode(production_env):
    settings = Settings.from_env()
    assert settings.auth_mode == "Bearer"
    settings.validate()


def test_production_bearer_requires_ingress_token(production_env, monkeypatch):
    monkeypatch.delenv("SEMANTIC_MODEL_MCP_INGRESS_TOKEN")
    with pytest.raises(ValueError, match="SEMANTIC_MODEL_MCP_INGRESS_TOKEN is required"):
        Settings.from_env().validate()


def test_production_requires_explicit_env_auth_mode(production_env, monkeypatch):
    monkeypatch.delenv("SEMANTIC_MODEL_MCP_AUTH_MODE")
    with pytest.raises(ValueError, match="SEMANTIC_MODEL_MCP_AUTH_MODE"):
        Settings.from_env()


def test_development_preserves_default_bearer_mode(production_env, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("SEMANTIC_MODEL_MCP_AUTH_MODE")
    settings = Settings.from_env()
    assert settings.auth_mode == "Bearer"
    settings.validate()


@pytest.mark.parametrize("mode", ["", "invalid", "jwt", "bearer"])
def test_production_rejects_invalid_env_modes(production_env, monkeypatch, mode):
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_AUTH_MODE", mode)
    with pytest.raises(ValueError, match="SEMANTIC_MODEL_MCP_AUTH_MODE"):
        Settings.from_env().validate()


def test_production_jwt_does_not_require_ingress_token(production_env, monkeypatch):
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_AUTH_MODE", "JWT")
    monkeypatch.delenv("SEMANTIC_MODEL_MCP_INGRESS_TOKEN")
    settings = Settings.from_env()
    assert settings.auth_mode == "JWT"
    settings.validate()


@pytest.mark.parametrize("key", [
    "SEMANTIC_MODEL_MCP_JWT_PUBLIC_KEY_FILE",
    "SEMANTIC_MODEL_MCP_JWT_ISSUER",
    "SEMANTIC_MODEL_MCP_JWT_AUDIENCE",
])
def test_production_jwt_requires_trust_config_without_fallback(production_env, monkeypatch, key):
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_AUTH_MODE", "JWT")
    monkeypatch.setenv(key, "")
    with pytest.raises(ValueError, match="JWT mode requires"):
        Settings.from_env().validate()


@pytest.mark.parametrize("mode", ["JWT", "Bearer"])
def test_production_requires_service_principal_in_both_modes(production_env, monkeypatch, mode):
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_AUTH_MODE", mode)
    monkeypatch.delenv("SEMANTIC_MODEL_MCP_SERVICE_TOKEN")
    with pytest.raises(ValueError, match="SEMANTIC_MODEL_MCP_SERVICE_TOKEN is required"):
        Settings.from_env().validate()


def test_direct_production_bearer_settings_remain_supported():
    Settings("http://localhost:3000", "internal", "ingress-secret", 120, 8027, 2097152,
        service_token="service-secret", environment="production").validate()
