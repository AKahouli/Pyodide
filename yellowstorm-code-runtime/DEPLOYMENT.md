# Code Runtime Deployment

The production Compose definition is owned outside this repository. Deploy the image built by `.github/workflows/build-code-runtime.yml` on the same private network as `yellowstorm-adk`; do not publish port 8080 externally.

Required controls:

- Set the same high-entropy secret in runtime `CODE_RUNTIME_API_KEY` and ADK `RUN_CODE_RUNTIME_API_KEY`.
- Set ADK `RUN_CODE_RUNTIME_URL=http://yellowstorm-code-runtime:8080`.
- Provision the six `CEPH_S3_*` settings from the existing Ceph secret source.
- Keep `RUN_CODE_ENABLED=false` until the runtime health check, internal connectivity, and an explicitly assigned test agent are verified.
- Apply at least `128 MiB` container memory and `0.5` CPU; tune above these values only with load evidence.
- Allow ingress only from trusted ADK/playbook runtime containers and deny runtime egress except Ceph.
- Use `/health/live` for liveness, `/health/ready` for readiness, and scrape `/metrics` only on the internal network.

Writes are immediate and non-transactional. Objects under `<user_id>/system_<run_id>` may remain after a later code failure; callers receive committed file metadata in both success and failure responses.

Workspace contexts may authorize a complete read-only source mount or exact relative files through `allowedRelativePaths`. Public execution responses contain virtual paths and safe metadata only; object keys, Ceph prefixes, bucket names, and owner storage paths are internal and must never be logged or forwarded to a model.

Recursive `glob` and metadata-only `find` are all-or-error operations. Tune their independent page, key, result, and aggregate budgets with `RUN_CODE_MAX_SCAN_PAGES`, `RUN_CODE_MAX_SCANNED_KEYS`, `RUN_CODE_MAX_GLOB_RESULTS`, `RUN_CODE_MAX_FIND_RESULTS`, `RUN_CODE_MAX_TOTAL_SCAN_PAGES`, and `RUN_CODE_MAX_TOTAL_SCANNED_KEYS`. Do not increase `RUN_CODE_WALL_TIMEOUT_MS` above the current 5-second lightweight-runtime contract.

Server-side copy is controlled by `RUN_CODE_MAX_COPY_OPERATIONS`, `RUN_CODE_MAX_COPY_FILE_BYTES`, and `RUN_CODE_MAX_TOTAL_COPIED_BYTES`. Copies may target only `/workspace/run`; `remove` may delete only files written or copied by the current execution. The response `mutations` ledger records committed creates, copies, and removals, while `writtenFiles` contains only final surviving artifacts.
