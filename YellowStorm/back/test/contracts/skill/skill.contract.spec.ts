import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { SkillService } from '@modules/skill/skill.service';
import type { SkillRow } from '@modules/skill/persistence/skill.store';

const row: SkillRow = {
  id: '64b000000000000000000701',
  slug: 'doc-qa',
  name: 'doc-qa',
  description: 'Answer questions from documents',
  icon: 'book',
  color: '#000000',
  iconColor: 'light',
  categoryId: null,
  license: 'MIT',
  compatibility: 'any',
  metadata: { owner: 'platform' },
  allowedTools: ['search'],
  instructions: 'Use the search tool.',
  files: [{ id: 'f1', path: 'SKILL.md', kind: 'markdown', mimeType: 'text/markdown', content: '# skill', position: 0 }],
  isActive: true,
  createdBy: '64b000000000000000000001',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
} as SkillRow;

describe('skill response contract', () => {
  it('toResponse matches the fixture; file ids/positions are not exposed', () => {
    const body = toWire(callPrivate(SkillService, 'toResponse', [{ ...row, categoryName: 'General' }]));
    expectContract('skill/skill', body);
    expect(body.id).toBe(row.id);
    expect(body.files).toEqual([{ path: 'SKILL.md', kind: 'markdown', mimeType: 'text/markdown', content: '# skill' }]);
    expectNoMongoKeys(body);
    expectNoKeys(body, 'position');
  });
});
