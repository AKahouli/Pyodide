/**
 * Error thrown by runtime tool handlers. `code` is a JSON-RPC / MCP numeric
 * code so it can be forwarded verbatim in a `tool.failed` payload.
 */
export class ToolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
