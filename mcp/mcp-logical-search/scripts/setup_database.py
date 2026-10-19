"""One-time database verification and missing-index repair; never run at startup.

python -m scripts.setup_database          # read-only catalog check and plan
python -m scripts.setup_database --apply  # install missing extensions/indexes

The ingestion project owns tables, columns, data and triggers. This command
reports incompatible schema/index definitions and never drops or rebuilds them.
"""
import argparse
import json
from pathlib import Path
import re

from sqlalchemy import create_engine, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import make_url

from src.config.settings import get_settings
from src.db.models import LogicalDocument, LogicalSection, LogicalBlock, LogicalImage, LogicalTextPosition
from src.mcp_server.search_scope import filename_tokens_expression, filename_issuer_expression

MODELS = (LogicalDocument, LogicalSection, LogicalBlock, LogicalImage, LogicalTextPosition)
EXTENSIONS = ("vector", "pg_search")


def inspect_catalog(connection, schema):
    params = {"schema": schema, "tables": [model.__tablename__ for model in MODELS]}
    queries = {
        "extensions": "SELECT extname AS name, extversion AS version FROM pg_extension WHERE extname IN ('vector','pg_search')",
        "available_extensions": "SELECT name FROM pg_available_extensions WHERE name IN ('vector','pg_search')",
        "tables": "SELECT c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=:schema AND c.relname=ANY(:tables) AND c.relkind IN ('r','p')",
        "columns": """SELECT c.relname AS table_name,a.attname AS name,
            format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null, col.collname AS collation
            FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            LEFT JOIN pg_collation col ON col.oid=a.attcollation
            WHERE n.nspname=:schema AND c.relname=ANY(:tables) AND a.attnum>0 AND NOT a.attisdropped""",
        "primary_keys": """SELECT c.relname AS table_name,
            ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(num,pos)
                JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.num ORDER BY u.pos) AS columns
            FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE k.contype='p' AND n.nspname=:schema AND c.relname=ANY(:tables)""",
        "indexes": """SELECT t.relname AS table_name,x.relname AS name,a.amname AS method,
            i.indisvalid AS valid,i.indisready AS ready,i.indpred IS NOT NULL AS partial,
            x.reloptions AS options,
            ARRAY(SELECT op.opcname FROM unnest(i.indclass::oid[]) WITH ORDINALITY u(oid,pos)
                JOIN pg_opclass op ON op.oid=u.oid ORDER BY u.pos) AS opclasses,
            ARRAY(SELECT col.collname FROM unnest(i.indcollation::oid[]) WITH ORDINALITY u(oid,pos)
                LEFT JOIN pg_collation col ON col.oid=u.oid ORDER BY u.pos) AS collations,
            ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k) AS keys
            FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am a ON a.oid=x.relam
            WHERE n.nspname=:schema AND t.relname=ANY(:tables)""",
        "triggers": """SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled
            FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE NOT t.tgisinternal AND n.nspname=:schema AND c.relname=ANY(:tables)""",
    }
    return {name: [dict(row) for row in connection.execute(text(sql), params).mappings()]
            for name, sql in queries.items()}


def schema_issues(catalog, dimension):
    issues = []
    tables = {row["name"] for row in catalog["tables"]}
    columns = {(row["table_name"], row["name"]): row for row in catalog["columns"]}
    primary_keys = {row["table_name"]: row["columns"] for row in catalog["primary_keys"]}
    for model in MODELS:
        table = model.__tablename__
        if table not in tables:
            issues.append(f"Ingestion migration required: missing table {table}.")
            continue
        if primary_keys.get(table) != ["id"]:
            issues.append(f"Ingestion migration required: {table} must have primary key (id).")
        for column in model.__table__.columns:
            actual = columns.get((table, column.name))
            if actual is None:
                issues.append(f"Ingestion migration required: missing column {table}.{column.name}.")
            elif column.name in {"embedding", "image_embedding", "file_name_embedding"} and actual["type"] != f"halfvec({dimension})":
                issues.append(f"Ingestion migration required: {table}.{column.name} must be halfvec({dimension}).")
        if table in {"logical_sections", "logical_blocks"}:
            workspace = columns.get((table, "workspace_id"))
            if workspace and not workspace["not_null"]:
                issues.append(f"Ingestion migration required: {table}.workspace_id must be NOT NULL.")
    for trigger in catalog["triggers"]:
        if trigger["enabled"] == "D":
            issues.append(f"Ingestion review required: disabled trigger {trigger['table_name']}.{trigger['name']}.")
    return issues


