"""Unit tests for gRPC security config — secure by default (fail-closed)."""

from types import SimpleNamespace

import grpc
import pytest

from src.grpc_server.credentials import build_server_credentials, resolve_api_key


def _settings(**overrides):
    base = dict(
        GRPC_API_KEY="topsecret",
        GRPC_TLS_CERT_PATH=None,
        GRPC_TLS_KEY_PATH=None,
        GRPC_ALLOW_INSECURE=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _cert_key(tmp_path):
    key = tmp_path / "server.key"
    cert = tmp_path / "server.crt"
    key.write_bytes(b"-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n")
    cert.write_bytes(b"-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n")
    return str(cert), str(key)


# --- build_server_credentials -------------------------------------------------

def test_secure_default_with_valid_files_returns_credentials(tmp_path):
    cert, key = _cert_key(tmp_path)
    creds = build_server_credentials(
        _settings(GRPC_TLS_CERT_PATH=cert, GRPC_TLS_KEY_PATH=key)
    )
    assert isinstance(creds, grpc.ServerCredentials)


def test_secure_default_missing_cert_raises():
    # No cert/key set and not allowing insecure -> fail-closed.
    with pytest.raises(ValueError, match="GRPC_TLS_KEY_PATH"):
        build_server_credentials(_settings())


def test_secure_default_unreadable_file_raises(tmp_path):
    missing = str(tmp_path / "nope.pem")
    with pytest.raises(ValueError, match="Cannot read"):
        build_server_credentials(
            _settings(GRPC_TLS_CERT_PATH=missing, GRPC_TLS_KEY_PATH=missing)
        )


def test_allow_insecure_returns_none():
    assert build_server_credentials(_settings(GRPC_ALLOW_INSECURE=True)) is None


# --- resolve_api_key ----------------------------------------------------------

def test_api_key_required_by_default():
    assert resolve_api_key(_settings(GRPC_API_KEY="topsecret")) == "topsecret"


def test_missing_api_key_raises():
    with pytest.raises(ValueError, match="GRPC_API_KEY"):
        resolve_api_key(_settings(GRPC_API_KEY=None))


def test_allow_insecure_skips_api_key():
    assert resolve_api_key(_settings(GRPC_API_KEY=None, GRPC_ALLOW_INSECURE=True)) is None
