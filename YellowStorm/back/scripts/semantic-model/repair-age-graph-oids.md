# AGE 1.8.0 restored graph OID repair

Operator-only helper, not a startup migration. No graph/extension drops, graph data
rewrites or source semantic-data changes. Stop AGE clients/workers and take a
verified backup first. Use a dedicated administrative connection. The script does
not resolve role permissions or invalidate other sessions' AGE caches.

From `YellowStorm/back`, using existing installed dependencies:

```text
node --test scripts/semantic-model/repair-age-graph-oids.test.mjs
node scripts/semantic-model/repair-age-graph-oids.mjs
node scripts/semantic-model/repair-age-graph-oids.mjs --validate
node scripts/semantic-model/repair-age-graph-oids.mjs --apply
```

Connection inputs prefer `SEMANTIC_AGEGRAPH_*` over the corresponding
`SEMANTIC_PG_*` fallback, including host, port, user, password, database and SSL.
Use administrative credentials only in the repair process, not the application.
Fallback inputs follow sibling `verify.mjs`: `SEMANTIC_PG_HOST`,
`SEMANTIC_PG_PORT` (default 5432), `SEMANTIC_PG_USER`, `SEMANTIC_PG_PASSWORD`,
`SEMANTIC_PG_DATABASE`, `SEMANTIC_PG_SSL` (`true` enables the existing tooling's
SSL mode). `dotenv/config` loads the working directory's `.env`. Do not put
passwords on the command line. This repairs **all** catalog graphs, not just
`SEMANTIC_AGE_GRAPH`. Preserve stdout as the non-secret old/new mapping report.

Default preflight uses a repeatable-read read-only transaction, checks the catalog
inventory and mappings, emits a reverse map, then rolls back. It does not simulate
updates or run Cypher (broken catalogs cannot pass that check before repair).
`--validate` performs the full repair and all Cypher checks, then always rolls
back rather than committing. Run it on a fresh connection with writers paused.
`--apply` locks both catalogs ACCESS EXCLUSIVE with a 5-second lock timeout and
60-second per-statement timeout. Maintenance downtime is required; catalog locks
are not a replacement for stopping graph users or concurrent extension/schema DDL.

The confirmed cause is restored plain `oid` graph IDs surviving while graph schema
`regnamespace` references were remapped. AGE looks up labels using the current graph
namespace OID; stale IDs make existing label rows appear missing. The helper changes
only `ag_graph.graphid` and `ag_label.graph` together. It requires existing namespace
names to equal graph names and refuses orphan labels, duplicate IDs/names, missing
namespaces, unknown catalogs/columns/types, non-1.8.0 AGE and any target intersecting
an existing graph ID (including cycles). No temporary OID scheme is attempted.

Supported catalog inventory: `ag_graph(graphid oid, name name, namespace regnamespace)`;
`ag_label(name name, graph oid, id ag_catalog.label_id, kind ag_catalog.label_kind,
relation regclass, seq_name name)`. The label domains have integer/char base types.
Only the two plain graph-OID references are remapped. `namespace regnamespace` and
`relation regclass` are restore-managed object references, label `id` is not a graph
OID, and `seq_name` is a name. The runtime inventory examines all extension-member
tables and fails closed if this layout differs. Installed AGE 1.8.0 catalog
inventory was verified against the live database. Official Apache AGE catalog
source confirms graph creation sets graph ID to namespace OID and `_label_name`
checks namespace-based graph existence. Only the two plain-OID graph references
exist in the installed extension tables. A data-modifying CTE updates both in one
statement, preserving the immediate `fk_graph_oid` without dropping constraints
or disabling triggers. Do not weaken the inventory guard for other versions.

Before commit, the helper verifies all graph IDs equal namespace OIDs, labels join
graphs, and label metadata is unchanged except the mapped graph IDs. It then runs
bounded read-only vertex and edge Cypher on every graph; any failure rolls the
transaction back. These queries do not prove every graph row is intact. The report's
`rollback` is a reverse mapping for operator recovery, **not** an automatic rollback
command: after commit, prefer the verified backup or a separately reviewed reverse
transaction under the same maintenance controls. Do not reverse blindly after new
writes. A connection failure at COMMIT has ambiguous outcome: reconnect and preflight
before any retry.

After success, close all old AGE sessions/restart pools, then in fresh connections
verify read-only Cypher for every graph both as admin and as the actual application
role. Confirm label/node/edge counts, IDs, relations, sequences and semantic source
data against the backup. Mock tests cover guard/control flow and rollback, not AGE
catalog compatibility, real PostgreSQL locking/permissions, restore behavior, or
cache invalidation. In the authorized environment the full rollback-only repair
validated vertex and edge Cypher on all 26 graphs, then confirmed both catalog
snapshots unchanged after rollback. Fresh-session checks remain required after
the separately approved committed application.
