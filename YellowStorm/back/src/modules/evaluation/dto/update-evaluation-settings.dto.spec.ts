import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateEvaluationSettingsDto } from './update-evaluation-settings.dto';

const validSettings = {
  responseReliability: {
    enabled: true,
    mode: 'corrective_transparent',
    judgeModelId: 'judge-1',
    maxConcurrentEvaluations: 11,
    timeoutMs: 601_000,
    maxFindings: 11,
    correction: {
      threshold: 101,
      maxAttempts: 4,
      maxDurationMs: 60_000,
      allowAdditionalDocumentRetrieval: false,
      allowConnectorQueries: false,
      allowCalculationReruns: false,
      failureBehavior: 'publish_with_warning',
      showOriginalAnswer: true,
    },
  },
};

describe('UpdateEvaluationSettingsDto', () => {
  it('accepts values above the former maximums', async () => {
    const dto = plainToInstance(UpdateEvaluationSettingsDto, validSettings);

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('retains minimum and integer validation', async () => {
    const dto = plainToInstance(UpdateEvaluationSettingsDto, {
      responseReliability: {
        ...validSettings.responseReliability,
        maxConcurrentEvaluations: 0,
        timeoutMs: 5_000.5,
        maxFindings: 0,
        correction: {
          ...validSettings.responseReliability.correction,
          threshold: -1,
          maxAttempts: 0,
        },
      },
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].children).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'maxConcurrentEvaluations' }),
      expect.objectContaining({ property: 'timeoutMs' }),
      expect.objectContaining({ property: 'maxFindings' }),
      expect.objectContaining({
        property: 'correction',
        children: expect.arrayContaining([
          expect.objectContaining({ property: 'threshold' }),
          expect.objectContaining({ property: 'maxAttempts' }),
        ]),
      }),
    ]));
  });
});
