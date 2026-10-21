"""038: disposable 2560 search rows become empty fixed3072 storage, not source-data loss.

The DB regression drops/rebuilds semantic_* schemas ONLY when both a dedicated test DSN and
SEMANTIC_RUNTIME_TEST_ALLOW_SCHEMA_RESET=1 are explicitly provided. Never use an application DB.
"""
import os
import re
from pathlib import Path

import asyncpg
import pytest

from app.persistence import graph_search_store as search_store, partitions, vector_indexes
from tests.test_graph_search_vector_index_migration import (
    DSN, MIGRATIONS, SCHEMAS, SPEC_HASH, generation_with_vectors,
)
from tests.test_partitions_integration import revision_with_rows

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/038_graph_search_embedding_3072.sql"


def test_migration_clears_only_rebuildable_search_and_uses_atomic_runner() -> None:
    runner = (MIGRATION.parents[1] / "scripts/migrate.py").read_text(encoding="utf-8")
    assert "async with connection.transaction():" in runner
    assert runner.index("await connection.execute(sql,") < runner.index(
        '"INSERT INTO semantic_jobs.schema_migrations')
    sql = re.sub(r"--[^\n]*", "", MIGRATION.read_text(encoding="utf-8"))
    assert sql.count("TYPE halfvec(3072) USING NULL::halfvec(3072)") == 3
    assert re.findall(r"\bTRUNCATE\s+([^;]+);", sql) == [
        "semantic_graph_search.entity_passages, semantic_graph_search.entity_documents,\n"
        "  semantic_graph_search.embedding_cache"]
    assert re.findall(r"\bUPDATE\s+([\w.]+)", sql) == ["semantic_graph_search.index_generations"]
    assert not re.search(r"\b(DELETE|CASCADE|INSERT)\b", sql, re.I)
    assert "state = 'failed'" in sql and "owner = NULL, lease_until = NULL" in sql
    assert "pg_partition_tree" in sql and "pg_get_indexdef" in sql
    assert "replace(idx.definition, 'halfvec(2560)', 'halfvec(3072)')" in sql
    assert "ALTER INDEX %s ATTACH PARTITION %s" in sql
    assert "ORDER BY t.level, i.indexrelid" in sql
    assert sql.index("FOREACH definition IN ARRAY roots") > sql.index("definitions := array_append")


@pytest.mark.skipif(not DSN or os.environ.get("SEMANTIC_RUNTIME_TEST_ALLOW_SCHEMA_RESET") != "1",
                    reason="requires disposable test DB and explicit schema-reset opt-in")
