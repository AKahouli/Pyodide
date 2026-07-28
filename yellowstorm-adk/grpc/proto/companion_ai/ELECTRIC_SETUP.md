# Enabling the Electric read path (companion_ai)

The orchestrator writes the client-facing slice into `companion_ai`
(`sessions`, `plans`, `plan_steps`, `messages`); the client reads it live from
ElectricSQL. The tables are already Electric-compatible (each has a primary key).
Two things must be true on the Postgres instance before Electric can sync.

## 1. wal_level = logical (REQUIRED — DONE)

Electric tails Postgres via **logical replication**; the instance must be
`wal_level = logical`. DevOps enabled this and the full read path (snapshot +
live push) was verified against `companion_ai`.

Check:
```sql
SHOW wal_level;   -- must be 'logical'
```

Enable (needs a **restart** — on a shared instance this affects every database
on it, including smartadk, so schedule it):
```sql
ALTER SYSTEM SET wal_level = 'logical';
-- then restart Postgres (or set it in the managed provider's console)
```
The role Electric connects as needs `REPLICATION` (our `postgres` user already
has `rolreplication = true`) and there must be spare replication slots
(`max_replication_slots`, `max_wal_senders` — both 10 here, fine).

Nothing else to prepare: Electric auto-manages its publication and adds the
read-model tables on first shape request. PK tables don't need
`REPLICA IDENTITY FULL`.

## 2. Point Electric at companion_ai

`docker-compose.yaml` runs the `electric` service on host `:3100`. In `.env`:
```dotenv
# This instance does NOT accept SSL — sslmode=disable (verified). Electric crashes
# with "Database server not configured to accept SSL connections" on sslmode=require.
ELECTRIC_DATABASE_URL=postgresql://postgres:PASSWORD@poc.postgres.yellowmind.ai:3515/companion_ai?sslmode=disable
ELECTRIC_SECRET=<a long random string>   # injected by the proxy, NEVER the browser
```
```bash
docker compose up -d electric
curl http://localhost:3100/v1/health      # -> 200
```

## 3. Verify a shape syncs

```bash
curl "http://localhost:3100/v1/shape?table=plan_steps&offset=-1&secret=$ELECTRIC_SECRET" -D -
```
A working response carries `electric-handle` / `electric-offset` / `electric-schema`
headers and a JSON array of rows — this is the exact contract the client's
`@electric-sql/client` consumes (through the proxy that injects the secret and
pins `where = session_id = '<owned>'`; see README.md).

## Status

**Verified end-to-end against companion_ai:** wrote read-model rows, read them
through the Electric shape API filtered by `session_id`, and confirmed a live
row update (`s2 -> completed`) pushed on the live poll. Read path is production-ready.

Gotcha: the instance rejects SSL — Electric must use `sslmode=disable`. A
throwaway Electric leaves `electric_slot_default` + `electric_publication_default`
behind; drop them if you tear a test instance down (the real one reuses them).
