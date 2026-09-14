import { validateExecutableTeam } from './team-execution';

const node = (agentId: string, parentAgentId: string | null, order = 0) => ({ agentId, parentAgentId, order });
const agent = (id: string, agentTypeSlug: string) => ({ id, agentTypeSlug });

describe('validateExecutableTeam', () => {
  it('accepts a nested manager with an executor leaf and preserves sibling order', () => {
    expect(validateExecutableTeam(
      [node('leaf-b', 'nested', 2), node('root', null), node('nested', 'root'), node('leaf-a', 'nested', 1)],
      [agent('root', 'manager'), agent('nested', 'manager'), agent('leaf-a', 'worker'), agent('leaf-b', 'custom')],
    ).map((item) => item.agentId)).toEqual(['root', 'nested', 'leaf-a', 'leaf-b']);
  });

  it.each([
    ['multiple roots', [node('root', null), node('leaf', null)], [agent('root', 'manager'), agent('leaf', 'worker')]],
    ['no root', [node('a', 'b'), node('b', 'a')], [agent('a', 'manager'), agent('b', 'manager')]],
    ['a duplicate node', [node('root', null), node('root', null)], [agent('root', 'manager')]],
    ['a disconnected cycle', [node('root', null), node('a', 'b'), node('b', 'a')], [agent('root', 'manager'), agent('a', 'manager'), agent('b', 'manager')]],
    ['a non-manager root', [node('root', null)], [agent('root', 'worker')]],
    ['a non-manager parent', [node('root', null), node('parent', 'root'), node('leaf', 'parent')], [agent('root', 'manager'), agent('parent', 'worker'), agent('leaf', 'worker')]],
    ['a dangling parent', [node('root', null), node('leaf', 'missing')], [agent('root', 'manager'), agent('leaf', 'worker')]],
    ['a missing agent', [node('root', null), node('leaf', 'root')], [agent('root', 'manager')]],
  ])('rejects %s', (_label, nodes, agents) => {
    expect(() => validateExecutableTeam(nodes, agents)).toThrow();
  });

  it('rejects 26 nodes and depth 6', () => {
    const wide = [node('root', null), ...Array.from({ length: 25 }, (_, i) => node(`leaf-${i}`, 'root'))];
    expect(() => validateExecutableTeam(wide, [agent('root', 'manager'), ...wide.slice(1).map((item) => agent(item.agentId, 'worker'))])).toThrow();

    const deep = Array.from({ length: 6 }, (_, i) => node(`manager-${i}`, i ? `manager-${i - 1}` : null));
    expect(() => validateExecutableTeam(deep, deep.map((item) => agent(item.agentId, 'manager')))).toThrow();
  });
});
