import { DEFAULT_ADMIN_EVALUATION_SETTINGS } from '@modules/evaluation/services/evaluation-settings.service';
import { ResponseCorrectionPolicyService } from './response-correction-policy.service';

describe('ResponseCorrectionPolicyService', () => {
  const service = new ResponseCorrectionPolicyService();
  const settings = {
    ...DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability,
    enabled: true,
    mode: 'corrective_transparent' as const,
  };

  it('corrects below threshold but not at the threshold', () => {
    expect(service.shouldCorrect(settings, { status: 'completed', score: 69 })).toBe(true);
    expect(service.shouldCorrect(settings, { status: 'completed', score: 70 })).toBe(false);
  });

  it.each(['unsupported', 'contradicted'] as const)('corrects a critical %s claim above threshold', (status) => {
    expect(service.shouldCorrect(settings, {
      status: 'completed', score: 95,
      claims: [{ claim: 'Critical', status, importance: 'critical', explanation: 'Material issue' }],
    })).toBe(true);
  });

  it('keeps minor unsupported claims above threshold and skips non-completed evaluations', () => {
    expect(service.shouldCorrect(settings, {
      status: 'completed', score: 95,
      claims: [{ claim: 'Minor', status: 'unsupported', importance: 'minor', explanation: 'Missing' }],
    })).toBe(false);
    expect(service.shouldCorrect(settings, { status: 'insufficient_evidence' })).toBe(false);
    expect(service.shouldCorrect(settings, { status: 'failed' })).toBe(false);
  });

  it('requires a non-regressing score and no critical issue for success', () => {
    expect(service.isSuccessfulCorrection({ status: 'completed', score: 80, claims: [] }, 70, 60, true)).toBe(true);
    expect(service.isSuccessfulCorrection({ status: 'completed', score: 59, claims: [] }, 70, 60, true)).toBe(false);
    expect(service.isSuccessfulCorrection({ status: 'completed', score: 80, claims: [{ claim: 'x', status: 'contradicted', importance: 'critical', explanation: 'x' }] }, 70, 60, true)).toBe(false);
  });
});
