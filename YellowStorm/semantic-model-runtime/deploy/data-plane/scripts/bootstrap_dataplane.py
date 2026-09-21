"""One-shot data-plane bootstrap (platform engineer only).

Creates runtime-owned roles/schemas in agentstore, installs pgcrypto, applies
the definitions shell (000 file minus its AGE section) plus the durable-jobs
migration as the owner role, and prepares the AGE instance role + graph.

Run only through the required environment:
  conda run -n meta python deploy/data-plane/scripts/bootstrap_dataplane.py

Env (all required, values never printed):
  BOOT_SU_AGENTSTORE  transient superuser URL for agentstore (never stored)
  BOOT_SU_AGEGRAPH    transient superuser URL for the AGE instance
  SEM_APP_PW          dedicated semantic_app password (operator-generated)
  SEM_AUTH_PW         dedicated PostgREST authenticator password
  SEM_AGE_PW          dedicated semantic_age_app password
  DEFINITIONS_SQL     path to back/scripts/semantic-model/000_deploy_all.sql
  RUNTIME_MIGRATION   path to any file in semantic-model-runtime/migrations
  CURATED_SQL         path to deploy/data-plane/sql/001_curated_api.sql

Idempotent: reruns only rotate the dedicated passwords and re-apply DDL.
Curated reads (semantic_api, RLS, view) are owned by sql/001_curated_api.sql,
applied separately as semantic_app.
"""

import asyncio
import os
from pathlib import Path

import asyncpg

SCHEMAS = [
    "semantic_model",
    "semantic_jobs",
    "semantic_runtime",
    "semantic_datasource",
    "semantic_population",
    "semantic_search",
    "semantic_api",
    "semantic_access",
]


def _lit(password: str) -> str:
    # Utility statements (CREATE/ALTER ROLE) accept no bind parameters.
    # Operator-generated alphabet is token_urlsafe; refuse anything else.
    if not password or not all(
        c.isascii() and (c.isalnum() or c in "-_") for c in password
    ):
        raise SystemExit("password has unexpected characters; aborting")
    return "'" + password + "'"


def split_definitions(sql: str) -> tuple[str, str]:
    start_marker = "-- 002 —"
    end_marker = "-- 003 —"
    start = sql.find(start_marker)
    end = sql.find(end_marker)
    if start < 0 or end < 0 or end <= start:
        raise SystemExit("definitions split markers not found; refusing to guess")
    age_section = sql[start:end]
    if "LOAD 'age'" not in age_section or "create_graph" not in age_section:
        raise SystemExit("AGE section content unexpected; refusing to guess")
    return sql[:start] + sql[end:], age_section


async def bootstrap_agentstore(url: str, definitions: str, runtime_migrations: str) -> None:
    app_pw = os.environ["SEM_APP_PW"]
    auth_pw = os.environ["SEM_AUTH_PW"]
    con = await asyncio.wait_for(asyncpg.connect(url, command_timeout=30), 30)
    try:
        await con.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        for role, login, pw in (
            ("semantic_app", True, app_pw),
            ("semantic_postgrest_auth", True, auth_pw),
            ("semantic_api_user", False, None),
            ("semantic_api_anon", False, None),
        ):
            exists = await con.fetchval(
                "SELECT 1 FROM pg_roles WHERE rolname = $1", role
            )
            if exists:
                if login and pw:
                    await con.execute(
                        f'ALTER ROLE "{role}" WITH LOGIN PASSWORD {_lit(pw)}'
                    )
                continue
            if login:
                await con.execute(
                    f'CREATE ROLE "{role}" WITH LOGIN NOINHERIT PASSWORD {_lit(pw)}'
                )
            else:
                await con.execute(f'CREATE ROLE "{role}" WITH NOLOGIN')
        await con.execute(
            'GRANT "semantic_api_user", "semantic_api_anon" '
            'TO "semantic_postgrest_auth"'
        )
        dbname = await con.fetchval("SELECT current_database()")
        # Owner role needs database-level CREATE for schema/table DDL run as itself.
        await con.execute(
            f'GRANT CREATE, TEMPORARY ON DATABASE "{dbname}" TO "semantic_app"'
        )
        for schema in SCHEMAS:
            await con.execute(
                f'CREATE SCHEMA IF NOT EXISTS "{schema}" AUTHORIZATION "semantic_app"'
            )
            await con.execute(f'REVOKE ALL ON SCHEMA "{schema}" FROM PUBLIC')
        await con.execute('GRANT USAGE ON SCHEMA "semantic_api" TO "semantic_api_user"')
        await con.execute(
            'ALTER DEFAULT PRIVILEGES FOR ROLE "semantic_app" '
            'IN SCHEMA "semantic_api" GRANT SELECT ON TABLES TO "semantic_api_user"'
        )
        # DDL as the owner role so nothing stays superuser-owned.
        curated = Path(os.environ["CURATED_SQL"]).read_text(encoding="utf-8")
        await con.execute('SET ROLE "semantic_app"')
        try:
            await con.execute(definitions)
            await con.execute(runtime_migrations)
            await con.execute(curated)
        finally:
            await con.execute("RESET ROLE")
        for schema, label in (("semantic_model", "definitions"), ("semantic_jobs", "jobs")):
            print(
                f"agentstore: {label} tables="
                + str(
                    await con.fetchval(
                        "SELECT count(*) FROM pg_tables WHERE schemaname = $1", schema
                    )
                )
            )
    finally:
        await con.close()


