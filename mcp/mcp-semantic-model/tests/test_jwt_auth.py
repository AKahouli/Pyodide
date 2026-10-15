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
    middleware = TrustedIdentityMiddleware(app, "ingress-secret", auth_mode="JWT",
        jwt_public_key=keys[1], jwt_issuer="yellowstorm")

    async def send(message):
        messages.append(message)

    await middleware({"type": "http", "path": "/mcp", "headers": [
        (b"authorization", f"Bearer {token}".encode())]}, lambda: None, send)
    assert messages[0]["status"] == 200
    assert verified_mcp_jwt.get() == token


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
        auth_mode="JWT", jwt_public_key_file="public.pem", jwt_issuer="yellowstorm")
    settings.validate()
    for mode in ("invalid", "Bearer"):
        with pytest.raises(ValueError):
            Settings("http://localhost:3000", "internal", "", 120, 8027, 2097152, auth_mode=mode).validate()


def test_production_requires_jwt_mode():
    # WP06.1: a production deployment must fail startup instead of silently
    # running the developer-only shared bearer token.
    with pytest.raises(ValueError, match="must be JWT in production"):
        Settings("http://localhost:3000", "internal", "", 120, 8027, 2097152,
            auth_mode="Bearer", environment="production").validate()
    jwt_settings = Settings("http://localhost:3000", "internal", "", 120, 8027, 2097152,
        auth_mode="JWT", jwt_public_key_file="public.pem", jwt_issuer="yellowstorm",
        environment="production")
    jwt_settings.validate()
