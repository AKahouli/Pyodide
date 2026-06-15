# Microsoft Excel MCP Server

FastMCP server providing Microsoft Excel tools via Microsoft Graph API.

## Status

🚧 **This is a placeholder implementation.** Excel tools are yet to be implemented.

## Planned Tools

| Tool | Description | Status |
|------|-------------|--------|
| `read_excel_workbook` | Read Excel workbook data | Not implemented |
| `write_excel_workbook` | Write data to Excel workbook | Not implemented |
| `query_excel_range` | Query specific ranges in Excel | Not implemented |
| `create_excel_workbook` | Create new Excel workbook | Not implemented |

## Setup

```bash
cd excel-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `M365_ACCESS_TOKEN` | Fallback access token (injected via header at runtime) |
| `EXCEL_MCP_TRANSPORT` | Transport type: `sse` (default), `http`, `streamable-http` |
| `EXCEL_MCP_PORT` / `PORT` | Server port (default: 8004) |
| `ALLOWED_ORIGINS` | CORS origins (default: `*`) |

## Running

```bash
python server.py
```

## Required Permissions

Configure these delegated permissions in your Azure AD app (when implemented):

- `Files.ReadWrite.All` - Read and write Excel files
- `Sites.ReadWrite.All` - Access Excel files in SharePoint

## Implementation Notes

To implement Excel tools, you will need to use the Microsoft Graph API's Excel REST API:

- [Excel REST API Documentation](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0)
- Use `/drives/{drive-id}/items/{item-id}/workbook` endpoint
- Support for ranges, tables, charts, and formulas
