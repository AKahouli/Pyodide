import os


def pytest_configure() -> None:
    # Unit tests mock Graph calls but still build the real Authorization header.
    os.environ.setdefault("M365_ACCESS_TOKEN", "test-provider-token")
