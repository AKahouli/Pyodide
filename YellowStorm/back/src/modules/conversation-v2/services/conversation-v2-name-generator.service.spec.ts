import { Test } from '@nestjs/testing';
import { ChatCompletionService } from '@modules/chat-completion';
import { ModelsService } from '@modules/models/models.service';
import { ConversationV2NameGeneratorService } from './conversation-v2-name-generator.service';

describe('ConversationV2NameGeneratorService', () => {
  let svc: ConversationV2NameGeneratorService;
  let completeText: jest.Mock;
  let findByIdOrLitellmModel: jest.Mock;
  let getConversationV2DefaultModel: jest.Mock;
  let getDefaultModel: jest.Mock;

  beforeEach(async () => {
    completeText = jest.fn();
    findByIdOrLitellmModel = jest.fn();
    getConversationV2DefaultModel = jest.fn().mockResolvedValue(null);
    getDefaultModel = jest.fn().mockResolvedValue(null);

    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2NameGeneratorService,
        { provide: ChatCompletionService, useValue: { completeText } },
        {
          provide: ModelsService,
          useValue: {
            findByIdOrLitellmModel,
            getConversationV2DefaultModel,
            getDefaultModel,
          },
        },
      ],
    }).compile();
    svc = mod.get(ConversationV2NameGeneratorService);
  });

  it('resolves preferred LiteLLM id and returns the sanitized LLM title', async () => {
    findByIdOrLitellmModel.mockResolvedValueOnce({ id: 'azure/gpt-4.1' });
    completeText.mockResolvedValueOnce('"Finance Dashboard App"');

    await expect(svc.generate('Build a finance dashboard', 'azure/gpt-4.1')).resolves.toBe(
      'Finance Dashboard App',
    );
    expect(findByIdOrLitellmModel).toHaveBeenCalledWith('azure/gpt-4.1');
    expect(completeText).toHaveBeenCalledWith(
      'Build a finance dashboard',
      expect.objectContaining({ modelId: 'azure/gpt-4.1' }),
    );
  });

  it('falls back to conversation-v2 default when preferred model is unknown', async () => {
    findByIdOrLitellmModel.mockResolvedValueOnce(null);
    getConversationV2DefaultModel.mockResolvedValueOnce({ id: 'opencode/deepseek' });
    completeText.mockResolvedValueOnce('Task Tracker');

    await expect(svc.generate('Make a todo app', 'unknown/model')).resolves.toBe('Task Tracker');
    expect(getConversationV2DefaultModel).toHaveBeenCalled();
    expect(getDefaultModel).not.toHaveBeenCalled();
  });

  it('uses a clipped message when no model is available', async () => {
    await expect(
      svc.generate('Créer une application de gestion des stocks pour mon magasin'),
    ).resolves.toBe('Créer une application de gestion des stocks');
    expect(completeText).not.toHaveBeenCalled();
  });

  it('uses message fallback when the LLM call fails', async () => {
    findByIdOrLitellmModel.mockResolvedValueOnce({ id: 'm1' });
    completeText.mockRejectedValueOnce(new Error('litellm down'));

    await expect(svc.generate('CRM pour les ventes')).resolves.toBe('CRM pour les ventes');
  });
});
