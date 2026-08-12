from typing import Any


SENSITIVE_KEYS = {
    "authorization", "token", "access_token", "refresh_token", "api_key",
    "apikey", "password", "secret", "cookie", "credential", "private_key",
}


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if str(key).lower() in SENSITIVE_KEYS else redact_sensitive(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    return value