def index_specs(schema, catalog):
    dialect = postgresql.dialect()
    dialect._backslash_escapes = False  # DDL requires standard_conforming_strings=on.
    quote = dialect.identifier_preparer.quote
    specs = []
    column_collations = {(row["table_name"], row["name"]): row["collation"] for row in catalog["columns"]}

    def add(name, table, keys, method="btree", owner="shared-ingestion", options=None):
        sql = f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {quote(name)} ON {quote(schema)}.{quote(table)} USING {method} ({', '.join(keys)})"
        if options:
            values = ", ".join(key + "='" + value.replace("'", "''") + "'" for key, value in options.items())
            sql += f" WITH ({values})"
        specs.append({"name": name, "table_name": table, "keys": keys, "method": method,
                      "owner": owner, "options": options or {}, "sql": sql,
                      "collations": ["C" if 'COLLATE "C"' in key else column_collations.get(
                          (table, "file_name" if "regexp_" in key else key.split()[0])) for key in keys]})

    for table, suffix, keys in (
        ("logical_documents", "workspace_file_id", ["workspace_id", "file_name", "id"]),
        ("logical_documents", "file_name", ["file_name"]),
        ("logical_documents", "user_workspace_file", ["user_id", "workspace_id", "file_name"]),
        ("logical_sections", "workspace_doc", ["workspace_id", "document_id"]),
        ("logical_sections", "doc_section", ["document_id", "section_id"]),
        ("logical_blocks", "workspace_doc", ["workspace_id", "document_id"]),
        ("logical_blocks", "doc_section_id", ["document_id", "section_id", "id"]),
        ("logical_blocks", "block_id", ["block_id"]),
        ("logical_images", "doc_section", ["document_id", "section_id"]),
        ("logical_text_positions", "doc_block", ["document_id", "block_id"]),
        ("logical_text_positions", "doc_section_page", ["document_id", "section_id", "page_number"]),
    ):
        add("idx_" + table + "_" + suffix, table, keys)
    for table in ("logical_sections", "logical_blocks", "logical_images"):
        vector_column = "image_embedding" if table == "logical_images" else "embedding"
        add("idx_" + table + "_embedding", table, [vector_column + " halfvec_cosine_ops"], "hnsw",
            options={"m": "16", "ef_construction": "64"})
    for table, field in (("logical_sections", "title"), ("logical_blocks", "content")):
        add("idx_" + table + "_tsv", table, [field + "_tsv"], "gin")
        fields = {field + "_" + language: {"column": field,
            "tokenizer": {"type": "default", "stemmer": language.title()}}
            for language in ("english", "french")}
        fields["section_id"] = {"tokenizer": {"type": "raw"}}
        keys = ["id", field, "document_id", "section_id", "page_number"]
        if table == "logical_blocks":
            fields["block_type"] = {"tokenizer": {"type": "raw"}}
            keys.append("block_type")
        add("idx_" + table + "_bm25", table, keys, "bm25",
            options={"key_field": "id", "text_fields": json.dumps(fields)})

    for name, expression, method in (
        ("idx_documents_filename_tokens", filename_tokens_expression(LogicalDocument.file_name), "gin"),
        ("idx_documents_filename_issuer", filename_issuer_expression(LogicalDocument.file_name), "btree"),
    ):
        key = str(expression.compile(dialect=dialect, compile_kwargs={"literal_binds": True, "include_table": False}))
        add(name, "logical_documents", [key], method, "mcp-search")
    add("idx_documents_workspace_filename_order", "logical_documents", ["workspace_id", 'file_name COLLATE "C"', "id"], owner="mcp-search")
    add("idx_documents_workspace_fts", "logical_documents", ["workspace_id", "fts_config", "id"], owner="mcp-search")
    add("idx_blocks_doc_page_id", "logical_blocks", ["document_id", "page_number", "id"], owner="mcp-search")
    return specs


