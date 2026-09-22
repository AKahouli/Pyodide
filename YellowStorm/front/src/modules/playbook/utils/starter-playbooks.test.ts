import { describe, expect, it } from 'vitest';
import { buildStarterPlaybook, STARTER_KEYS } from './starter-playbooks';
import { getUnboundRequiredPorts } from './required-port-validation';

describe('starter playbooks', () => {
  for (const key of STARTER_KEYS) it(`builds an editable connected ${key} process with real sample input`, () => {
    const definition = buildStarterPlaybook(key, 'My edited sample', 'agent-selected', (value) => value);
    const [first, second] = definition.tasks;
    expect(first.id).not.toBe(second.id);
    expect(definition.tasks.every((task) => task.assignedAgentId === 'agent-selected')).toBe(true);
    expect(definition.dataBindings?.[0].constantValue).toEqual({ text: 'My edited sample' });
    expect(definition.dataBindings?.[1]).toMatchObject({ sourceNode: first.id, targetNode: second.id, sourcePort: 'default', targetPort: 'default' });
    expect(definition.edges[0]).toMatchObject({ sourceId: first.id, targetId: second.id });
    expect(getUnboundRequiredPorts(definition.tasks, definition.dataBindings ?? [], [])).toHaveLength(0);
  });

  it('rejects missing input or agent instead of creating an unusable example', () => {
    expect(() => buildStarterPlaybook('meeting', '', 'agent', (value) => value)).toThrow();
    expect(() => buildStarterPlaybook('meeting', 'Sample', '', (value) => value)).toThrow();
  });
});
