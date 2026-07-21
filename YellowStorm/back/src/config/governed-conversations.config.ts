import { registerAs } from '@nestjs/config';

export default registerAs('governedConversations', () => ({
  enabled: process.env.GOVERNED_CONVERSATIONS_ENABLED === 'true',
  audienceEnabled: process.env.GOVERNANCE_SCOPE_AUDIENCE_ENABLED === 'true',
  carouselEnabled: process.env.GOVERNED_SCOPE_CAROUSEL_ENABLED === 'true',
}));
