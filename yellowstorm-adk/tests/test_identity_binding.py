"""P05 trusted-identity propagation: the endpoint must see the post-auth binding.

Regression for the review finding that sync generator dependencies run in a
threadpool COPY of the request context — their contextvar bindings never reached
the endpoint. These tests fail if get_current_user is converted back to a sync
generator, or if any middleware re-introduces a pre-auth `user` header bind.
"""

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from structlog.contextvars import get_contextvars

from src.authentification.get_current_user import get_current_user, get_current_user_optional
from src.config.settings import get_settings
from src.middleware.correlation import CorrelationIdMiddleware, get_user


@pytest.fixture()
def client(monkeypatch):
    # The dependency reads the module-level `app_settings` captured at import time — in the
    # full suite other tests replace the cached settings instance, so patch THAT object,
    # not whatever get_settings() returns now. Direct assign + restore: some tests reassign
    # the attribute without restoring it.
    import src.authentification.get_current_user as auth_module

    settings = auth_module.app_settings
    saved_key = settings.ADK_API_KEY
    settings.ADK_API_KEY = "test-key"

    from src.logger.setup_logging import setup_logging

    setup_logging(log_level="WARNING")

    app = FastAPI()
    app.add_middleware(CorrelationIdMiddleware)

    @app.get("/whoami", dependencies=[Depends(get_current_user)])
    async def whoami():
        return {"user": get_user(), "bound": get_contextvars().get("username")}

    @app.get("/optional-whoami", dependencies=[Depends(get_current_user_optional)])
    async def optional_whoami():
        return {"user": get_user(), "bound": get_contextvars().get("username")}

    try:
        with TestClient(app, raise_server_exceptions=True) as test_client:
            yield test_client
    finally:
        settings.ADK_API_KEY = saved_key


def test_authenticated_request_binds_identity_in_endpoint_context(client):
    response = client.get(
        "/whoami",
        headers={"x-api-key": "test-key", "user": "alice@example.com"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"] == "alice@example.com"
    assert body["bound"] == "alice@example.com"


def test_unauthenticated_request_binds_no_identity(client):
    response = client.get("/whoami", headers={"user": "attacker"})
    assert response.status_code == 401


def test_optional_dependency_binds_identity_only_with_valid_key(client):
    ok = client.get(
        "/optional-whoami",
        headers={"x-api-key": "test-key", "user": "bob@example.com"},
    )
    assert ok.status_code == 200
    assert ok.json()["user"] == "bob@example.com"

    anonymous = client.get("/optional-whoami", headers={"user": "attacker"})
    assert anonymous.status_code == 200
    assert anonymous.json()["user"] == "unknown"
    assert not anonymous.json()["bound"]
