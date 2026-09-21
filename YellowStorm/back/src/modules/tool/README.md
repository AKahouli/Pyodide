# Tool Module

Manages tools that can be assigned to agents. Provides CRUD operations for admin users.

## Endpoints

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/admin/tools` | tools.read | List tools (paginated, filterable) |
| GET | `/admin/tools/:id` | tools.read | Get tool by ID |
| POST | `/admin/tools` | tools.create | Create tool |
| PATCH | `/admin/tools/:id` | tools.update | Update tool |
| DELETE | `/admin/tools/:id` | tools.delete | Delete tool |

## Schema

- **Tool** (`catalog.tools`, `TOOL_STORE` -> `PgToolStore`): name (unique), description, defaultAgentTypes, attributes, isActive
- **ToolAttribute**: stored in the `attributes` `jsonb` column of the tool: name, type (string/number/boolean/enum), value, options (for enum). Tool categories live in `catalog.tool_categories` (`TOOL_CATEGORY_STORE` -> `PgToolCategoryStore`, unique name)
- **AgentType**: manager, visualizer, simple
