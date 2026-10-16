---
id: ADR-0004
status: accepted
scope: browser-isolation-and-regression-testing
source_paths:
  - AGENTS.md
  - YellowStorm/front/playwright.config.ts
  - YellowStorm/front/tests/e2e/run-context.ts
  - YellowStorm/front/tests/e2e/fixtures.ts
supersedes: ADR-0003 persistent/shared-browser-profile policy only
reviewed_at: 2026-10-12
---

# Private browser QA and reusable regression fixtures

## Decision

Each frontend QA task owns a named isolated browser context and explicitly
routes page-scoped tools using its owned page ID. MCP `--isolated` gives
independent OpenCode processes temporary Chrome profiles. Reuse context/pages
only for the same task's follow-up, authentication wait, or user testing; do
not adopt or close another task's tabs. Unsupported isolation is a blocker,
never a reason to fall back to a shared browser context.

This supersedes ADR-0003's shared persistent-profile choice. Its clarification,
task autonomy, phase choice, and non-secret memory rules remain in effect.
Remember reusable login recipes and credential-store references; new private
contexts may still need authentication. Never transfer raw browser auth state
between concurrent QA tasks.

Confirmed user-reported defects receive focused behavioral regression tests
with fail-before/pass-after evidence when feasible. Reuse existing fixture
helpers and approved test accounts. Allocate independent auth/report paths
and namespaced records per concurrent run; use separate accounts/tenants or
serialize flows that mutate account-wide state. Cleanup affects owned records
only. See [fixture guidance](../../../../docs/agent-context/testing/qa-fixtures.md).

## Rationale

A shared profile or selected tab can make concurrent agents overwrite each
other's navigation, login, and test evidence. Separate browser storage plus
explicit routing prevents accidental overlap. Existing Playwright helpers
already create and clean up records; per-run auth and artifact paths remove
cross-run file races without introducing another fixture framework.

## Verification

Load the effective MCP configuration and check isolation/page-ID routing.
Run concurrent MCP clients and distinct named contexts against a synthetic
local page; confirm independent browser storage and routing despite changes
to the selected tab. Check concurrent Playwright configuration loads use
different auth/artifact paths and discover the existing suite. Actual test
accounts, application sign-in, and product E2E coverage require the agreed
running test environment.
