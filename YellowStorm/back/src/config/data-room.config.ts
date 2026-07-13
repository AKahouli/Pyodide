import { registerAs } from '@nestjs/config';

/** Controlled rollout switches for the Governed Data Room. All remain off by default. */
export default registerAs('dataRoom', () => ({
  governanceEnabled: process.env.DATA_ROOM_GOVERNANCE_ENABLED === 'true',
  sourceVersioningEnabled: process.env.DATA_ROOM_SOURCE_VERSIONING_ENABLED === 'true',
  workspaceEventsEnabled: process.env.DATA_ROOM_WORKSPACE_EVENTS_ENABLED === 'true',
  autoSourceCreationEnabled: process.env.DATA_ROOM_AUTO_SOURCE_CREATION_ENABLED === 'true',
  reconciliationEnabled: process.env.DATA_ROOM_RECONCILIATION_ENABLED === 'true',
  outboxDispatchEnabled: process.env.DATA_ROOM_OUTBOX_DISPATCH_ENABLED === 'true',
}));
