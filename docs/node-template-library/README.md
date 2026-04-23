# Node Template Library

> **Slug:** `node-template-library` | **Status:** 🚧 draft | **Last Updated:** 2026-04-22 00:00 UTC

## Purpose
The Node Template Library provides a DB-backed CRUD catalog for playbook node templates. It replaces the previous hardcoded static registry so templates can be managed in Admin > Playbook and consumed at runtime by the playbook canvas toolbar.

## Scope
- Includes backend persistence, validation, caching, lazy seeding, and public/admin API endpoints for playbook node templates.
- Includes the admin UI for creating, editing, and deleting templates, plus runtime loading in the playbook canvas toolbar.
- Excludes playbook execution logic beyond consuming template metadata when a node is added.

## Architecture
### Data flow
1. Admin users manage templates through `YellowStorm/front/src/modules/admin/pages/PlaybookPromptsPage.tsx`.
2. CRUD requests are sent through `YellowStorm/front/src/modules/admin/api.ts` to backend admin controllers.
3. The backend persists templates in MongoDB using the `playbook-node-templates` schema and service.
4. A public runtime endpoint returns enabled templates for the playbook canvas toolbar.
5. The frontend playbook store caches runtime templates for 30 seconds and maps them into `TaskTemplate` data used by the toolbar.

### Backend modules
- `YellowStorm/back/src/modules/playbook/schemas/playbook-node-template.schema.ts`
- `YellowStorm/back/src/modules/playbook/interfaces/playbook-node-template.interface.ts`
- `YellowStorm/back/src/modules/playbook/dto/create-playbook-node-template.dto.ts`
- `YellowStorm/back/src/modules/playbook/dto/update-playbook-node-template.dto.ts`
- `YellowStorm/back/src/modules/playbook/services/playbook-node-template.service.ts`
- `YellowStorm/back/src/modules/playbook/controllers/admin-playbook-node-templates.controller.ts`
- `YellowStorm/back/src/modules/playbook/controllers/playbook-node-templates.controller.ts`
- `YellowStorm/back/src/modules/playbook/playbook.module.ts`

### Frontend modules
- `YellowStorm/front/src/modules/playbook/api.ts`
- `YellowStorm/front/src/modules/playbook/store.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasFloatingToolbar.tsx`
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/front/src/modules/admin/pages/PlaybookPromptsPage.tsx`
- `YellowStorm/front/src/modules/admin/api.ts`
- `YellowStorm/front/src/modules/admin/types.ts`
- `YellowStorm/front/src/lib/api/config.ts`

## Requirements
- As an admin, I want to create and manage node templates so that playbook authors can add reusable nodes without code changes.
- As a playbook author, I want the canvas toolbar to load enabled templates at runtime so that template availability reflects current admin configuration.
- [ ] Admin CRUD must support list, create, update, and delete for node templates.
- [ ] Runtime template reads must return enabled templates only.
- [ ] Built-in templates must be lazily seeded on first service access.
- [ ] Template keys must be auto-generated from title and treated as read-only in the admin UI.
- [ ] The frontend must invalidate its runtime template cache after admin CRUD changes.

## API / Interfaces
### Admin CRUD
- `GET /admin/playbook-node-templates`
- `GET /admin/playbook-node-templates/:id`
- `POST /admin/playbook-node-templates`
- `PATCH /admin/playbook-node-templates/:id`
- `DELETE /admin/playbook-node-templates/:id`

### Runtime read
- `GET /playbook-node-templates`

### Key response fields
- Canonical `id` comes from MongoDB `_id`.
- `key` is the stable slug derived from the title.
- `type` is auto-set to the slugified key and is not exposed as a user-editable field in the admin UI.
- Template ports use subdocuments without MongoDB-generated `_id` values.

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Separate admin CRUD and public runtime endpoints | Admin needs full control while the runtime needs a minimal enabled-only read path. | A single endpoint with role-based branching. |
| Use MongoDB `_id` as canonical `id` | Keeps persistence identity aligned with the database and avoids overloading the slug key. | Using `key` as the primary identifier. |
| Auto-generate `key` from title and keep it read-only | Ensures stable, predictable template slugs and avoids manual drift. | Allowing users to edit the key directly. |
| Set `type` to the slugified key | Preserves a deterministic internal type value without exposing another editable field. | Maintaining a separate editable `type` field. |
| Lazy seed built-in templates on first service access | Avoids module-init side effects while still guaranteeing defaults exist when needed. | Seeding during application bootstrap. |
| Cache runtime templates for 30 seconds in both backend and frontend | Reduces repeated reads while keeping template updates responsive. | No cache or a longer-lived cache. |
| Strip port `_id` values from nested subdocuments | Prevents Mongoose validation/save issues for port arrays. | Allowing default subdocument `_id` generation. |

## Related Features
- [`playbook`](/docs/playbook/README.md)
- [`conversation`](/docs/conversation/README.md)
- [`connectors`](/docs/connectors/README_2026-04-14_23-00-00.md)
