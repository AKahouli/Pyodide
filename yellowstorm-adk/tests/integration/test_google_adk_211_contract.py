"""Authoritative Google ADK 2.11 upgrade contract test.

Imports the installed SDK without mocking it and pins the public APIs
YellowStorm relies on. Also guards against a local stub package (formerly
``yellowstorm-adk/src/google/adk``) shadowing the real SDK when pytest
inserts ``src/`` at the front of ``sys.path``.

When upgrading ADK again, this test is the deliberate checkpoint: update
the pinned version and re-verify every assertion below.
"""

import google.adk


def test_installed_google_adk_is_real_sdk():
    assert google.adk.__version__ == "2.11.0"
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


def test_root_delegation_public_apis_present():
    """ADK 2.11 surface the root-delegation runtime builds on (WP00)."""
    import inspect

    from google.adk.agents.context import Context
    from google.adk.agents.llm_agent import LlmAgent
    from google.adk.apps import App
    from google.adk.apps._configs import ResumabilityConfig
    from google.adk.runners import Runner
    from google.adk.workflow import Workflow

    # Dynamic child execution with deterministic run IDs / isolated branches.
    sig = inspect.signature(Context.run_node)
    for param in ("node", "node_input", "run_id", "use_sub_branch", "raise_on_wait"):
        assert param in sig.parameters, param

    # Replayable dynamic parent + bounded concurrency on the Workflow itself.
    wf_fields = Workflow.model_fields
    assert wf_fields["rerun_on_resume"].default is True
    assert "max_concurrency" in wf_fields

    # Explicit App with resumability for durable/recoverable runs.
    from google.adk.agents.llm_agent import LlmAgent as _LA

    app = App(name="a", root_agent=_LA(name="x", model="m"),
              resumability_config=ResumabilityConfig(is_resumable=True))
    assert app.resumability_config.is_resumable is True
    assert "app" in inspect.signature(Runner.__init__).parameters

    # Explicit cancellation and single-turn workers.
    assert "abort_signal" in inspect.signature(Runner.run_async).parameters
    mode = LlmAgent.model_fields["mode"]
    assert "single_turn" in str(mode.default) or "single_turn" in str(mode.annotation)

    # Non-agent nodes (Workflows) placed in LlmAgent.tools are converted to
    # tools by ADK itself — the supported node-as-tool bridge.
    from google.adk.agents import llm_agent as la

    assert hasattr(la, "_wrap_base_node_as_tool")
