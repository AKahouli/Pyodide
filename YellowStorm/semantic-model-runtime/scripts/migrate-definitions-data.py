"""Copy semantic_model relational data between databases (one-shot migration tool).

Copies the 19 code-owned tables in FK-topological order inside one target
transaction (the models<->versions deferrable pair is ordered out and checked
at commit). Skips the schema_migrations ledger and code-unreferenced orphan
tables (AGE-stranded labels, structured_*, graph_catalog/embeddings); the
exclusion report lives in docs/semantic-model-runtime/data-migration-report.md.
AGE graph data is NOT copied here: population rebuild owns it (plan Phase 9).

Run only through the required environment:
  conda run -n meta python scripts/migrate-definitions-data.py [--apply]

Env: SRC_DATABASE_URL (read-only source), DST_DATABASE_URL (owner role URL).
Default is DRY-RUN (order + counts, no writes). Values are never printed.
"""

import asyncio
import os
import sys

import asyncpg

SKIP = {
    "schema_migrations",
    "Document",
    "Entity",
    "MENTIONS",
    "RELATED_TO",
    "_ag_label_edge",
    "_ag_label_vertex",
    "graph_catalog",
    "graph_embeddings",
    "structured_edges",
    "structured_entities",
    "structured_sources",
}


async def columns(con: asyncpg.Connection, table: str) -> list[tuple[str, str]]:
    rows = await con.fetch(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = 'semantic_model' AND table_name = $1 "
        "ORDER BY ordinal_position",
        table,
    )
    return [(r["column_name"], r["data_type"]) for r in rows]


def topo_order(edges: list[tuple[str, str]], tables: list[str]) -> list[str]:
    parents: dict[str, set[str]] = {t: set() for t in tables}
    for child, parent in edges:
        if child in parents and parent in parents and child != parent:
            parents[child].add(parent)
    order: list[str] = []
    while parents:
        ready = sorted(t for t, deps in parents.items() if not deps)
        if not ready:
            raise SystemExit("FK cycle, aborting: " + ",".join(sorted(parents)))
        for table in ready:
            order.append(table)
            del parents[table]
            for deps in parents.values():
                deps.discard(table)
    return order


async def main() -> None:
    apply = "--apply" in sys.argv
    src = await asyncio.wait_for(
        asyncpg.connect(os.environ["SRC_DATABASE_URL"], command_timeout=30), 30
    )
    dst = await asyncio.wait_for(
        asyncpg.connect(os.environ["DST_DATABASE_URL"], command_timeout=30), 30
    )
    try:
        rows = await src.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'semantic_model' ORDER BY 1"
        )
        tables = [r["tablename"] for r in rows if r["tablename"] not in SKIP]
        edges = await src.fetch(
            "SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent "
            "FROM pg_constraint WHERE contype = 'f' "
            "AND connamespace = 'semantic_model'::regnamespace"
        )
        # models <-> versions is a real bidirectional pair, DEFERRABLE
        # INITIALLY DEFERRED by design; break it for ordering, check at commit.
        pairs = set()
        for e in edges:
            child, parent = e["child"].split(".")[1], e["parent"].split(".")[1]
            if {child, parent} == {"models", "versions"}:
                continue
            pairs.add((child, parent))
        order = topo_order(sorted(pairs), tables)
        print("order=" + ",".join(order))
        plan = []
        for table in order:
            cols = await columns(src, table)
            dst_cols = await columns(dst, table)
            assert [c for c, _ in cols] == [c for c, _ in dst_cols], f"schema drift: {table}"
            count = await src.fetchval(f'SELECT count(*) FROM semantic_model."{table}"')
            plan.append((table, cols, count))
            print(f"{table} rows={count}")
        if not apply:
            print("DRY-RUN complete, no writes")
            return
        # Consistent source snapshot: the old database may still serve traffic.
        src_tr = src.transaction(isolation="repeatable_read")
        await src_tr.start()
        dst_tr = dst.transaction()
        await dst_tr.start()
        try:
            await dst.execute("SET CONSTRAINTS ALL DEFERRED")
            for table, cols, count in plan:
                if count == 0:
                    continue
                select_list = ", ".join(
                    f'"{c}"::text' if t == "jsonb" else f'"{c}"' for c, t in cols
                )
                insert_list = ", ".join(
                    f"${i}::jsonb" if t == "jsonb" else f"${i}"
                    for i, (_, t) in enumerate(cols, 1)
                )
                col_list = ", ".join(f'"{c}"' for c, _ in cols)
                batch = await src.fetch(
                    f'SELECT {select_list} FROM semantic_model."{table}"'
                )
                await dst.executemany(
                    f'INSERT INTO semantic_model."{table}" ({col_list}) VALUES ({insert_list})',
                    [tuple(r) for r in batch],
                )
            print("COPY complete, verifying before commit")
            ok = True
            for table, _, _ in plan:
                count = await src.fetchval(
                    f'SELECT count(*) FROM semantic_model."{table}"'
                )
                new_count = await dst.fetchval(
                    f'SELECT count(*) FROM semantic_model."{table}"'
                )
                digest_sql = (
                    "SELECT md5(coalesce(string_agg(t::text, '' ORDER BY t::text), '')) "
                    + f'FROM semantic_model."{table}" t'
                )
                old_sum = await src.fetchval(digest_sql)
                new_sum = await dst.fetchval(digest_sql)
                match = count == new_count and old_sum == new_sum
                ok = ok and match
                print(f"{table} count={new_count} checksum-match={match}")
            if not ok:
                raise SystemExit("MIGRATE-MISMATCH: rolling back")
            await dst_tr.commit()
        except BaseException:
            for tr in (dst_tr, src_tr):
                try:
                    await tr.rollback()
                except Exception:
                    pass
            raise
        else:
            try:
                await src_tr.commit()
            except Exception:
                pass
        print("MIGRATE-OK")
    finally:
        await src.close()
        await dst.close()


asyncio.run(main())
