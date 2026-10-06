# contracts/observability

Shared observability contract for Yellowmind unified logging. See `docs/observability/logging-contract.md` for the developer-facing contract; the JSON files here are normative.

Contents: `log-event.v1.schema.json`, `log-events.v1.json`, `budgets.v1.json`, `severity.v1.json`, `redaction.v1.json`, `service-registry.json`, `fixtures/`.

Both SDKs (`packages/observability-ts`, `packages/observability-python`) validate themselves against the same fixtures in CI.
