import { Test, TestingModule } from '@nestjs/testing';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from '../services/telegram-webhook.service';

describe('TelegramWebhookController', () => {
  let controller: TelegramWebhookController;

  const mockWebhookService = {
    validateAndDispatch: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelegramWebhookController],
      providers: [
        {
          provide: TelegramWebhookService,
          useValue: mockWebhookService,
        },
      ],
    }).compile();

    controller = module.get<TelegramWebhookController>(TelegramWebhookController);
  });

  it('delegates webhook validation and processing', async () => {
    const payload = { update_id: 1, message: { text: 'hi', chat: { id: 123 } } };
    mockWebhookService.validateAndDispatch.mockResolvedValue(undefined);

    const result = await controller.receiveWebhook(
      'integration-1',
      'secret',
      payload as any,
    );

    expect(mockWebhookService.validateAndDispatch).toHaveBeenCalledWith(
      'integration-1',
      'secret',
      payload,
    );
    expect(result).toEqual({ ok: true });
  });
});
