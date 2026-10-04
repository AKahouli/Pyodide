import { Types } from 'mongoose';
import type { AiMessageComponentsRecord } from '../persistence/message-store';
import { ChoiceInteractionService } from './choice-interaction.service';

describe('ChoiceInteractionService', () => {
  const conversationId = new Types.ObjectId().toString();
  const sourceMessageId = new Types.ObjectId().toString();
  const componentId = 'choice-1';
  let source: AiMessageComponentsRecord;
  let messageStore: { findAiComponents: jest.Mock };
  let service: ChoiceInteractionService;

  beforeEach(() => {
    source = {
      id: sourceMessageId,
      components: [
        {
          id: componentId,
          type: 'choice',
          data: {
            schemaVersion: 1,
            questionId: 'financial-analysis',
            prompt: 'Choose an analysis',
            description: 'Select every relevant analysis.',
            presentation: 'list',
            selectionMode: 'multiple',
            submitBehavior: 'explicit',
            status: 'ready',
            otherOption: { enabled: true, label: 'Other', maxLength: 500 },
            options: [
              {
                id: 'profitability',
                label: 'Profitability',
                submitText: 'Analyze profitability',
                description: 'Review margins and return.',
                value: 'profit',
              },
              {
                id: 'liquidity',
                label: 'Liquidity',
                submitText: 'Analyze liquidity',
                description: 'Review short-term obligations.',
                value: 'liquid',
              },
            ],
          },
        },
      ],
    };
    messageStore = { findAiComponents: jest.fn(async () => source) };
    service = new ChoiceInteractionService(messageStore as never);
  });

  it('builds server-authoritative content with every selected description in source order', async () => {
    const result = await service.canonicalize(conversationId, {
      type: 'choice',
      componentId,
      questionId: 'financial-analysis',
      sourceMessageId,
      selectionMode: 'multiple',
      selectedOptions: [
        { optionId: 'liquidity', label: 'Spoofed liquidity', value: 'spoofed' },
        { optionId: 'profitability', label: 'Spoofed profitability' },
      ],
      customAnswer: 'Focus on Q4',
      displayText: 'Spoofed display text',
    });

    expect(JSON.parse(result.content)).toEqual({
      question: {
        prompt: 'Choose an analysis',
        description: 'Select every relevant analysis.',
      },
      selectedChoices: [
        {
          optionId: 'profitability',
          submitText: 'Analyze profitability',
          description: 'Review margins and return.',
        },
        {
          optionId: 'liquidity',
          submitText: 'Analyze liquidity',
          description: 'Review short-term obligations.',
        },
      ],
      alternativeResponse: 'Focus on Q4',
      dismissed: false,
    });
    expect(result.taskSummary).toBe('Profitability, Liquidity, Focus on Q4');
    expect(messageStore.findAiComponents).toHaveBeenCalledWith(conversationId, sourceMessageId);
    expect(result.interaction).toMatchObject({
      selectedOptions: [
        { optionId: 'profitability', label: 'Profitability', value: 'profit' },
        { optionId: 'liquidity', label: 'Liquidity', value: 'liquid' },
      ],
      customAnswer: 'Focus on Q4',
      displayText: 'Profitability, Liquidity, Focus on Q4',
    });
  });

  it('uses explicit nulls for absent descriptions and alternative text', async () => {
    const data = source.components[0].data;
    data.description = undefined;
    data.options = [
      { id: 'profitability', label: 'Profitability', submitText: 'Analyze profitability' },
      { id: 'liquidity', label: 'Liquidity', submitText: 'Analyze liquidity' },
    ];

    const result = await service.canonicalize(conversationId, {
      type: 'choice',
      componentId,
      questionId: 'financial-analysis',
      sourceMessageId,
      selectionMode: 'multiple',
      selectedOptions: [{ optionId: 'profitability', label: 'Ignored' }],
    });

    expect(JSON.parse(result.content)).toEqual({
      question: { prompt: 'Choose an analysis', description: null },
      selectedChoices: [
        { optionId: 'profitability', submitText: 'Analyze profitability', description: null },
      ],
      alternativeResponse: null,
      dismissed: false,
    });
  });

  it('preserves question context when the interaction is dismissed', async () => {
    const data = source.components[0].data;
    data.dismissible = true;
    data.labels = { dismiss: 'Passer cette question' };

    const result = await service.canonicalize(conversationId, {
      type: 'choice',
      componentId,
      questionId: 'financial-analysis',
      sourceMessageId,
      selectionMode: 'multiple',
      selectedOptions: [],
      dismissed: true,
    });

    expect(JSON.parse(result.content)).toEqual({
      question: {
        prompt: 'Choose an analysis',
        description: 'Select every relevant analysis.',
      },
      selectedChoices: [],
      alternativeResponse: null,
      dismissed: true,
    });
    expect(result.taskSummary).toBe('Passer cette question');
    expect(result.interaction).toMatchObject({
      dismissed: true,
      displayText: 'Passer cette question',
    });
  });

  it('normalizes and bounds long task summaries without changing canonical content', async () => {
    const customAnswer = `A custom response with\n extra spacing ${'x'.repeat(150)}`;

    const result = await service.canonicalize(conversationId, {
      type: 'choice',
      componentId,
      questionId: 'financial-analysis',
      sourceMessageId,
      selectionMode: 'multiple',
      selectedOptions: [],
      customAnswer,
    });

    expect(result.taskSummary).toHaveLength(120);
    expect(result.taskSummary).toMatch(/^A custom response with extra spacing/);
    expect(result.taskSummary).toMatch(/\.\.\.$/);
    expect(JSON.parse(result.content).alternativeResponse).toBe(customAnswer.trim());
  });

  it('canonicalizes multiple interactions into one combined payload', async () => {
    const secondComponentId = 'choice-2';
    source.components = [
      ...source.components,
      {
        id: secondComponentId,
        type: 'choice',
        data: {
          schemaVersion: 1,
          questionId: 'region',
          prompt: 'Pick a region',
          presentation: 'list',
          selectionMode: 'single',
          submitBehavior: 'explicit',
          status: 'ready',
          options: [
            { id: 'france', label: 'France', submitText: 'Use France' },
            { id: 'germany', label: 'Germany', submitText: 'Use Germany' },
          ],
        },
      },
    ];

    const result = await service.canonicalizeMany(conversationId, [
      {
        type: 'choice',
        componentId,
        questionId: 'financial-analysis',
        sourceMessageId,
        selectionMode: 'multiple',
        selectedOptions: [{ optionId: 'profitability', label: 'Profitability' }],
      },
      {
        type: 'choice',
        componentId: secondComponentId,
        questionId: 'region',
        sourceMessageId,
        selectionMode: 'single',
        selectedOptions: [{ optionId: 'germany', label: 'Germany' }],
      },
    ]);

    const content = JSON.parse(result.content) as Record<string, unknown>[];
    expect(content).toHaveLength(2);
    expect(content[0].selectedChoices).toEqual([
      {
        optionId: 'profitability',
        submitText: 'Analyze profitability',
        description: 'Review margins and return.',
      },
    ]);
    expect(content[1].selectedChoices).toEqual([
      { optionId: 'germany', submitText: 'Use Germany', description: null },
    ]);
    expect(result.taskSummary).toBe('Profitability, Germany');
    expect(result.interactions).toHaveLength(2);
    expect(result.interactions[0]).toMatchObject({ componentId, questionId: 'financial-analysis' });
    expect(result.interactions[1]).toMatchObject({
      componentId: secondComponentId,
      questionId: 'region',
    });
  });

  it('rejects an invalid interaction inside a multi-submission', async () => {
    const result = service.canonicalizeMany(conversationId, [
      {
        type: 'choice',
        componentId,
        questionId: 'financial-analysis',
        sourceMessageId,
        selectionMode: 'multiple',
        selectedOptions: [{ optionId: 'profitability', label: 'Profitability' }],
      },
      {
        type: 'choice',
        componentId: 'missing-component',
        questionId: 'region',
        sourceMessageId,
        selectionMode: 'single',
        selectedOptions: [{ optionId: 'germany', label: 'Germany' }],
      },
    ]);

    await expect(result).rejects.toMatchObject({ status: 400 });
  });
});
