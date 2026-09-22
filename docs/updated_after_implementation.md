# Yellowmind Semantic Model — Implementation Plan (post Slice 4)

**Date:** 2026-09-13 · **Branch:** `agara-worky-006` · **Status:** Slices 1–4 delivered and gated
**Original plan:** `yellowmind_semantic_model_initial_implementation_plan.md` (Downloads) — sections referenced below as §
**Companion docs:** `docs/semantic-model-how-it-works.md`, `docs/semantic-model-stockage.md`, vault note `Yellowstorm/Features/feature-semantic-model`

---

## 1. Where we stand

**Slices 1–4 are implemented, reviewed, and QA-passed.** A business user can map spreadsheet and document sources to concepts, preview bounded virtual business entities with field-level provenance, configure deterministic relationship matching and primary/fallback source priority, inspect source health, resolve an auditable Review Queue, and see an explained five-area readiness score. Concurrency is optimistic (`expectedRevision`), authorization is contained to model roles plus enabled workspace links, ambiguous or incomplete target samples never auto-resolve, and the legacy KnowledgeBinding flow is untouched.

---

## 2. What is already implemented (Slices 1–3)

### Backend (NestJS + PostgreSQL `semantic_model` schema)
- **Migration `010_source_mappings.sql`** (also in `000_deploy_all.sql`, auto-bootstrapped): `source_mappings` (unique per `model_id + concept_id + document_id + sheet_name`, `field_mappings` jsonb) and `identity_rules` (PK `model_id + concept_id`, ≥1 field).
- **Service `semantic-source-mapping.service.ts`** + pure domain module `domain/semantic-source-mapping.types.ts`:
  - asset listing (structured files of linked workspaces), sheet profiling via **exceljs** (xlsx load; CSV via `csv.read(stream, { sheetName: 'CSV' })`);
  - gates: 50 MB pre-download size cap, 5 000-row preview scan, 200-row profile sample (`ponytail:` comments mark upgrade paths);
  - deterministic field suggestion (normalized-name equality — no LLM, per §2.4 "deterministic mapping first");
  - entity resolution: identity-key dedupe, null-identity/duplicate warnings, provenance with **true worksheet row numbers** (`SHEET_ROW_KEY`);
  - identity-rule upsert/clear piggybacking on mapping save (single transaction, model-revision guarded).
- **Endpoints** on `SemanticModelController`: `GET source-assets`, `GET source-assets/:documentId/profile`, `GET|POST source-mappings`, `POST source-mappings/preview`, `DELETE source-mappings/:mappingId`. Mutations bump the **model** revision; graph autosave uses the separate **version** revision (verified invariant — do not conflate).
- **Authorization containment:** every endpoint = model role (`requireRole`/`requireActiveRole`) **and** an enabled `workspace_links` row before any document access. Keep this pattern for all future endpoints.
- Tests: 12/12 spec (resolver logic + exceljs round-trips incl. multi-sheet, CSV naming, size gate); module suite green; reviewer gate PASS.

### Frontend (React + TanStack Query + Zustand)
- **`SourceMappingDrawer`** (`components/mapping/`): sheet picker, field-mapping table with "Suggested" badges, identity picker with evidence line, data preview with warnings, save/cancel; edit mode locks concept+sheet; preview/reset error states with retry (en/fr).
- Knowledge panel: structured documents carry `structured`/`mimeType` in the drag payload; **"Map data to a concept"** menu item; dropping a structured file on a concept opens the mapper instead of creating a knowledge binding (legacy binding flow preserved for documents/workspaces).
- Concept inspector: **"Data sources"** section (list, edit, remove; loading/error/empty states).
- i18n `mapping.*` keys complete in en/fr; DOM-nesting and console clean.

### Deliberate simplifications (known ceilings)
Mappings are **draft-scoped** (concept_id → current draft version; no snapshot on publish). One mapping per (concept, document, sheet). Suggestions are name-equality only. Preview warnings are English strings (not localized). There are no DB connections or persisted asset/version registry yet.

### Slice 2 additions — document mapping
- Document mappings support per-field extraction, metadata, fixed-value, and ignored modes through bounded `ConceptResolver` implementations for spreadsheet and document sources.
- Document extraction uses the existing native search/evidence path and preserves page/quote/confidence provenance. Bulk document mapping supports amendment-style sets.
- End-to-end extraction against native search remains environment-dependent; local `localhost:8045` returned 503 during final QA, while resolver and boundary tests passed.

### Slice 3 additions — cross-source graph
- **Migration `011_cross_source_resolution.sql`** adds `relation_resolution_rules`, `source_resolution_policies`, and `review_items`. The incremental runner excludes mutable aggregate bootstrap `000_deploy_all.sql`, tolerates only known legacy mutable checksums `001`–`004`, and keeps checksum enforcement for `005+`.
- Relation matching supports exact, case-insensitive, and normalized comparison. Ambiguous matches never auto-select; incomplete target samples, source failures, disabled links, non-ready mappings, and sample overflow force `unresolved` with `partial=true`.
- Reconciliation applies ranked primary/fallback sources, fills missing values, preserves field-level provenance, and exposes conflicts. Preview data remains virtual and bounded rather than being copied into AGE.
- Model navigation now exposes **Model**, **Data Preview**, and **Mappings**. Data Preview shows sampled entities, relationships, provenance, source issues, and conflicting values; Mappings shows per-concept summaries, relation matching, and editable source priority. Viewer controls are read-only and viewer previews do not persist review items.

