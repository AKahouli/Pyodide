import { WorkyMessageSchema } from './worky-message.schema';

describe('WorkyMessageSchema', () => {
  it('indexes due WhatsApp delivery work', () => {
    expect(WorkyMessageSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          {
            'whatsappDelivery.status': 1,
            'whatsappDelivery.nextAttemptAt': 1,
            'whatsappDelivery.leaseExpiresAt': 1,
          },
          expect.any(Object),
        ],
      ]),
    );
  });
});