def canonical_key(value):
    # pg_get_indexdef adds casts and parentheses to compiled SQL expressions.
    # Preserve string literals exactly, including regex case and escape sequences.
    parts = re.split(r"('(?:[^']|'')*')", value)
    return "".join(part if index % 2 else re.sub(r'[\s()"]', '', re.sub(r"\bFROM\b", ",", re.sub(
        r"::(?:character varying|varchar|text)(?:\[\])?", "", part,
        flags=re.I), flags=re.I)).lower() for index, part in enumerate(parts))


def options_dict(index):
    return dict(option.split("=", 1) for option in index.get("options") or [])


def equivalent(spec, index):
    if index["table_name"] != spec["table_name"] or index["partial"]:
        return False
    methods = {"hnsw", "ivfflat"} if spec["method"] == "hnsw" else {spec["method"]}
    if index["method"] not in methods:
        return False
    wanted = [canonical_key(re.sub(r'\s+COLLATE "C"|\s+halfvec_cosine_ops$', '', key)) for key in spec["keys"]]
    actual = [canonical_key(key) for key in index["keys"]]
    if spec["method"] == "bm25":
        if not set(wanted).issubset(actual):
            return False
        options = options_dict(index)
        if options.get("key_field") != "id":
            return False
        try:
            raw = options.get("text_fields", "{}")
            fields = json.loads(raw.replace(r"\n", "\n"))
        except (TypeError, ValueError):
            return False
        expected = json.loads(spec["options"]["text_fields"])
        return all(fields.get(key) == value for key, value in expected.items())
    if spec["method"] == "btree":
        return actual[:len(wanted)] == wanted and index["collations"][:len(wanted)] == spec["collations"]
    if spec["method"] == "hnsw":
        return actual == wanted and index["opclasses"] == ["halfvec_cosine_ops"]
    return actual == wanted


def plan_indexes(specs, catalog):
    missing, matched, issues = [], [], []
    kinds = {row["name"]: row["kind"] for row in catalog["tables"]}
    for spec in specs:
        equivalent_indexes = [index for index in catalog["indexes"] if equivalent(spec, index)]
        healthy = [index for index in equivalent_indexes if index["valid"] and index["ready"]]
        if healthy:
            matched.append({"requirement": spec["name"], "existing": healthy[0]["name"], "owner": spec["owner"]})
            continue
        collision = [index for index in catalog["indexes"] if index["name"] == spec["name"]]
        bm25 = [index for index in catalog["indexes"] if index["table_name"] == spec["table_name"] and index["method"] == "bm25"]
        if equivalent_indexes or collision or (spec["method"] == "bm25" and bm25):
            issues.append(f"Index review required: {spec['name']} has an invalid or incompatible existing index; not rebuilding automatically.")
        elif kinds.get(spec["table_name"]) == "p":
            issues.append(f"Index migration required: {spec['table_name']} is partitioned; provision parent/child indexes through ingestion migrations.")
        else:
            missing.append(spec)
    return missing, matched, issues


