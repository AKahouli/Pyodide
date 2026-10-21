import os


def pytest_configure() -> None:
    # There is deliberately no ambient Graph token: provider authority comes from
    # the per-request delegated token header (see graph_helpers.get_access_token).
    # Unit tests patch `graph_headers` or set `_delegated_provider_token` instead.
    os.environ.pop("M365_ACCESS_TOKEN", None)