@pytest.mark.asyncio
async def test_populated_2560_to_fixed_3072_preserves_generated_sources_and_invalidates_search() -> None:
    assert DSN
    connection = await asyncpg.connect(DSN)
    pool = None
    try:
        for schema in SCHEMAS:
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            if migration.name < MIGRATION.name:
                await connection.execute(migration.read_text(encoding="utf-8"))
        pool = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
        revision = await revision_with_rows(pool, "m1", "a")
        ready = await generation_with_vectors(pool, revision, "fp-ready", "ready")
        await generation_with_vectors(pool, revision, "fp-building", "indexing")
        empty = (await search_store.create_generation(
            pool, model_id="m1", data_revision_id=revision, projection_ref="age:v1:pop_x",
            spec_hash=SPEC_HASH, fingerprint="fp-empty"))["index_id"]
        await connection.execute(
            "UPDATE semantic_graph_search.index_generations SET state='failed' WHERE index_id=$1::uuid", empty)
        await connection.execute(
            "UPDATE semantic_graph_search.index_generations SET indexed_count=1, passage_indexed_count=1, "
            "reused_count=1, embedding_calls=1, carried_count=1, rebuilt_count=1, embedded_count=1 "
            "WHERE index_id<>$1::uuid", empty)
        await vector_indexes.build_vector_indexes(pool, ready, workers=0)
        await connection.execute(
            "CREATE INDEX migration_expression_hnsw ON semantic_graph_search.entity_documents "
            "USING hnsw ((embedding::halfvec(2560)) halfvec_cosine_ops)")
        await connection.execute(
            "CREATE INDEX migration_expression_ivfflat ON semantic_graph_search.entity_passages "
            "USING ivfflat ((embedding::halfvec(2560)) halfvec_cosine_ops) WITH (lists=1)")
        for table, method in (("entity_documents", "hnsw"), ("entity_passages", "ivfflat")):
            name = partitions.partition_name(table, partitions.generation_key(ready))
            await connection.execute(
                f"CREATE INDEX migration_standalone_{method} ON semantic_graph_search.\"{name}\" "
                f"USING {method} ((embedding::halfvec(2560)) halfvec_cosine_ops) WHERE status='ready'")
        await connection.execute(
            "INSERT INTO semantic_graph_search.embedding_cache "
            "(model_id, embedding_fingerprint, content_hash, embedding) "
            "SELECT 'm1', 'old', content_hash, embedding FROM semantic_graph_search.entity_documents LIMIT 1")
        await connection.execute(
            "INSERT INTO semantic_runtime.active_bindings "
            "(model_id, model_version_id, data_revision_id, projection_ref) VALUES ('m1','v1',$1,'age:v1:pop_x')",
            revision)
        source_tables = [f"semantic_population.{table.name}" for table in partitions.REVISION_TABLES]
        source_tables += ["semantic_population.data_revisions", "semantic_runtime.active_bindings"]

        async def snapshot(tables):
            return {table: await connection.fetchval(
                f"SELECT jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)) FROM {table} e") for table in tables}

        async def index_tree():
            return {row["name"]: dict(row) for row in await connection.fetch(
                "SELECT c.relname AS name, p.relname AS parent, i.indisvalid, i.indisready, "
                "pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i "
                "JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
                "JOIN pg_am am ON am.oid=c.relam LEFT JOIN pg_inherits h ON h.inhrelid=c.oid "
                "LEFT JOIN pg_class p ON p.oid=h.inhparent "
                "WHERE n.nspname='semantic_graph_search' AND am.amname IN ('hnsw','ivfflat')")}

        sources = await snapshot(source_tables)
        search_tables = [f"semantic_graph_search.{table}" for table in (
            "index_generations", "entity_documents", "entity_passages", "embedding_cache")]
        before = await snapshot(search_tables)
        indexes_before = await index_tree()
        assert all(row["indisvalid"] and row["indisready"] for row in indexes_before.values())
        assert {row["parent"] for row in indexes_before.values()} >= {
            "migration_expression_hnsw", "migration_expression_ivfflat"}
        sql = MIGRATION.read_text(encoding="utf-8")
        transaction = connection.transaction()
        await transaction.start()
        await connection.execute(sql)
        await transaction.rollback()
        assert await snapshot(search_tables) == before
        assert await index_tree() == indexes_before
        async with connection.transaction():
            await connection.execute(sql)
        assert await snapshot(source_tables) == sources
        for table in search_tables[1:]:
            assert await connection.fetchval(f"SELECT count(*) FROM {table}") == 0
        assert await connection.fetchval(
            "SELECT count(*) FROM semantic_graph_search.index_generations WHERE state='failed' "
            "AND owner IS NULL AND lease_until IS NULL AND indexed_count=0 AND passage_indexed_count=0 "
            "AND reused_count=0 AND embedding_calls=0 AND carried_count=0 AND rebuilt_count=0 AND embedded_count=0 "
            "AND last_error_code='embedding_storage_changed'") == 3
        assert await search_store.fallback_generation(pool, "m1", revision) is None
        for table in ("entity_documents", "entity_passages"):
            widths = await connection.fetch(
                "SELECT format_type(a.atttypid,a.atttypmod) AS width FROM pg_attribute a "
                "WHERE a.attrelid IN (SELECT relid FROM pg_partition_tree($1::regclass)) "
                "AND a.attname='embedding'", f"semantic_graph_search.{table}")
            assert len(widths) == 4 and {row["width"] for row in widths} == {"halfvec(3072)"}
        indexes_after = await index_tree()
        assert set(indexes_after) == set(indexes_before)
        for name, row in indexes_before.items():
            assert indexes_after[name] == {**row, "definition": row["definition"].replace(
                "halfvec(2560)", "halfvec(3072)")}
        vector = "[" + ",".join(["0.01"] * 3072) + "]"
        await connection.execute(
            "INSERT INTO semantic_graph_search.entity_documents "
            "(index_id,entity_id,concept_id,search_text,lexical,content_hash,embedding,status) "
            "VALUES ($1::uuid,'e','c','a',to_tsvector('simple','a'),$2,$3::text::halfvec,'ready')",
            ready, SPEC_HASH, vector)
        await connection.execute(
            "INSERT INTO semantic_graph_search.entity_passages "
            "(index_id,entity_id,ordinal,concept_id,field_key,start_offset,end_offset,passage_text,search_text,"
            "lexical,content_hash,embedding,status) VALUES "
            "($1::uuid,'e',0,'c','body',0,1,'a','a',to_tsvector('simple','a'),$2,$3::text::halfvec,'ready')",
            ready, SPEC_HASH, vector)
        await connection.execute(
            "INSERT INTO semantic_graph_search.embedding_cache VALUES ('m1','new',$1,$2::text::halfvec,now())",
            SPEC_HASH, vector)
        for table in search_tables[1:]:
            assert await connection.fetchval(f"SELECT vector_dims(embedding) FROM {table}") == 3072
            with pytest.raises(asyncpg.DataError):
                await connection.execute(
                    f"UPDATE {table} SET embedding=array_fill(0.01::real,ARRAY[2560])::halfvec")
        new = (await search_store.create_generation(
            pool, model_id="m1", data_revision_id=revision, projection_ref="age:v1:pop_x",
            spec_hash=SPEC_HASH, fingerprint="fp-3072"))["index_id"]
        await connection.execute(
            "INSERT INTO semantic_graph_search.entity_documents "
            "(index_id,entity_id,concept_id,search_text,lexical,content_hash,embedding,status) "
            "VALUES ($1::uuid,'new','c','a',to_tsvector('simple','a'),$2,$3::text::halfvec,'ready')",
            new, SPEC_HASH, vector)
        assert await vector_indexes.build_vector_indexes(pool, new, workers=0) == {
            "entity_documents": 1, "entity_passages": 0}
        assert await vector_indexes.existing_vector_indexes_of(pool, new) == set(vector_indexes.VECTOR_TABLES)
        assert all(row["indisvalid"] and row["indisready"] for row in (await index_tree()).values())
    finally:
        if pool is not None:
            await pool.close()
        await connection.close()