### Slice 4 additions — business trust
- **Migration `012_business_trust.sql`** adds validated source version/timestamp fields and auditable review resolution fields. Structured, document, and bulk mapping saves record the source version from the existing document `contentHash`, with `updatedAt:size` as fallback; no duplicate asset registry was introduced.
- The **Review Queue** lists open/resolved ambiguous-relation, source-conflict, and broken-mapping items. Decisions are revision-gated and audited; accepted candidates must come from the server-recorded candidate set. Canonical fingerprints prevent duplicate reviews, and resolved reviews are not reopened automatically.
- Accepted relation and source-conflict decisions affect later Data Preview reconciliation while preserving selected-source provenance. Viewers remain read-only and do not persist operational health or review state.
- **Source health** checks are bounded to 50 mappings and detect current, changed, unavailable, and broken mappings, including removed structured fields. Broken mappings create durable review items; repair reuses the existing mapping drawers.
- **Readiness** is deterministic across Structure, Sources, Identity, Relationships, and Data Quality (20 points each) and is scoped to the current draft. The responsive Trust center exposes the score, explanations, and Review Queue; its mobile modal has trapped focus, Escape dismissal, focus restoration, and a reliable close target.
- ADK-generated suggestions and Test Model/context-resolution tracing are deferred to Slice 5; they were not required to make the Slice 4 trust loop coherent.

---

## 3. Traceability against the original plan phases (§44–§45)

| Phase | Status | Notes |
|---|---|---|
| B1 workspace links | ✅ done (pre-existing) | origin/connected, connect/disconnect + impact |
| B4 source mappings | ✅ done (Slices 1–2) | structured and document mappings |
| B5 identity rules | ✅ done (minimal) | composite keys supported in model, single-field UI |
| B0 data contracts | 🟡 partial | mapping, relation-resolution, policy, preview, provenance, and conflict contracts done |
| B3 unified asset catalog | 🟡 partial | xlsx/CSV parsed on demand; no persisted asset/version registry, no DB metadata |
| B9 resolvers | 🟡 partial | spreadsheet/document resolvers done; database resolver awaits connection registry |
| F1 workspace explorer | 🟡 partial | linked workspaces + docs listed; no dedicated explorer hierarchy (§6) |
| F4 structured mapping UI | ✅ done (drawer form) | no multi-select/bulk; drop works via document drag |
| F8 data preview + provenance | ✅ done (Slice 3) | bounded model-level preview with relation/source state |
| B2 connection registry (PostgreSQL/MySQL) | ❌ not started | §7, §34 |
| B6 relation resolution engine | ✅ done (Slice 3) | deterministic matching; incomplete samples remain partial |
| B7 source resolution policy | ✅ done (Slice 3) | ranked primary/fallback reconciliation |
| B8 review items / AI suggestions | 🟡 partial | queue + audited decisions done; ADK suggestions remain Slice 5 |
| B10 business context projection | ❌ not started | §37 (existing AGE pipeline unchanged) |
| B11 health / schema drift | ✅ done (Slice 4) | bounded health checks, drift detection, durable broken-mapping reviews |
| B12 semantic context planner | ❌ not started | §39 |
| B13 MCP `resolve_semantic_context` | ❌ not started | §40 |
| F2 workspace Sources page (`/sources`) | ❌ not started | §7 |
| F3 unified asset browser UI | ❌ not started | §8 |
| F5 document mapping / extraction | ✅ done (Slice 2) | §12–§13; native-search E2E depends on service availability |
| F6 relation resolution UI | ✅ done (Slice 3) | §14 |
| F7 multi-source policy UI | ✅ done (Slice 3) | §15 |
| F9 Mappings view (model tab) | ✅ done (Slice 3) | §20 |
| F10 health / repair UX | ✅ done (Slice 4) | Source health and existing-drawer repair flow |
| F11 readiness + Test Model | 🟡 partial | explained readiness done; Test Model remains Slice 5 |
| F12 publish snapshot incl. mappings + MCP | ❌ not started | §28, §40 |

---

## 4. Remaining delivery slices

Each slice stays independently demoable (original plan §49). Order matters: 2 and 3 are independent of each other; 4 builds on both; 5 is last.

### Slice 2 — Mixed structured/unstructured modeling (F5, B4-doc, B9) — delivered
Maps contract PDFs onto concepts alongside spreadsheets.
- Document source mappings: per-field population methods (find in document / metadata / fixed value / none) (§12).
- Extraction preview with page + quote + confidence; provenance opening the existing citation/viewer UI (§12.2, §19).
- Bulk document mapping for amendment-style sets (§13).
- Introduce the **`ConceptResolver` abstraction** (§35) and move spreadsheet resolution behind it; add the document-extraction resolver. Extraction inference goes through a **dedicated YellowStorm ADK agent** (configurable in the agent library), not inline chat completion.
- Depends on: Slice 1. Acceptance: plan §47 steps 10–13.

