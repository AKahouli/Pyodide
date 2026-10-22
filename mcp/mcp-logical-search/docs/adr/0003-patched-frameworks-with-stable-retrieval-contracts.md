# ADR-0003: Patched frameworks with stable retrieval contracts

- Status: Accepted
- Date: 2026-10-16
- Context: User authorized remaining security fixes while preserving project logic.

## Decision

Upgrade vulnerable framework/model-wrapper pins to patched versions rather than
suppressing advisories for older packages. Use FastMCP 3.2.0, the earliest release
that fixes the outstanding FastMCP advisories identified during this review,
instead of migrating to its newest major version. Upgrade compatible FastAPI,
Starlette, SSE-Starlette, Uvicorn, Pydantic, OpenAI and LangChain OpenAI versions
as pinned in `requirements.txt`. The image also pins a patched pip installer.

Preserve retrieval algorithms, weighting, model aliases, prompts, embedding
payloads, document/citation identities, valid response content, and the dynamic
header design in [ADR-0002](0002-dynamic-workspace-scope-from-trusted-header.md).

Use FastMCP's documented `decorator_mode=object` compatibility mode to retain
the existing decorated component objects. Keep the service's dictionary-based
inspection methods as thin adapters to the renamed upstream list methods.
Move Mistral citation-tool selection to the current protocol listing hook.
Adapt test access to the new internal `ToolResult.content` wrapper without
changing content assertions. Mask sensitive protocol exception details and logs.

## Alternatives and consequences

- Keeping vulnerable pins would leave package-level advisories unresolved.
- A full rewrite around the latest FastMCP major version would add unrelated
  migration work. The selected patched release needs only targeted adapters.
- Object decorator mode is upstream-supported but deprecated. Revisit it when
  intentionally upgrading beyond this pinned major; do not remove it as an
  incidental cleanup because this project uses component-object attributes.
- Invalid configuration now fails startup. Health probes require authentication
  and an allowed peer, and service database transactions are read-only.
  These are intended security changes; successful retrieval behavior is preserved.
- GitHub OIDC signs image provenance/SBOM attestations. Deployment verifies the
  repository/workflow identity and uses the verified digest. A runner missing
  attestation support or the GitHub CLI must fail rather than skip verification.

## Verification

Run the complete suite with Python 3.12 and isolated pgvector/pg_search PostgreSQL.
Tests cover real MCP protocol content/citation listing, scope rejection, safe
errors, startup policy checks, and SQL image-size limits. Runtime smoke checks
cover real HTTP transport, authenticated readiness, and rejection of writes by
both database drivers. Audit Python packages and the full container separately.
Local checks do not establish provider policies, user entitlement enforcement in
the gateway, encrypted log storage, or production infrastructure configuration.

## References

- [FastMCP 3 migration guide](https://github.com/PrefectHQ/fastmcp/blob/v3.2.0/docs/getting-started/upgrading/from-fastmcp-2.mdx).
- [Security configuration and rollout](../security-configuration.md).
