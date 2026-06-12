"""API key generation and verification for published A2A agents.

Keys are shown to the user once at publish/rotate time and stored only as a
SHA-256 hash. The key carries a non-secret prefix so the UI can display which
key is active without revealing it.
"""

import hashlib
import hmac
import secrets

KEY_PREFIX = "a2a_"


def generate_api_key() -> tuple[str, str, str]:
    """Return ``(plaintext_key, prefix, sha256_hash)``.

    The plaintext is returned to the caller exactly once; persist only the
    prefix and hash.
    """
    plaintext = KEY_PREFIX + secrets.token_urlsafe(32)
    return plaintext, plaintext[: len(KEY_PREFIX) + 8], hash_api_key(plaintext)


def hash_api_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def verify_api_key(plaintext: str, expected_hash: str) -> bool:
    if not plaintext or not expected_hash:
        return False
    return hmac.compare_digest(hash_api_key(plaintext), expected_hash)
