import { describe, expect, it } from 'vitest';
import { makeEdge, makeTask } from '../test-utils';
import { edgeMatchesIntentPortPair, resolveIntentEdgePorts } from './intent-edge-ports';

describe('resolveIntentEdgePorts', () => {
  it('uses compatible suggested ports when both are valid', () => {
    const sourceTask = makeTask({
      outputPorts: [{ id: 'text', name: 'Text', artifactKind: 'text' }],
    });
    const targetTask = makeTask({
      inputPorts: [{ id: 'input', name: 'Input', artifactKind: 'text', required: false }],
    });

    expect(resolveIntentEdgePorts(sourceTask, targetTask, 'text', 'input')).toEqual({
      sourceOutputPortId: 'text',
      targetInputPortId: 'input',
    });
  });

  it('falls back from incompatible suggested target port to a compatible pair', () => {
    const sourceTask = makeTask({
      outputPorts: [{ id: 'text', name: 'Text', artifactKind: 'text' }],
    });
    const targetTask = makeTask({
      inputPorts: [
        { id: 'doc', name: 'Doc', artifactKind: 'document', required: false },
        { id: 'input', name: 'Input', artifactKind: 'text', required: false },
      ],
    });

    expect(resolveIntentEdgePorts(sourceTask, targetTask, 'text', 'doc')).toEqual({
      sourceOutputPortId: 'text',
      targetInputPortId: 'input',
    });
  });

  it('returns null when both sides have ports but no compatible pair exists', () => {
    const sourceTask = makeTask({
      outputPorts: [{ id: 'image', name: 'Image', artifactKind: 'image' }],
    });
    const targetTask = makeTask({
      inputPorts: [{ id: 'input', name: 'Input', artifactKind: 'text', required: false }],
    });

    expect(resolveIntentEdgePorts(sourceTask, targetTask)).toBeNull();
  });

  it('preserves the real port id on the populated side when the other side is legacy-empty', () => {
    const sourceTask = makeTask({
      outputPorts: [{ id: 'text', name: 'Text', artifactKind: 'text' }],
    });
    const targetTask = makeTask({ inputPorts: [] });

    expect(resolveIntentEdgePorts(sourceTask, targetTask)).toEqual({
      sourceOutputPortId: 'text',
      targetInputPortId: 'default',
    });
  });
});

describe('edgeMatchesIntentPortPair', () => {
  it('matches only the targeted port pair when port ids are provided', () => {
    const edge = makeEdge({
      sourceId: 'a',
      targetId: 'b',
      sourceOutputPortId: 'text',
      targetInputPortId: 'input',
    });

    expect(edgeMatchesIntentPortPair(edge, 'a', 'b', 'text', 'input')).toBe(true);
    expect(edgeMatchesIntentPortPair(edge, 'a', 'b', 'other', 'input')).toBe(false);
    expect(edgeMatchesIntentPortPair(edge, 'a', 'b', 'text', 'other')).toBe(false);
  });
});
