from __future__ import annotations

import asyncio
import os
import socket
import ssl
import subprocess
import tempfile
import threading
from dataclasses import asdict
from pathlib import Path

import pytest

from app.jobs.dispatcher import OutboxDispatcher
from app.jobs.models import OutboxItem


class OutboxRepo:
    def __init__(self):
        self.item = OutboxItem(
            1, 7, "semantic-model-datasource.discover",
            "semantic-model-datasource.batch", {"taskId": 7}, "",
        )
        self.published = False
        self.released: tuple | None = None
        self.recovered: list[dict] = []

    async def claim_outbox(self, *, claim_owner: str, claim_seconds: int):
        if self.published or self.released:
            return None
        return OutboxItem(**{**asdict(self.item), "claim_owner": claim_owner})

    async def mark_outbox_published(self, outbox_id: int, claim_owner: str) -> bool:
        self.published = True
        return True

    async def release_outbox(self, outbox_id: int, claim_owner: str, error_code: str, retry_seconds: int) -> bool:
        self.released = (outbox_id, error_code, retry_seconds)
        return True

    async def recover_stalled_tasks(self, *, max_attempts: int, retry_seconds: int,
                                    grace_seconds: int, batch: int):
        self.recovered.append({"max_attempts": max_attempts, "retry_seconds": retry_seconds,
                               "grace_seconds": grace_seconds, "batch": batch})
        return {"exhausted": 0, "requeued": 1}


@pytest.mark.asyncio
async def test_dispatches_only_task_reference_then_marks_published(monkeypatch: pytest.MonkeyPatch):
    repo = OutboxRepo()
    calls: list[dict] = []
    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", lambda *a, **kw: calls.append({"args": a, **kw}))
    assert await OutboxDispatcher(repo).dispatch_once() is True
    assert calls[0]["args"] == [7]
    assert calls[0]["queue"] == "semantic-model-datasource.batch"
    assert repo.published is True


