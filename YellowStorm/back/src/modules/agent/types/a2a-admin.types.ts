/**
 * Type definitions for the A2A admin gRPC client surface.
 *
 * The gRPC client speaks the snake_case wire format (proto-loader is configured
 * with `keepCase: true`); these interfaces expose a camelCase API to the rest of
 * the NestJS module. The client is responsible for translating between the two.
 */

/**
 * Mirror of the proto `chatbot.Agent` message (the payload of PublishAgent).
 * Fields use snake_case to match the wire format expected by proto-loader.
 * Marked permissive for now — the controller/wiring layer will populate it from
 * the persisted Agent document when we hook everything up.
 */
export interface ChatbotAgentInput {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
  tools?: unknown[];
  brain_context?: unknown[];
  chatbot?: { model?: string };
  agent_params?: { params?: Record<string, string> };
  agent_type?: string;
  save_memory?: boolean;
  skills?: unknown[];
  [key: string]: unknown;
}

export interface PublishAgentResult {
  agentId: string;
  url: string;
  agentCardUrl: string;
  apiKey: string;
  apiKeyHeader: string;
}

export interface RotateKeyResult {
  agentId: string;
  apiKey: string;
  apiKeyHeader: string;
}

export interface SetAgentEnabledResult {
  agentId: string;
  enabled: boolean;
}

export interface GetAgentResult {
  found: boolean;
  agentId: string;
  name: string;
  enabled: boolean;
  apiKeyPrefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface A2AAdminHealthStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  grpcUrl: string;
}
