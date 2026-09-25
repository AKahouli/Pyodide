# App Builder AI Module

NestJS module that governs **AI usage for generated App Builder apps**: global kill switch, per-user offers (RPM / token windows), admin APIs, and guards consumed by `AiProxyModule`.

LiteLLM credentials never leave the server — this module only decides *whether* and *how much* a billable user may call the AI Proxy.

## Responsibilities

| Concern | Implementation |
|---------|----------------|
| Kill switch | `AppBuilderAiKillSwitchGuard` + system setting |
| Offers (RPM, max tokens, window) | Postgres `catalog.app_builder_ai_offers` via `APP_BUILDER_AI_OFFER_STORE` |
| User ↔ offer link | `identity.users.app_builder_ai_offer_id` via `USER_STORE` |
| Usage windows | Postgres table via `AppBuilderAiUsageService` (migration `0016`) |
| Per-request limit | `AppBuilderAiUsageLimitGuard` |
| Admin CRUD / assign | `AdminAppBuilderAiController` + `AppBuilderAiAdminService` |
| Mode helpers | `utils/app-builder-ai-mode.ts` |

## Structure

```
app-builder-ai/
  app-builder-ai.module.ts
  constants.ts
  controllers/admin-app-builder-ai.controller.ts
  guards/
    app-builder-ai-kill-switch.guard.ts
    app-builder-ai-usage-limit.guard.ts
  persistence/
    app-builder-ai-offer.store.ts
    pg-app-builder-ai-offer.store.ts
  services/
    app-builder-ai-admin.service.ts
    app-builder-ai-offer.service.ts
    app-builder-ai-settings.service.ts
    app-builder-ai-usage.service.ts
  utils/app-builder-ai-mode.ts
  README.md
```

Registered from `app.module.ts`. Exported guards/services are imported by `AiProxyModule`.

## Auth billing model (with AI Proxy)

| Client token | Billable user | Extra gate |
|--------------|---------------|------------|
| Platform JWT | Same user | Kill switch + offer windows |
| App end-user JWT (`typ: app_end_user`) | App **owner** | End-user must have ACL `use_ai` (MS) or Nest-local `can_use_ai` |
| Preview ticket `aiprev_…` | Session owner | Ticket issued by conversation-v2 |

Remote App Data (`APP_DATA_REMOTE=true`): **MS ACL `action=use_ai`** is source of truth. Nest migration `0017` must **not** be applied on the MS control-plane DB.

See `YellowStorm/back/drizzle/MIGRATIONS-APP-BUILDER-AI.md`.

## Postgres cutover (P8)

- DDL: `drizzle/0027_app_builder_ai_offers.sql`
- Backfill (from `YellowStorm/back`, prefer before Nest boots so seed does not invent new ids):

```bash
npx ts-node scripts/migrate/2026-10-app-builder-ai-offers.ts
```

Seed defaults only run when `catalog.app_builder_ai_offers` is empty.

## Admin API (high level)

Base: `/api/v1/admin/app-builder-ai` (exact paths in controller; require admin permissions seeded in `authorization`).

Typical operations:

- Enable / disable global feature
- CRUD offers (RPM, token budget, window length)
- List / assign offers to users
- Peek usage status

Frontend: `YellowStorm/front/src/modules/admin/pages/AppBuilderAiPage.tsx`.

## Related

- AI Proxy: [`../ai-proxy/README.md`](../ai-proxy/README.md)
- Architecture: [`../../AI-PROXY-ARCHITECTURE.md`](../../AI-PROXY-ARCHITECTURE.md)
- Conversation AI flags: [`../conversation-v2/README.md`](../conversation-v2/README.md)
- Commit plan: [`../../../../COMMIT_SPLIT_APP_BUILDER_AI.md`](../../../../COMMIT_SPLIT_APP_BUILDER_AI.md)

## Tests

```bash
npm test -- --testPathPattern=app-builder-ai --no-coverage
```
