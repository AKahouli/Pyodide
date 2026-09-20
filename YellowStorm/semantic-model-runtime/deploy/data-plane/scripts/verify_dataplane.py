"""End-to-end data-plane verification (dev stack must be up and provisioned).

Checks: PostgREST denies anonymous reads, serves RLS-scoped JWT reads, and
the provisioned tenant completes a private Broadcast round-trip
(subscribe -> REST broadcast -> receive). Refetch/reconciliation behavior
itself lives in the frontend client (Phase 2C), not here.

Run only through the required environment:
  conda run -n meta python deploy/data-plane/scripts/verify_dataplane.py

Reads secrets from postgrest.env / realtime.env beside the compose file.
Values are never printed. Fails closed when the tenant secret is missing:
run provision_tenant.py first.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import websockets

HERE = Path(__file__).resolve().parent
DATAPLANE = HERE.parent
REPO = DATAPLANE.parent.parent.parent.parent
RT = "http://127.0.0.1:4000"
PGRST = "http://127.0.0.1:3000"
EXTERNAL_ID = "yellowmind-semantic"
TOPIC = "semantic-model:model-verify-1"
# Deterministic fixture UUID so positive AND negative RLS cases are real.
FIXTURE_MODEL_ID = "11111111-1111-1111-1111-111111111111"
FIXTURE_USER = "verify-user-1"
OTHER_USER = "verify-user-2"


def read_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, _, value = line.partition("=")
            out[key] = value
    return out


SECRETS = read_env_file(DATAPLANE / "postgrest.env") | read_env_file(
    DATAPLANE / "realtime.env"
)


def env(key: str) -> str:
    value = SECRETS.get(key, "")
    if not value:
        raise SystemExit(f"missing {key}; run provision_tenant.py first")
    return value


def jwt(secret: str, claims: dict) -> str:
    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(claims).encode())
    sig = b64(
        hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    )
    return f"{header}.{body}.{sig}"


def http(
    method: str,
    url: str,
    token: str = "",
    payload: dict | None = None,
    cap: int = 500,
    host: str = "",
) -> tuple[int, str]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload or {}).encode() if method != "GET" else None,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if host:
        # Realtime routes tenants by Host; TCP stays on loopback.
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()[:cap]
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:cap]


def _loopback_single_label_host() -> None:
    # Realtime routes tenants by Host subdomain. Resolve the single-label
    # tenant host to loopback in-process (no admin hosts-file change).
    import socket as _socket

    real_getaddrinfo = _socket.getaddrinfo

    def fake(host, port, *args, **kwargs):  # type: ignore[no-untyped-def]
        if host == EXTERNAL_ID:
            host = "127.0.0.1"
        return real_getaddrinfo(host, port, *args, **kwargs)

    _socket.getaddrinfo = fake


async def roundtrip(tenant_jwt: str) -> None:
    _loopback_single_label_host()
    async with websockets.connect(
        "ws://" + EXTERNAL_ID + ":4000/socket/websocket?apikey=" + tenant_jwt + "&vsn=2.0.0",
        open_timeout=10,
    ) as ws:
        await ws.send(
            json.dumps(
                [
                    "1",
                    "1",
                    "realtime:" + TOPIC,
                    "phx_join",
                    {
                        "access_token": tenant_jwt,
                        "config": {
                            "broadcast": {"ack": True, "self": True},
                            "private": True,
                        },
                    },
                ]
            )
        )
        reply = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert reply[3] == "phx_reply" and reply[4].get("status") == "ok", "join rejected"
        print("ws-join-ok")
        status, _ = http(
            "POST",
            RT + "/api/broadcast",
            tenant_jwt,
            {
                "messages": [
                    {
                        "topic": TOPIC,
                        "event": "data-revision-changed",
                        "payload": {"modelId": "model-verify-1", "dataRevision": 42},
                        "private": True,
                    }
                ]
            },
            host=EXTERNAL_ID,
        )
        assert status == 202, status
        print("broadcast-accepted")
        for _ in range(10):
            frame = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if frame[2].endswith(TOPIC) and frame[3] == "broadcast":
                assert frame[4].get("event") == "data-revision-changed", "wrong event"
                print("broadcast-received")
                return
        raise SystemExit("broadcast not received")


def user_jwt(sub: str, model_id: str) -> str:
    return jwt(
        env("PGRST_JWT_SECRET"),
        {
            "role": "semantic_api_user",
            "sub": sub,
            "model_id": model_id,
            "exp": int(time.time()) + 300,
        },
    )


async def seed_fixture() -> bool:
    """Atomically acquire the fixture. Returns True only when this run inserted it."""
    import asyncpg

    con = await asyncio.wait_for(asyncpg.connect(_runtime_url(), command_timeout=10), 20)
    try:
        async with con.transaction():
            row = await con.fetchrow(
                "INSERT INTO semantic_model.models (id, owner_user_id, name, kind) "
                "VALUES ($1::uuid, $2, 'verify-fixture', 'designed') "
                "ON CONFLICT (id) DO NOTHING RETURNING id",
                FIXTURE_MODEL_ID,
                FIXTURE_USER,
            )
            if row is None:
                raise SystemExit("fixture ID contested; refusing to overwrite it")
            await con.execute(
                "DELETE FROM semantic_model.memberships WHERE model_id = $1::uuid AND user_id = $2",
                FIXTURE_MODEL_ID,
                FIXTURE_USER,
            )
            await con.execute(
                "INSERT INTO semantic_model.memberships (model_id, user_id, role) "
                "VALUES ($1::uuid, $2, 'editor')",
                FIXTURE_MODEL_ID,
                FIXTURE_USER,
            )
        return True
    finally:
        await con.close()


def _runtime_url() -> str:
    for line in (REPO / "YellowStorm/back/.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SEMANTIC_RUNTIME_DATABASE_URL="):
            return line.split("=", 1)[1]
    raise SystemExit("SEMANTIC_RUNTIME_DATABASE_URL missing in back/.env")


async def drop_fixture() -> None:
    import asyncpg

    con = await asyncio.wait_for(asyncpg.connect(_runtime_url(), command_timeout=10), 20)
    try:
        # Delete only rows this script can have created: fixture name + user.
        await con.execute(
            "DELETE FROM semantic_model.memberships WHERE model_id = $1::uuid AND user_id = $2",
            FIXTURE_MODEL_ID,
            FIXTURE_USER,
        )
        await con.execute(
            "DELETE FROM semantic_model.models WHERE id = $1::uuid AND name = 'verify-fixture' AND owner_user_id = $2",
            FIXTURE_MODEL_ID,
            FIXTURE_USER,
        )
    finally:
        await con.close()


async def main() -> None:
    status, _ = http("GET", PGRST + "/model_summary")
    assert status in (401, 403), status
    print("postgrest-anon-denied")
    import asyncpg as _asyncpg

    _probe = await asyncio.wait_for(
        _asyncpg.connect(_runtime_url(), command_timeout=10), 20
    )
    try:
        _taken = await _probe.fetchval(
            "SELECT 1 FROM semantic_model.models WHERE id = $1::uuid", FIXTURE_MODEL_ID
        )
    finally:
        await _probe.close()
    if _taken:
        raise SystemExit("fixture model ID already present; refusing to overwrite it")
    seeded = False
    try:
        seeded = await seed_fixture()
        status, body = http(
            "GET", PGRST + "/model_summary", user_jwt(FIXTURE_USER, FIXTURE_MODEL_ID)
        )
        assert status == 200 and FIXTURE_MODEL_ID in body, (status, body)
        print("postgrest-rls-authorized-visible")
        status, body = http(
            "GET", PGRST + "/model_summary", user_jwt(OTHER_USER, FIXTURE_MODEL_ID)
        )
        assert status == 200 and body.strip() == "[]", (status, body)
        print("postgrest-rls-cross-user-denied")
        status, body = http(
            "GET",
            PGRST + "/model_summary",
            user_jwt(FIXTURE_USER, "22222222-2222-2222-2222-222222222222"),
        )
        assert status == 200 and body.strip() == "[]", (status, body)
        print("postgrest-rls-forged-model-denied")
    finally:
        if seeded:
            await drop_fixture()
    tenant_jwt = jwt(
        env("REALTIME_TENANT_JWT_SECRET"),
        {"role": "authenticated", "model_id": "model-verify-1", "exp": int(time.time()) + 300},
    )
    await roundtrip(tenant_jwt)
    # Negative: a token bound to model A cannot join model B's topic.
    _loopback_single_label_host()
    async with websockets.connect(
        "ws://" + EXTERNAL_ID + ":4000/socket/websocket?apikey=" + tenant_jwt + "&vsn=2.0.0",
        open_timeout=10,
    ) as ws:
        await ws.send(
            json.dumps(
                [
                    "2",
                    "2",
                    "realtime:semantic-model:model-other",
                    "phx_join",
                    {
                        "access_token": tenant_jwt,
                        "config": {
                            "broadcast": {"ack": True, "self": True},
                            "private": True,
                        },
                    },
                ]
            )
        )
        reply = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert reply[3] == "phx_reply" and reply[4].get("status") == "error", reply
        print("cross-model-join-denied")
    print("VERIFY-OK")


asyncio.run(main())