### Slice 3 — Cross-source business graph (B6, B7, F6, F7, F8, F9) — delivered
Resolves relationships across sampled virtual entities from multiple sources.
- `relation_resolution_rules` (exact / case-insensitive / normalized matching; ambiguity → review, never auto-resolve) + matching preview (§14, §36).
- `source_resolution_policies`: primary/fallback with conflict-to-review; field overrides later (§15, §38).
- Model-level **Data Preview** view (rename current "Records" tab per §18): business entity list/graph, entity drawer with per-value provenance, sampled only.
- **Mappings** view tab: per-concept mapping summary + source priority (§20).
- Persistence: `relation_resolution_rules`, `source_resolution_policies`, `review_items` tables; resolver abstraction extended with a structured/database resolver.
- Depends on: Slice 1. Acceptance: plan §47 steps 14–17.

### Slice 4 — Business trust (B8, B11, F10, F11) — delivered
- Auditable Review Queue with server-validated decisions and deterministic application to later previews (§16).
- Bounded mapping health and schema-drift detection with repair through existing mapping drawers (§22, B11). Existing document source versions are authoritative; a second asset registry was unnecessary for file-backed mappings.
- Explained readiness across Structure, Sources, Identity, Relationships, and Data Quality (§21).
- Depends on: Slices 2–3. Acceptance: backend/frontend tests, migration rerun, reviewer PASS, and desktop/mobile browser QA PASS.

### Slice 5 — Agent consumption (B12, B13, F12)
- Add the AI suggestions tray through a dedicated configurable YellowStorm ADK agent; accepted suggestions write ordinary semantic configuration with audit metadata (§17).
- **Publish** freezes semantic configuration including source mappings, identity rules, relation rules, policies (version snapshot; resolves the current draft-scoped limitation) (§28).
- **Semantic context planner**: query → concepts/relations → entity resolution → context manifest with source scope + coverage (§39); no arbitrary LLM-driven traversal.
- **MCP `resolve_semantic_context`** as a thin adapter; hand off exact `(workspaceId, file)` pairs to Logical Search (§40–§41).
- Add the Test Model drawer with two-stage semantic-context trace, wired to the planner (§23–§24).
- Depends on: Slices 2–4. Acceptance: full §47 contract-analysis scenario end-to-end.

### Workspace Sources (F2/F3 + B2/B3) — parallel track
PostgreSQL/MySQL connection registry (secret refs, test, scoped discovery, metadata refresh) and the `/sources` page with the add-connection wizard (§7, §34, §42). DB-backed concepts then plug into Slice 3's resolver. Excel/CSV stay workspace files. Security requirements of §42 apply verbatim (secret store only, masked display, read-only credentials, statement timeout, row limits, allowlists).

---

## 5. Cross-cutting follow-ups (from review/QA, non-blocking)

1. Localize preview/validation warnings — return warning **codes** from the API, map to i18n keys.
2. Add a Map-data entry point inside the pinned knowledge-tray mode (currently only via menu/drop with tray closed).
3. Clean up orphaned `source_mappings`/`identity_rules` when a concept is deleted (no FK to `node_types` today); also clone mappings in `model clone`.
4. Replace in-memory workbook parse with streaming if large-workbook previews become a real use case (currently 50 MB gate).
5. Security pass (§42): decide workspace-membership parity for model members (pre-existing gap in the binding flow too), and cap `constantValue` size when constants get a UI.
6. Add a focused automated test around migration discovery/checksum policy; live application of 010/011 and an idempotent rerun passed.
7. Restore native search availability on `localhost:8045` to complete document-extraction browser evidence; the service returned 503 during QA.

---

## 6. Verification baseline (keep green per slice)

- Backend: `npm test -- --runInBand src/modules/semantic-model`, `npm run build`, and `npm run semantic-model:migrate` all pass. Migration `012_business_trust.sql` applied successfully and its rerun is idempotent.
- Frontend: focused Semantic Model tests, `npx tsc --noEmit`, and `npm run build` pass.
- Gates per workspace policy: `reviewer` mandatory; `frontend-qa` for browser-visible changes; `maintainer` after durable decisions (canonical note: `Yellowstorm/Features/feature-semantic-model`).
- Slice 1 end-to-end evidence: `qa-assets/frontend-qa-evidence.md`; runnable demo state exists in the dev environment (QA workspace "Contract Management QA", Organization ← customers.xlsx/Customers).
- Slice 3 browser QA: PASS on desktop/mobile interaction, accessibility basics, console, and network behavior; authenticated Data Preview loaded 16 entities. Final reviewer gate: PASS with no critical or major findings.
- Slice 4 browser QA: PASS on desktop/mobile readiness, Review Queue, Source health, responsive behavior, modal focus containment, Escape/focus restoration, close interaction, console, and network behavior. Final reviewer gate: PASS with no findings.
- Final acceptance: plan §47 checklist (no SQL/Cypher by the user, no duplicate entities, exact document scope, coverage warnings, provenance everywhere).
