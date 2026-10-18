# R02: retirement of arbitrary-key presigning

Status: **local removal implemented; security review / rollout pending**.

The user selected removal of `POST /internal/documents/download-url` after
tracked-source inventory found no concrete client. The controller and raw-path
DTO are removed from `DocumentModule`; there is no compatibility alias or generic
principal that can sign a caller-selected key. The storage signer primitive
remains internal to resource-owning services; upload/write APIs are not replaced
with a generic read broker.

## Preserved authorized resource flows

- Workspace documents: `WorkspaceAccessGuard` and
  `WorkspaceDocumentRead.getDownloadUrl(workspaceId, documentId)` use the
  workspace-scoped authoritative document record; reject missing, pending and
  folder resources, resolve persisted blob path and sign read-only after access.
- Playbook artifacts: `PlaybookFlowArtifactService.issueAccess` resolves exact
  execution/task artifact identity and uses its existing typed access capability.
- Conversation artifacts/citations/images: `ConversationArtifactService` and
  `RootEvidenceService` resolve conversation/message/artifact or source-document
  relationships before access; existing ownership/share rules remain mandatory.

No new internal resource consumer or credential issuer is invented for an unknown
client. If an external consumer requires a new internal broker, first approve its
named principal and actor/job proof, typed resource reference, authoritative
resolver, read-only action, backend-owned 60–120 second TTL (maximum five minutes)
and `Cache-Control: no-store`. It must never reintroduce `filePath`, caller owner
IDs, arbitrary prefixes, client TTL overrides or a legacy shared-key bypass.

This removal does **not** claim every pre-existing authorized download URL has a
new TTL policy or instantaneous revocation. A previously minted object-store URL
can remain usable until its existing expiry. Current access must gate future
issuance; deployment owners must keep retired code from serving older replicas.

## Source and checks

- Removed: `YellowStorm/back/src/modules/document/document.controller.ts` and
  `dto/download-url.dto.ts`; `document.module.ts` no longer registers the route.
- `document.controller.spec.ts` boots the real `DocumentModule` over ephemeral
  local HTTP and verifies 404 for absent, legacy, Agent and Semantic credentials,
  with zero signer calls and no URL response.
- Existing resource authorization/storage tests remain required for the retained
  flows. Real Ceph test-bucket read-only and expiry evidence is not established.

## Consumer migration / deployment gate

Tracked endpoint references were controller/DTO/tests and documentation. User
workspace download URLs with a similar suffix are different, authorized routes.
Unknown external code-interpreter/Manus, runtime, private SDK and deployed clients
must be confirmed by their owners; source absence is not evidence of no clients.
Remove/disable the old route at every replica before go-live. Functional rollback
must not restore arbitrary-key signing. No live consumers, buckets, records or
secrets were probed or modified during this local work.
