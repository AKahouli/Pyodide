"""Idempotent dev tenant provisioning + broadcast namespace policy.

Creates/updates the yellowmind-semantic Realtime tenant (Broadcast-only R1:
the extension record targets the isolated control DB, never agentstore) and
applies the RLS namespace policy on the control plane's realtime.messages.

Run only through the required environment:
  conda run -n meta python deploy/data-plane/scripts/provision_tenant.py

Env (values never printed):
  REALTIME_API_JWT_SECRET    management secret (realtime.env)
  REALTIME_TENANT_JWT_SECRET stable tenant secret (realtime.env; generate once)
  REALTIME_DB_PASSWORD       control-DB password for the extension record
  REALTIME_URL               default http://127.0.0.1:4000
  REALTIME_HOST              Host header tenant routing, default yellowmind-semantic

The namespace policy restricts the dev control plane to semantic-model topics.
Per-model scoping is enforced at token issuance until the NestJS bridge lands
claim-based channel policy.
"""

import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATAPLANE = HERE.parent
EXTERNAL_ID = "yellowmind-semantic"

# Realtime sets request.jwt.claims (full claims JSON) for every RLS probe, so the
# policy binds the topic to the caller's model_id claim for both subscribing
# (read probe) and publishing (write probe). Publisher tokens minted by the
# NestJS bridge carry the same model_id claim as subscriber tokens.
POLICY_SQL = """DO $$
BEGIN
  DROP POLICY IF EXISTS semantic_dev_broadcast ON realtime.messages;
  CREATE POLICY semantic_dev_broadcast ON realtime.messages
    FOR ALL TO authenticated
    USING (
      topic LIKE 'semantic-model:%'
      AND topic = 'semantic-model:' || ((current_setting('request.jwt.claims', true)::json) ->> 'model_id')
    )
    WITH CHECK (
      topic LIKE 'semantic-model:%'
      AND topic = 'semantic-model:' || ((current_setting('request.jwt.claims', true)::json) ->> 'model_id')
    );
END $$;
"""


def read_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, _, value = line.partition("=")
            out[key] = value
    return out


def jwt(secret: str, claims: dict) -> str:
    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(claims).encode())
    sig = b64(
        hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    )
    return f"{header}.{body}.{sig}"


def main() -> None:
    secrets = read_env_file(DATAPLANE / "realtime.env")
    base = os.environ.get("REALTIME_URL", "http://127.0.0.1:4000")
    host = os.environ.get("REALTIME_HOST", EXTERNAL_ID)
    for key in (
        "REALTIME_API_JWT_SECRET",
        "REALTIME_TENANT_JWT_SECRET",
        "REALTIME_DB_PASSWORD",
    ):
        if not secrets.get(key):
            raise SystemExit(f"missing {key} in realtime.env")
    mgmt = jwt(secrets["REALTIME_API_JWT_SECRET"], {"exp": int(time.time()) + 300})
    payload = {
        "tenant": {
            "name": EXTERNAL_ID,
            "external_id": EXTERNAL_ID,
            "jwt_secret": secrets["REALTIME_TENANT_JWT_SECRET"],
            "extensions": [
                {
                    "type": "postgres_cdc_rls",
                    "settings": {
                        "db_host": "realtime-db",
                        "db_name": "realtime",
                        "db_user": "supabase_admin",
                        "db_password": secrets["REALTIME_DB_PASSWORD"],
                        "db_port": "5432",
                        "region": "dev",
                        "ssl_enforced": False,
                    },
                }
            ],
        }
    }
    req = urllib.request.Request(
        base + "/api/tenants",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    req.add_header("Authorization", "Bearer " + mgmt)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            assert resp.status in (200, 201), resp.status
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"tenant provisioning failed: {exc.code}") from exc
    print("tenant=" + EXTERNAL_ID)
    # Local-trust psql inside the control container: no password on any wire.
    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            "semantic-data-plane-realtime-db-1",
            "psql",
            "-U",
            "supabase_admin",
            "-d",
            "realtime",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            POLICY_SQL,
        ],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(Path.cwd()),
    )
    print("namespace-policy=semantic_dev_broadcast")
    print("PROVISION-OK")


main()
