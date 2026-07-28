import { ResponseReliabilityScoringService } from './response-reliability-scoring.service';

describe('ResponseReliabilityScoringService', () => {
  const service = new ResponseReliabilityScoringService();

  it('scores fully supported claims at 100', () => {
    const result = service.scoreClaims([
      { claim: 'A', status: 'supported', importance: 'critical', explanation: 'Supported' },
      { claim: 'B', status: 'supported', importance: 'minor', explanation: 'Supported' },
    ], 5);
    expect(result.score).toBe(100);
    expect(result.label).toBe('strongly_supported');
    expect(result.findings).toEqual([]);
  });

  it('weights partial support and caps a critical contradiction', () => {
    const mixed = service.scoreClaims([
      { claim: 'A', status: 'supported', importance: 'major', explanation: 'Supported' },
      { claim: 'B', status: 'partially_supported', importance: 'major', explanation: 'Partial' },
    ], 5);
    expect(mixed.score).toBe(75);
    expect(mixed.label).toBe('mostly_supported');

    const contradicted = service.scoreClaims([
      { claim: 'A', status: 'contradicted', importance: 'critical', explanation: 'Conflict' },
      { claim: 'B', status: 'supported', importance: 'critical', explanation: 'Supported' },
      { claim: 'C', status: 'supported', importance: 'critical', explanation: 'Supported' },
    ], 5);
    expect(contradicted.score).toBe(39);
    expect(contradicted.label).toBe('high_hallucination_risk');
  });

  it('sorts and limits negative findings deterministically', () => {
    const result = service.scoreClaims([
      { claim: 'partial', status: 'partially_supported', importance: 'critical', explanation: 'Partial' },
      { claim: 'unsupported', status: 'unsupported', importance: 'minor', explanation: 'Missing' },
      { claim: 'contradicted', status: 'contradicted', importance: 'major', explanation: 'Conflict' },
    ], 2);
    expect(result.findings.map((finding) => finding.claim)).toEqual(['contradicted', 'unsupported']);
  });
});
