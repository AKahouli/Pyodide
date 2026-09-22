# Frontend QA evidence — Semantic Model structured source mapping (Slice 1)

Date: 2026-09-13 · Tester: main agent (interactive Chrome via chrome-devtools MCP) · Branch agara-worky-006 (uncommitted)

## Environment
- Frontend: vite dev, http://localhost:5173 (running)
- Backend: `node dist/src/main`, http://localhost:3000/api/v1 (restarted from fresh build during this QA session)
- Health: `/api/v1/health` → all components true except `playbookMcp:false` (pre-existing, unrelated)
- Semantic PG: remote, schema bootstrapped at backend start (migration 010 tables applied)
- Login used: qa-admin@yellowsys.fr (dedicated QA user created for this session; password not recorded here)
- Test data: workspace "Contract Management QA" (id 6aa631072ed0a33ce8442b64), auto-provisioned model "Contract Management QA model" (id 07a07e0c-c11f-4a64-898c-078add287c67), document customers.xlsx (id 6aa6315c2ed0a33ce8442c7c, 2 sheets; Customers sheet has 7 data rows incl. one duplicate customer_id and one null)

## Steps exercised (all via real UI interaction)
1. Login via email/password dialog → success, redirected to app shell.
2. Created workspace "Contract Management QA" via New workspace wizard (default settings).
3. Uploaded customers.xlsx via workspace "Ajouter → Importer un document" (file injected into the page's hidden input; native OS dialog not drivable) → upload toasts, file row appears.
4. Workspace semantic-model page → "Open automatic model" → editor loaded (React Flow canvas, Documents system node, header shows save/index status).
5. Added concept "Organization" via header Add menu → dialog → created, canvas node appeared, autosave showed "All changes saved".
6. Selected node → inspector showed details; added attributes id, name, country, segment via Business attributes input + Enter. New section "Data sources (0)" visible with empty state text.
7. Knowledge panel → expanded "Contract Management QA" → customers.xlsx row → Link menu shows: Documents / Organization / **"Map data to a concept"** (structured-only item). Workspace-level Link menu correctly does NOT show the item (no mime info at workspace level).
8. Clicked "Map data to a concept" → drawer "Map customers.xlsx to a concept" opened (Sheet primitives, side drawer).
9. Selected concept Organization → sheet dropdown listed "Customers · 8 rows · 4 fields" and "Contacts · 2 rows · 2 fields" (backend profiling live).
10. Selected Customers → field mapping table rendered 4 rows with sample values. Deterministic auto-suggestions: country→country [Suggested badge], segment→segment [Suggested badge]; customer_id, legal_name default to Ignore (no normalized-name match — expected deterministic behavior).
11. Manually set customer_id→id, legal_name→name. Identity select lists mapped fields only; set identity=customer_id.
12. "Preview data" → Data preview (5): C001 (Sheet row 2) Sony Europe B.V., C002 (row 3), C003 (row 4), C004 (row 5), C005 (row 8). Provenance shows TRUE worksheet row numbers (skips duplicate row 6 and null row 7 correctly). Warnings rendered: "1 row(s) skipped because the identity value is empty." and "1 duplicate identity value(s) skipped; only the first row is kept." Identity evidence: "customer_id: 83% unique · 86% populated in the sample" (matches data: 5/6 unique, 6/7 populated).
13. "Save mapping" → drawer closed, toast shown, editor state "All changes saved" (autosave unaffected).
14. Re-selected Organization → "Data sources (1)" shows customers.xlsx · Customers · identity: customer_id with Edit/Remove.
15. "Edit" → drawer reopened in edit mode: title "Edit source mapping", Concept + Sheet selects disabled (locked), all saved values restored, preview data present.
16. Cancel → "Remove" → "Data sources (0)", empty state restored.
17. Full page reload → model + concept persisted; repeated drawer open flow OK.
18. Responsive: 1680×900 desktop (3-column layout), 768×1024 tablet (inspector overlays right, canvas usable), 390×844 mobile (inspector full-width overlay, header wraps, no broken layout, page scrollable).
19. Keyboard/a11y spot checks: all drawer/combobox controls reachable and operable via clicks in a11y tree; combobox triggers expose aria-label ("Concept", "Sheet", "Identity", "Target field for X"); menu items have roles.

## Console (after reload, drawer exercised)
- 0 console errors. validateDOMNesting error seen pre-fix (Badge inside <p>) was fixed in SourceMappingDrawer.tsx (p → div) and verified gone after reload.
- Remaining non-error items: vite connect debug, React DevTools info, i18next info, React Router v7 future-flag warning (pre-existing app-wide), DevTools advisory issues "form field without id/name" (1) and "no label associated" (4) from Radix Select internals — advisory only, present app-wide.

## Network (selected)
- GET …/source-assets/:documentId/profile?workspaceId=… → 200 (sheets list)
- GET …/profile?workspaceId=…&sheetName=Customers → 200 with fields, sampleRows (with __sheetRow), totals; duration 109ms
- GET …/source-mappings → 200
- POST …/source-mappings → success (mapping created); DELETE …/source-mappings/:id → success (mapping removed)
- No 4xx/5xx during the whole flow except expected auth-gates before login. (Bearer tokens redacted.)

## Issues found & fixed during QA
- [minor][fixed] validateDOMNesting: Badge (div) inside <p> in drawer field name cell → changed wrapper to div. Verified clean.
- [major][fixed][round 2] POST /source-mappings returned 400 when the mapping contained Ignore entries (DTO required targetAttribute ≥1 char for all entries; first-pass save with only suggested mappings hit this). Fixed: DTO allows empty targetAttribute, service validates non-empty targets for direct/constant modes, drawer sends only non-ignored entries. Re-verified live: save with 2 ignored + 2 direct entries succeeds.
- [major][fixed][round 2] Stale preview data persisted across drawer open/target/sheet changes (mutation never reset). Fixed: preview.reset() on target change and concept/sheet change.
- [major][fixed][round 2] Failed profile fetch rendered no error (silent empty sheet list; reachable via >50 MB file). Fixed: inline destructive alert with backend message + Retry.
- [minor][fixed][round 2] Failed source-mappings list fetch showed the empty state. Fixed: error alert with retry in SourceMappingsSection.
- [hygiene][fixed][round 2] Removed qa-customers.xlsx.b64.txt from front/public (would ship into dist).

## Refutation of frontend-qa Finding 1 (revision conflict) — verified live
Claim: mapping save/delete bumps model revision → next canvas autosave hits ERR_3703 conflict.
Refutation: autosave graph-operations concurrency uses the VERSION revision (`semantic_model.versions.revision`; `SemanticGraphCommandService.apply` compares `versions.revision !== dto.expectedRevision` and bumps only the version), while mapping mutations bump the MODEL revision (`advanceRevision`). Separate counters; the mapping mutations never touch the version revision, and autosave never reads the model revision.
Live repro performed: mapping saved → immediately renamed the concept on canvas → autosave result "All changes saved" + indexing enqueued (no conflict dialog), twice (rename + rename back). Finding 1 is a false positive.

## Known unrelated observations (pre-existing)
- Header "Index failed"/"Indexing": semantic graph indexing depends on native search service (localhost:8045) which is not running in this env. Unrelated to this feature.
- health.playbookMcp:false — unrelated.
- Login with admin@yellowsys.fr + create_admin.js hash fails (DB hash differs from repo seed script) — ops note only.
