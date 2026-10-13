import { loadFollowupEvidence, webCitationSource } from './root-followup-evidence';

it('retains safe public web links and citation identity through projection and sanitization', async () => {
  const records = [{ id: 'evidence', kind: 'citation', executionId: 'worker', producerAgentId: 'agent',
    payload: { type: 'web', source: 'https://sqlite.org/backup.html?token=credential#section', title: 'Live backup' } }];
  const tx = { select: () => ({ from: () => ({ where: async () => records }) }) };
  const result = await loadFollowupEvidence(tx as any, [{ id: 'worker', status: 'completed',
    resultPayload: { producerAgentId: 'agent', citationRefs: ['evidence'], artifactRefs: [] } }] as any);
  expect(result[0].component.data).toMatchObject({ sourceKind: 'web', sourceType: 'web', source: 'https://sqlite.org/backup.html', title: 'Live backup',
    evidenceId: 'evidence', executionId: 'worker', reference: '1', actorId: 'agent' });
  expect(JSON.stringify(result[0].component)).not.toContain('credential');
});

it.each(['javascript:alert(1)', 'https://user:password@example.com/page', '/private/file', 'not a URL'])(
  'does not expose unsafe web source %s', (source) => expect(webCitationSource({ type: 'web', source })).toBeNull());

it('does not turn a document URL into a web citation', () => {
  expect(webCitationSource({ type: 'text', filename: 'report.pdf', url: 'https://example.com' })).toBeNull();
});
