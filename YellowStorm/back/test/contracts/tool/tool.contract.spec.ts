import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys } from '../wire-helpers';
import { ToolService } from '@modules/tool/tool.service';
import type { ToolRow } from '@modules/tool/persistence/tool.store';

const row: ToolRow = {
  id: '64b000000000000000000601',
  name: 'web_search',
  description: 'Search the web',
  icon: 'search',
  color: '#ffcc00',
  iconColor: 'dark',
  categoryId: '64b000000000000000000602',
  defaultAgentTypes: ['64b000000000000000000603'],
  attributes: [{ id: 'a1', name: 'maxResults', type: 'number', value: 5 }],
  requiredAppKey: 'microsoft',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('tool response contract', () => {
  it('toToolResponse matches the fixture', () => {
    const body = toWire(callPrivate(ToolService, 'toToolResponse', [row]));
    expectContract('tool/tool', body);
    expect(body.id).toBe(row.id);
    expect(body.categoryId).toBe(row.categoryId);
    expectNoMongoKeys(body);
  });

  it('null category / app key normalise to null / absent', () => {
    const body = toWire(callPrivate(ToolService, 'toToolResponse', [{ ...row, categoryId: null, requiredAppKey: null }]));
    expect(body.categoryId).toBeNull();
    expect(body).not.toHaveProperty('requiredAppKey');
  });
});
