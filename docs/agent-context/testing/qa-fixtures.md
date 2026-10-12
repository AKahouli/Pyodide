# QA accounts, fixtures, and regressions

Use existing helpers before creating another fixture system. Match the task's
acceptance criteria to the required role and smallest observable dataset.

| Area | Existing entry point | Ownership |
| --- | --- | --- |
| Browser smoke tests | [E2E README](../../../YellowStorm/front/tests/e2e/README.md) | one unique run ID per CLI run |
| Browser auth/artifacts | [Run context](../../../YellowStorm/front/tests/e2e/run-context.ts), [auth setup](../../../YellowStorm/front/tests/e2e/auth.setup.ts) | independent state/report paths per run; credentials supplied externally |
| Worky records | [Fixtures](../../../YellowStorm/front/tests/e2e/fixtures.ts) | fresh stream per spec, scoped teardown |
| Frontend behavioral tests | [Verification reference](../frontend/verification.md) | colocated tests; module `test-utils.ts` where present |

## Browser QA handoff

Supply a unique QA run ID, application origin/environment, required account
role, confirmed non-secret login recipe if available, acceptance IDs, owned
record IDs/names, and cleanup action. The primary agent prepares routine data;
frontend QA returns missing access or state as an actionable blocker. Keep
context/page IDs in the current task for resume.

Every QA task creates its own named isolated browser context and routes calls
by owned page ID. Independent OpenCode processes also use temporary profiles.
New private contexts may need sign-in. Never import another session's cookies,
tokens, storage, or authentication file to avoid that step.

Accounts must exist in the agreed test environment with the role being tested.
Remember only the account alias/role, method, credential-store reference, and
verified login recipe; keep secrets in their existing credential store or
externally supplied environment. Browser isolation does not isolate backend
account state: use separate accounts/tenants for account-wide mutations or
serialize them. No new account has been provisioned by this harness change.

## Data and regression lifecycle

Create only the smallest run-owned dataset through an existing helper or
approved application flow. Use a unique namespace, preserve stable fixture
shape, and clean up only owned records. Retain data needed for user testing
until the user/primary releases it; do not run a global reset while other QA
tasks are active.

For a confirmed user-reported defect, retain a concise reproduction and add or
extend the narrowest behavioral regression test. Demonstrate fail-before and
pass-after when feasible. If automation is impractical, state the remaining
manual coverage. Run only affected tests/browser criteria plus a relevant
adjacent flow. Persist the verified cause and evidence in experience memory;
durable fixture instructions belong in Git.
