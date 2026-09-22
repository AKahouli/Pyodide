import { registerAs } from '@nestjs/config';

export default registerAs('agentMcp', () => ({
  mcpServerUrl: process.env.AGENT_MCP_SERVER_URL ?? 'http://localhost:8026/mcp',
  mcpIngressToken: process.env.AGENT_MCP_INGRESS_TOKEN ?? '',
}));