@pytest.mark.asyncio
async def test_broker_failure_releases_outbox_without_losing_intent(monkeypatch: pytest.MonkeyPatch):
    repo = OutboxRepo()

    def fail(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise ConnectionError("secret broker details must not be persisted")

    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", fail)
    assert await OutboxDispatcher(repo).dispatch_once() is False
    assert repo.released == (1, "ConnectionError", 5)
    assert repo.published is False


@pytest.mark.asyncio
async def test_dispatcher_survives_repository_failure():
    class FlakyRepo(OutboxRepo):
        def __init__(self):
            super().__init__()
            self.claims = 0

        async def claim_outbox(self, *, claim_owner: str, claim_seconds: int):
            self.claims += 1
            if self.claims == 1:
                raise ConnectionError("database unavailable")
            return None

    repo = FlakyRepo()
    dispatcher = OutboxDispatcher(repo, interval_seconds=0.001)
    await dispatcher.start()
    for _ in range(20):
        if repo.claims >= 2:
            break
        await asyncio.sleep(0.002)
    await dispatcher.stop()
    assert repo.claims >= 2


@pytest.mark.asyncio
async def test_recovery_republishes_expired_leases_each_iteration(monkeypatch: pytest.MonkeyPatch):
    repo = OutboxRepo()
    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", lambda *a, **kw: None)
    dispatcher = OutboxDispatcher(repo, interval_seconds=0.001, max_attempts=4,
                                  retry_seconds=15, grace_seconds=90)
    assert await dispatcher.recover_once() == {"exhausted": 0, "requeued": 1}
    assert repo.recovered == [{"max_attempts": 4, "retry_seconds": 15,
                               "grace_seconds": 90, "batch": 50}]
    await dispatcher.start()
    for _ in range(20):
        if len(repo.recovered) >= 2:
            break
        await asyncio.sleep(0.002)
    await dispatcher.stop()
    # Recovery runs even when the outbox had nothing new to dispatch.
    assert len(repo.recovered) >= 2


@pytest.mark.asyncio
async def test_recovery_is_optional_for_repositories_without_it(monkeypatch: pytest.MonkeyPatch):
    class NoRecoveryRepo(OutboxRepo):
        recover_stalled_tasks = None

    repo = NoRecoveryRepo()
    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", lambda *a, **kw: None)
    assert await OutboxDispatcher(repo).recover_once() == {"exhausted": 0, "requeued": 0}


def test_broker_ssl_verifies_rediss_peers(monkeypatch: pytest.MonkeyPatch):
    import ssl

    from app.workers.celery_app import broker_ssl

    monkeypatch.delenv("SEMANTIC_BROKER_CA_CERTS", raising=False)
    # Non-TLS transports keep their own semantics; rediss:// always verifies.
    assert broker_ssl("amqp://user:pass@host:5672/vhost") is False
    assert broker_ssl("redis://:pass@host:6379/3") is False
    assert broker_ssl("rediss://:pass@host:6380/3") == {"ssl_cert_reqs": ssl.CERT_REQUIRED}
    handle, name = tempfile.mkstemp(prefix="broker-ca-", suffix=".pem")
    os.close(handle)
    bundle = Path(name)
    try:
        bundle.write_text("-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n", encoding="utf-8")
        monkeypatch.setenv("SEMANTIC_BROKER_CA_CERTS", str(bundle))
        assert broker_ssl("rediss://:pass@host:6380/3") == {
            "ssl_cert_reqs": ssl.CERT_REQUIRED, "ssl_ca_certs": str(bundle)}
    finally:
        bundle.unlink(missing_ok=True)
    # A missing bundle fails startup instead of connecting without trust.
    monkeypatch.setenv("SEMANTIC_BROKER_CA_CERTS", str(Path("Z:/definitely/missing/ca.pem")))
    with pytest.raises(RuntimeError):
        broker_ssl("rediss://:pass@host:6380/3")


def _tls_options(options: dict) -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = options["ssl_cert_reqs"]
    if options.get("ssl_ca_certs"):
        context.load_verify_locations(cafile=options["ssl_ca_certs"])
    else:
        context.load_default_certs()
    return context


@pytest.fixture(scope="module")
def broker_tls_fixtures(tmp_path_factory: pytest.TempPathFactory) -> dict:
    """A test CA, a server certificate it signed, and an untrusted self-signed
    certificate, generated once for the TLS handshake cases."""
    openssl = Path("C:/Program Files/Git/usr/bin/openssl.exe")
    if not openssl.is_file():
        pytest.skip("openssl not available for the TLS fixture")
    directory = tmp_path_factory.mktemp("broker-tls")
    def run(*args: str) -> None:
        subprocess.run([str(openssl), *args], check=True, capture_output=True)
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=test-ca", "-keyout", str(directory / "ca.key"),
        "-out", str(directory / "ca.pem"))
    run("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
        "-keyout", str(directory / "server.key"), "-out", str(directory / "server.csr"))
    (directory / "ext.cnf").write_text("subjectAltName=DNS:localhost,IP:127.0.0.1\n", encoding="utf-8")
    run("x509", "-req", "-in", str(directory / "server.csr"),
        "-CA", str(directory / "ca.pem"), "-CAkey", str(directory / "ca.key"),
        "-CAcreateserial", "-extfile", str(directory / "ext.cnf"),
        "-days", "1", "-out", str(directory / "server.pem"))
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=untrusted", "-keyout", str(directory / "rogue.key"),
        "-out", str(directory / "rogue.pem"))
    return {"directory": directory, "chain": directory / "ca.pem"}


def _serve_tls(directory: Path, cert: str, key: str) -> tuple[ssl.SSLSocket, str, int]:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(directory / cert), str(directory / key))
    server = context.wrap_socket(server, server_side=True)
    port = server.getsockname()[1]
    return server, "127.0.0.1", port


def _handshake(options: dict, host: str, port: int) -> bool:
    with socket.create_connection((host, port), timeout=5) as raw:
        with _tls_options(options).wrap_socket(raw, server_hostname="localhost"):
            return True


def test_rediss_config_accepts_a_trusted_ca(broker_tls_fixtures: dict, monkeypatch: pytest.MonkeyPatch):
    from app.workers.celery_app import broker_ssl

    monkeypatch.setenv("SEMANTIC_BROKER_CA_CERTS", str(broker_tls_fixtures["chain"]))
    options = broker_ssl("rediss://:pass@host:6380/3")
    server, host, port = _serve_tls(broker_tls_fixtures["directory"], "server.pem", "server.key")

    def accept():
        try:
            server.accept()
        except Exception:
            pass
    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    try:
        assert _handshake(options, host, port) is True
    finally:
        thread.join(timeout=5)
        server.close()


def test_rediss_config_rejects_an_untrusted_certificate(broker_tls_fixtures: dict, monkeypatch: pytest.MonkeyPatch):
    from app.workers.celery_app import broker_ssl

    monkeypatch.delenv("SEMANTIC_BROKER_CA_CERTS", raising=False)
    options = broker_ssl("rediss://:pass@host:6380/3")
    server, host, port = _serve_tls(broker_tls_fixtures["directory"], "rogue.pem", "rogue.key")

    def accept():
        try:
            server.accept()
        except Exception:
            pass
    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    try:
        with pytest.raises(ssl.SSLError):
            _handshake(options, host, port)
    finally:
        thread.join(timeout=5)
        server.close()
