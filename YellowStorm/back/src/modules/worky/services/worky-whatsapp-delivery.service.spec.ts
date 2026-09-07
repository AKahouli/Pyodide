import { Types } from 'mongoose';
import { WorkyWhatsAppDeliveryService } from './worky-whatsapp-delivery.service';

describe('WorkyWhatsAppDeliveryService', () => {
  const messageId = new Types.ObjectId();
  const streamId = new Types.ObjectId();
  const claimed = (attempts = 1) => ({
    _id: messageId,
    streamId,
    role: 'manager',
    content: 'Can you clarify?',
    whatsappDelivery: { status: 'processing', attempts, leaseToken: 'lease-1' },
  });

  const build = () => {
    const messages = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) }),
    };
    const whatsapp = {
      forwardManagerMessage: jest.fn().mockResolvedValue('sent'),
    };
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    };
    const service = new WorkyWhatsAppDeliveryService(
      messages as never,
      whatsapp as never,
      logger as never,
    );
    return { service, messages, whatsapp, logger };
  };

  it('atomically claims and marks a manager message delivered', async () => {
    const { service, messages, whatsapp } = build();
    messages.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve(claimed()) });

    await service.attempt(messageId);

    expect(whatsapp.forwardManagerMessage).toHaveBeenCalledWith(
      streamId.toString(),
      'Can you clarify?',
    );
    expect(messages.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: messageId,
        'whatsappDelivery.status': 'processing',
        'whatsappDelivery.leaseToken': 'lease-1',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ 'whatsappDelivery.status': 'delivered' }),
      }),
    );
  });

  it('allows only one concurrent claimant to send', async () => {
    const { service, messages, whatsapp } = build();
    messages.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.resolve(claimed()) })
      .mockReturnValueOnce({ exec: () => Promise.resolve(null) });

    await Promise.all([service.attempt(messageId), service.attempt(messageId)]);

    expect(whatsapp.forwardManagerMessage).toHaveBeenCalledTimes(1);
  });

  it('persists retry state after a transient send failure', async () => {
    const { service, messages, whatsapp, logger } = build();
    messages.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve(claimed(2)) });
    whatsapp.forwardManagerMessage.mockRejectedValueOnce(new Error('socket offline'));

    await expect(service.attempt(messageId)).resolves.toBeUndefined();

    expect(messages.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'whatsappDelivery.leaseToken': 'lease-1' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'whatsappDelivery.status': 'failed',
          'whatsappDelivery.lastError': 'socket offline',
          'whatsappDelivery.nextAttemptAt': expect.any(Date),
        }),
      }),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('times out a hung provider call and schedules a retry', async () => {
    jest.useFakeTimers();
    try {
      const { service, messages, whatsapp } = build();
      messages.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve(claimed()) });
      whatsapp.forwardManagerMessage.mockReturnValue(new Promise(() => undefined));

      const attempt = service.attempt(messageId);
      await jest.advanceTimersByTimeAsync(30_000);
      await attempt;

      expect(messages.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ 'whatsappDelivery.leaseToken': 'lease-1' }),
        expect.objectContaining({
          $set: expect.objectContaining({
            'whatsappDelivery.status': 'failed',
            'whatsappDelivery.lastError': 'Worky WhatsApp delivery timed out',
          }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks messages skipped when no WhatsApp group is configured', async () => {
    const { service, messages, whatsapp } = build();
    messages.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve(claimed()) });
    whatsapp.forwardManagerMessage.mockResolvedValueOnce('not_configured');

    await service.attempt(messageId);

    expect(messages.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ 'whatsappDelivery.status': 'skipped' }),
      }),
    );
  });

  it('includes expired processing leases in the atomic claim', async () => {
    const { service, messages } = build();
    messages.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve(null) });

    await service.attempt(messageId);

    expect(messages.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({
            'whatsappDelivery.status': 'processing',
            'whatsappDelivery.leaseExpiresAt': expect.any(Object),
          }),
        ]),
      }),
      expect.anything(),
      expect.objectContaining({ new: true }),
    );
  });
});
