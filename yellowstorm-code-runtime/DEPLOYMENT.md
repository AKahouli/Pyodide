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
