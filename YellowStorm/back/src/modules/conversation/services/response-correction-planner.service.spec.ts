import { ResponseCorrectionPlannerService } from './response-correction-planner.service';

describe('ResponseCorrectionPlannerService', () => {
  it('maps unsupported claims and omits supported claims', () => {
    const instructions = new ResponseCorrectionPlannerService().build({
      status: 'completed',
      claims: [
        { claim: 'Good', status: 'supported', importance: 'minor', explanation: 'Matched' },
        { claim: 'Wrong', status: 'contradicted', importance: 'critical', explanation: 'Conflict', evidenceIds: ['e1'] },
        { claim: 'Broad', status: 'partially_supported', importance: 'major', explanation: 'Narrow it', evidenceIds: ['e2'] },
      ],
    });
    expect(instructions).toEqual([
      expect.objectContaining({ claim: 'Wrong', action: 'replace', allowedEvidenceIds: ['e1'] }),
      expect.objectContaining({ claim: 'Broad', action: 'qualify', allowedEvidenceIds: ['e2'] }),
    ]);
  });
});
