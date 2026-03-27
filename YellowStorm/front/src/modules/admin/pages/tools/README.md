# Tools Admin Pages

Admin interface for managing agent tools.

## Components

- **ToolsPage** - Main page with tools list, search, pagination, and CRUD operations
- **CreateEditToolDialog** - Shared dialog for creating and editing tools with form validation
- **AttributeBuilder** - Dynamic form for managing tool attributes with type-aware value inputs

## Form Validation

Uses Zod schema (`tool-form-schema.ts`) with cross-field validation:
- Attribute values must match their declared type
- Enum attributes require options and value must be in options list
