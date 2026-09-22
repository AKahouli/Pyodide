import { registerAs } from '@nestjs/config';

export default registerAs('dataRoom', () => ({
  governanceEventConsumerEnabled: process.env.DATA_ROOM_GOVERNANCE_EVENT_CONSUMER_ENABLED === 'true',
}));
