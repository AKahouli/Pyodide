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

- **Tool**: name (unique), description, defaultAgentTypes, attributes, isActive
- **ToolAttribute**: name, type (string/number/boolean/enum), value, options (for enum)
- **AgentType**: manager, visualizer, simple
