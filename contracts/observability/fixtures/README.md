# Observability fixtures

Shared by both SDKs (`packages/observability-ts`, `packages/observability-python`) for conformance testing. Same files, same expectations — parity is proven by CI, not by convention.

- `valid/` — complete events that MUST pass `log-event.v1.schema.json`.
- `invalid/` — events that MUST fail schema validation. The filename names the violated rule.
- `hostile/` — SDK **input** scenarios (values that cannot be represented as JSON): each file describes the input and the expected behavior (`does_not_throw`, byte cap, single-line output). SDK tests construct the actual values programmatically.

Rules for changes:

1. A fixture change is a contract change: update the schema/registry and both SDKs in the same commit.
2. Never add real user data, credentials, prompts, or production log excerpts.
3. `invalid/` fixtures must stay invalid — do not "fix" them.
