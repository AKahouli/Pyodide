/** Multi-provider port for agent-delete channel teardown (plan 4.6). */
export const CHANNEL_TEARDOWN = Symbol('CHANNEL_TEARDOWN');

export interface ChannelTeardown {
  /** Best-effort channel cleanup for a soon-to-be-deleted agent. Must not throw. */
  deleteForAgent(agentId: string): Promise<void>;
}