async def bootstrap_agegraph(url: str, age_section: str) -> None:
    age_pw = os.environ["SEM_AGE_PW"]
    con = await asyncio.wait_for(asyncpg.connect(url, command_timeout=30), 30)
    try:
        exists = await con.fetchval(
            "SELECT 1 FROM pg_roles WHERE rolname = 'semantic_age_app'"
        )
        if exists:
            await con.execute(
                f'ALTER ROLE "semantic_age_app" WITH LOGIN PASSWORD {_lit(age_pw)}'
            )
        else:
            await con.execute(
                f'CREATE ROLE "semantic_age_app" WITH LOGIN PASSWORD {_lit(age_pw)}'
            )
        await con.execute(
            'GRANT USAGE, CREATE ON SCHEMA "ag_catalog" TO "semantic_age_app"'
        )
        await con.execute(
            'GRANT SELECT ON TABLE "ag_catalog"."ag_graph", '
            '"ag_catalog"."ag_label" TO "semantic_age_app"'
        )
        age_db = await con.fetchval("SELECT current_database()")
        await con.execute(
            f'GRANT CREATE, TEMPORARY ON DATABASE "{age_db}" TO "semantic_age_app"'
        )
        # LOAD/SET survive the role switch; graph objects are owner-created.
        preload = "\n".join(
            line
            for line in age_section.splitlines()
            if line.strip().upper().startswith(("LOAD", "SET "))
        )
        rest = "\n".join(
            line
            for line in age_section.splitlines()
            if not line.strip().upper().startswith(("LOAD", "SET "))
        )
        await con.execute(preload)
        await con.execute('SET ROLE "semantic_age_app"')
        try:
            await con.execute(rest)
        finally:
            await con.execute("RESET ROLE")
        print(
            "agegraph: graphs="
            + str(await con.fetchval("SELECT count(*) FROM ag_catalog.ag_graph"))
        )
    finally:
        await con.close()


async def main() -> None:
    full = Path(os.environ["DEFINITIONS_SQL"]).read_text(encoding="utf-8")
    definitions, age_section = split_definitions(full)
    migration_dir = Path(os.environ["RUNTIME_MIGRATION"]).parent
    runtime_migrations = "\n".join(
        path.read_text(encoding="utf-8") for path in sorted(migration_dir.glob("*.sql"))
    )
    if not runtime_migrations:
        raise SystemExit("no runtime migrations found")
    await bootstrap_agentstore(
        os.environ["BOOT_SU_AGENTSTORE"], definitions, runtime_migrations
    )
    await bootstrap_agegraph(os.environ["BOOT_SU_AGEGRAPH"], age_section)
    print("BOOTSTRAP-OK")


asyncio.run(main())
