"""Rebuild the older Entity / RELATED_TO graphs (``age:v1:``) as typed graphs.

A typed graph has a label per concept and per relationship, record_id indexes and
each record's workspaces, so the graph walk starts from an index and checks
visibility as it reads. It is built from the records and links already stored:
no source is read again and no data changes. The revision, the bindings serving
it and its search index move to the new graph together; the old graph is dropped.

  conda run -n meta python scripts/reproject_graphs.py --list            # what would move
  conda run -n meta python scripts/reproject_graphs.py <model-id>        # one model
  conda run -n meta python scripts/reproject_graphs.py --all             # every model
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph_search.traversal import init_age_connection  # noqa: E402
from app.persistence import population_store as store  # noqa: E402
from app.population.age_projection import reproject_revision  # noqa: E402

AGE_SETTINGS = {"search_path": 'ag_catalog, "$user", public'}


async def main(model_id: str | None, list_only: bool) -> None:
    pool = await asyncpg.create_pool(os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=2)
    age = await asyncpg.create_pool(os.environ["SEMANTIC_AGEGRAPH_DATABASE_URL"], min_size=1, max_size=1,
                                    server_settings=AGE_SETTINGS, init=init_age_connection)
    try:
        revisions = await store.revisions_with_untyped_projection(pool, model_id)
        print(f"{len(revisions)} revision(s) on an older graph")
        for revision in revisions:
            print(f"  {revision['modelId']}  {revision['revisionId']}  {revision['projectionRef']}")
            if list_only:
                continue
            try:
                moved = await reproject_revision(pool, age, revision["revisionId"])
            except Exception as exc:  # noqa: BLE001 - report and go on with the others
                print(f"    failed: {type(exc).__name__}: {getattr(exc, 'code', exc)}")
                continue
            print(f"    -> {moved['projectionRef']} ({moved.get('vertices', 0)} records, {moved.get('edges', 0)} links)")
    finally:
        await age.close()
        await pool.close()


if __name__ == "__main__":
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("model_id", nargs="?")
    parser.add_argument("--all", action="store_true", help="every model")
    parser.add_argument("--list", action="store_true", help="only list the revisions that would move")
    args = parser.parse_args()
    if not (args.model_id or args.all or args.list):
        parser.error("name a model, or pass --all or --list")
    asyncio.run(main(args.model_id, args.list))
