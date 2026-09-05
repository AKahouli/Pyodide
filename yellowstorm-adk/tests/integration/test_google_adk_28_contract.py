"""Authoritative Google ADK 2.8 upgrade contract test.

Imports the installed SDK without mocking it and pins the public APIs
Yellowmind relies on. Also guards against a local stub package (formerly
``yellowstorm-adk/src/google/adk``) shadowing the real SDK when pytest
inserts ``src/`` at the front of ``sys.path``.

When upgrading ADK again, this test is the deliberate checkpoint: update
the pinned version and re-verify every assertion below.
"""

import google.adk


def test_installed_google_adk_is_real_sdk():
    assert google.adk.__version__ == "2.8.0"
    # Must resolve to the installed package, never a vendored stub.
    assert "site-packages" in str(google.adk.__file__)
    assert "src/google/adk" not in str(google.adk.__file__).replace("\\", "/")


def test_session_service_exposes_public_prepare_tables():
    from google.adk.sessions import DatabaseSessionService

    assert hasattr(DatabaseSessionService, "prepare_tables")
    assert not hasattr(DatabaseSessionService, "_prepare_tables")


def test_lite_llm_streaming_api_present():
    from google.adk.models.lite_llm import LiteLlm

    assert hasattr(LiteLlm, "generate_content_async")


def test_streamable_http_connection_params_available():
    from google.adk.tools.mcp_tool.mcp_toolset import StreamableHTTPConnectionParams

    params = StreamableHTTPConnectionParams(url="https://example.com/mcp")
    assert params.url == "https://example.com/mcp"
