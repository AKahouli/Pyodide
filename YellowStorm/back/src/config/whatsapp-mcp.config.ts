import { registerAs } from '@nestjs/config';

/**
 * Credentials for the standalone WhatsApp Send MCP façade.
 * `jwtPrivateKey` (RS256 PEM) signs the per-run Bearer JWT injected into the
 * connector's auth_headers; the MCP server verifies it with the matching
 * public key (`MCP_JWT_PUBLIC_KEY` on the MCP side) and never trusts an
 * agentId coming from tool arguments.
 */
export default registerAs('whatsappMcp', () => ({
  jwtPrivateKey: process.env.WHATSAPP_MCP_JWT_PRIVATE_KEY || '',
  connectorSlug: process.env.WHATSAPP_MCP_CONNECTOR_SLUG || 'mcp-whatsapp',
  tokenTtlSeconds: Number.parseInt(process.env.WHATSAPP_MCP_TOKEN_TTL_SECONDS || '300', 10),
}));
