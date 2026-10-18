# Yellowmind platform architecture decisions

Read this small index before platform code changes. Select decisions whose source
paths, ownership, interfaces or security boundary intersect the task; read those
records and check any superseding decision before editing. Do not load every ADR.

| Decision | Status | Applies when | Constraint to verify |
| --- | --- | --- | --- |
| [ADR-0028: OpenUI HTML artifact policy](ADR-0028-openui-html-artifact-policy.md) | proposed | HtmlView execution, autosave and administrator policy | Strict generated-script removal by default; optional inline JavaScript with declared self-navigation/resource limits; opaque srcdoc with trusted external bootstrap and instance-bound private state; preserve application CSP |
| [ADR-0027: classic conversation durable SSE](ADR-0027-classic-conversation-durable-sse.md) | proposed | Classic conversation recipient event delivery/replay across backend replicas | User-approved PostgreSQL table, committed cursor order, current recipient access, bounded queue/retention and canonical resync; production capacity remains to qualify |
| [ADR-0026: combined user assertion and delegated provider credential](ADR-0026-combined-assertion-and-provider-credential.md) | accepted | A connector needs both a verified user at the MCP boundary and that user's provider credential downstream (e.g. SharePoint/M365 document MCP) | Assertion stays the `internal_jwt` ingress identity; provider token travels in a separate connector-declared header; declared provider credentials fail closed with no stored-identity fallback; neither credential may substitute for the other |
| [ADR-0025: private OpenUI draft state](ADR-0025-openui-private-draft-state.md) | accepted | Conversation mini-app draft autosave and concurrent edits | Private actor/source/program identity; authenticated owner/member GET/PUT; bounded typed JSON; atomic expected revisions; explicit conflict recovery; no autosave inference |
| [ADR-0024: delegated-user identity for platform-trusted MCPs](ADR-0024-delegated-user-identity-for-trusted-mcps.md) | accepted | Internal MCP surface for first-party, co-deployed MCPs that act for an invoking user | One backend-signed assertion recognized generically by the auth layer; no per-route audience fence for this class; actor from signature only, permissions always the invoking user's; every delegated call attributed/audited; fail closed; ADR-0017/0018 remain for non-trusted connectors; semantic, playbook and agent-crud surfaces migrated (see ADR-0024 implementation status and evidence) |
| [ADR-0023: two-header assertion auth for static-credential MCP ingress](ADR-0023-mcp-two-header-assertion-auth.md) | accepted | Static-credential connectors whose MCP needs verified user attribution | Bearer credential always verified; C1-grade optional assertion with connector/revision binding; no static-secret or user-ID fallback; both ends must support it; acceptance is not implementation/deployment |
| [ADR-0022: Responses HTTP/2 transport reuse](ADR-0022-conversation-responses-http2-pool.md) | proposed | Native Responses gateway connection lifecycle | Share network connections only, preserve turn identity/cookies and SDK connection counts, qualified 30-second idle expiry, lifespan cleanup after gRPC stops |
| [ADR-0021: deferred conversation connector schemas](ADR-0021-conversation-deferred-connector-schemas.md) | proposed | Conversation parent tool disclosure and Responses compatibility | Complete authorized catalog remains reachable, original wrappers retained, stable full-catalog replay fingerprint |
| [ADR-0020: conversation Responses history controls](ADR-0020-conversation-responses-history-controls.md) | proposed | Model-level Responses replay, provider history and summaries | Local transcript retained, opaque state private, provider mode requires Auto, completions stays application-managed |
| [ADR-0019: conversation native Responses](ADR-0019-conversation-native-responses.md) | proposed | Single-agent conversation parent provider migration | Application-owned history, native stream terminal validation and existing capacity ownership; proposed record does not override accepted decisions |
| [ADR-0015: runtime-owned semantic AI extraction](ADR-0015-runtime-owned-semantic-ai-extraction.md) | accepted | Semantic-model AI extraction, backend/runtime/ADK ownership or their contracts | Semantic runtime owns inference execution; verify the record's boundary and rollout constraints |
| [ADR-0017: MCP security and authentication](ADR-0017-mcp-security-and-authentication-baseline.md) | accepted | MCP servers/clients, transport, credentials, identity or authorization | Select the applicable transport/deployment profile and verify its controls; do not apply one profile universally |
| [ADR-0018: connector-managed MCP security and isolation](ADR-0018-connector-managed-mcp-security.md) | accepted | Connector UI-managed trust, shared MCP client/JWT ownership or Semantic MCP transport | Connector policy/revision and restricted security management; stateless Semantic MCP, neutral `src/mcp`, assertion-bound runtime renewal; design acceptance is not deployment certification |

Use the record's current contents as authority; this table is a locator. If no
record applies, record that conclusion briefly instead of inventing a decision.
Proposed records are not approved policy. Check the index on the implementation
branch and reconcile source differences or conflicting decisions explicitly.

Before the first edit, record applicable ADR IDs and their concrete constraints in
the task context/checkpoint decisions or inline plan. Worker handoffs carry the same
selection. Review verifies the implementation against those constraints. For a
material architectural change, briefly identify the governing ADR in the delivery.
This is a workflow requirement, not a tool permission or edit lock.

Platform ADRs remain in this directory. Use the next unused `ADR-NNNN` ID and
preserve accepted history; a changed decision gets a superseding record. The primary
allocates IDs for parallel workers. Harness decisions have their own
[index](../../../tools/opencode-harness/docs/decisions/README.md) and `HADR` namespace.