def verify_and_apply(connection, schema, *, apply=False):
    catalog = inspect_catalog(connection, schema)
    missing, matched, index_issues = plan_indexes(index_specs(schema, catalog), catalog)
    installed = {row["name"] for row in catalog["extensions"]}
    available = {row["name"] for row in catalog["available_extensions"]}
    extensions = [name for name in EXTENSIONS if name not in installed]
    issues = schema_issues(catalog, get_settings().EMBEDDING_DIMENSION) + index_issues
    issues += [f"Extension {name} is not available on this PostgreSQL server." for name in extensions if name not in available]
    if connection.execute(text("SHOW standard_conforming_strings")).scalar() != "on":
        issues.append("standard_conforming_strings must be on for index DDL.")
    report = {"schema": schema, "mode": "apply" if apply else "check", "catalog": catalog,
        "matched_indexes": matched, "missing_extensions": extensions, "missing_indexes": missing,
        "issues": issues, "created": []}
    if issues:
        report["status"] = "blocked"
        return report
    if not apply:
        report["status"] = "ready" if not missing and not extensions else "changes_needed"
        return report
    for name in extensions:
        connection.exec_driver_sql(f"CREATE EXTENSION IF NOT EXISTS {name}")
        report["created"].append({"extension": name, "owner": "shared-ingestion"})
    for spec in missing:
        connection.exec_driver_sql("SET statement_timeout = 0")
        try:
            connection.exec_driver_sql(spec["sql"])
        finally:
            connection.exec_driver_sql("SET statement_timeout = 5000")
        report["created"].append({"index": spec["name"], "owner": spec["owner"]})
    after = inspect_catalog(connection, schema)
    remaining, _, problems = plan_indexes(index_specs(schema, after), after)
    report["issues"] = schema_issues(after, get_settings().EMBEDDING_DIMENSION) + problems
    report["issues"] += ["Some required indexes are still missing."] if remaining else []
    if not set(EXTENSIONS).issubset({row["name"] for row in after["extensions"]}):
        report["issues"].append("Some required extensions are still missing.")
    report["status"] = "ready" if not report["issues"] else "blocked"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="One-time repair of missing extensions/indexes")
    parser.add_argument("--schema", help="Defaults to PostgreSQL current_schema()")
    parser.add_argument("--output", type=Path, default=Path("logs/database-setup.json"))
    args = parser.parse_args()
    engine = create_engine(make_url(get_settings().DATABASE_URL).set(drivername="postgresql+psycopg2"),
        isolation_level="AUTOCOMMIT", echo=False, connect_args={"connect_timeout": 5,
            "options": "-c statement_timeout=5000 -c lock_timeout=5000" +
            ("" if args.apply else " -c default_transaction_read_only=on")})
    report = {"status": "failed", "mode": "apply" if args.apply else "check"}
    try:
        with engine.connect() as connection:
            schema = args.schema or connection.execute(text("SELECT current_schema()")).scalar()
            if not schema:
                raise RuntimeError("No target schema exists.")
            locked = False
            try:
                if args.apply:
                    locked = connection.execute(text("SELECT pg_try_advisory_lock(hashtext(:key))"),
                        {"key": "mcp-logical-search.setup:" + schema}).scalar()
                    if not locked:
                        raise RuntimeError("Another database setup is running.")
                report = verify_and_apply(connection, schema, apply=args.apply)
            finally:
                if locked:
                    connection.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"),
                        {"key": "mcp-logical-search.setup:" + schema})
    except Exception as exc:
        # SQLAlchemy exception strings may contain connection/corpus parameters.
        report.update(status="failed", error_type=type(exc).__name__,
            sqlstate=getattr(getattr(exc, "orig", None), "pgcode", None))
    finally:
        engine.dispose()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "mode": report["mode"],
        "missing_indexes": len(report.get("missing_indexes", [])), "created": report.get("created", []),
        "issues": report.get("issues", []), "error_type": report.get("error_type"),
        "sqlstate": report.get("sqlstate"), "output": str(args.output)}, indent=2))
    if report["status"] != "ready":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
