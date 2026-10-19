"""Transport policy shared by all content-bearing model clients."""
from ipaddress import ip_address
from urllib.parse import urlsplit

import httpx


def validate_model_endpoint(settings):
    def origin(value):
        parsed = urlsplit(value)
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Model endpoint must be an approved URL without credentials, query or fragment")
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        if not 1 <= port <= 65535:
            raise ValueError("Invalid model endpoint port")
        return parsed, (parsed.scheme.lower(), parsed.hostname.lower(), port)

    parsed, destination = origin(settings.LITELLM_BASE_URL or "")
    approved = []
    for value in settings.MODEL_ALLOWED_ORIGINS:
        allowed, identity = origin(value)
        if allowed.path not in ("", "/"):
            raise ValueError("MODEL_ALLOWED_ORIGINS entries must contain only scheme, host and port")
        approved.append(identity)
    if destination not in approved:
        raise ValueError("Model endpoint origin is not approved by MODEL_ALLOWED_ORIGINS")
    if parsed.scheme != "https":
        try:
            loopback = ip_address(parsed.hostname).is_loopback
        except ValueError:
            loopback = parsed.hostname.lower() == "localhost"
        if not (parsed.scheme == "http" and loopback and settings.MODEL_ALLOW_HTTP_LOOPBACK):
            raise ValueError("Model endpoint requires HTTPS with certificate verification")


def model_http_client(settings, *, asynchronous=False, timeout=None):
    validate_model_endpoint(settings)
    client = httpx.AsyncClient if asynchronous else httpx.Client
    # Redirects and environment proxies must not move content to another origin.
    return client(verify=True, follow_redirects=False, trust_env=False, timeout=timeout)
