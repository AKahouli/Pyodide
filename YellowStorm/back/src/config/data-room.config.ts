import { registerAs } from '@nestjs/config';

/** Controlled rollout switches for the Governed Data Room. All remain off by default. */
export default registerAs('dataRoom', () => ({
  workspaceEventsEnabled: process.env.DATA_ROOM_WORKSPACE_EVENTS_ENABLED === 'true',
  governanceEventConsumerEnabled: process.env.DATA_ROOM_GOVERNANCE_EVENT_CONSUMER_ENABLED === 'true',
  outboxDispatchEnabled: process.env.DATA_ROOM_OUTBOX_DISPATCH_ENABLED === 'true',
  validityIntelligenceEnabled: process.env.DATA_ROOM_VALIDITY_INTELLIGENCE_ENABLED === 'true',
  knowledgeAssessmentEnabled: process.env.DATA_ROOM_KNOWLEDGE_ASSESSMENT_ENABLED === 'true',
}));
