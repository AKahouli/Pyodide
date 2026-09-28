import type { SemanticRelationType } from '../types';

export type Multiplicity = 'one' | 'many';

/**
 * A relationship read as two sentences. `forward` is how many targets each
 * source has ("Each Contract belongs to one Customer"), `reverse` how many
 * sources each target has ("Each Customer has many Contracts"). The stored
 * cardinality is `<reverse>_to_<forward>`.
 */
export function relationSides(cardinality: SemanticRelationType['cardinality']): { forward: Multiplicity; reverse: Multiplicity } {
  const [reverse, forward] = cardinality.split('_to_') as [Multiplicity, Multiplicity];
  return { forward, reverse };
}

export function cardinalityOf(reverse: Multiplicity, forward: Multiplicity): SemanticRelationType['cardinality'] {
  return `${reverse}_to_${forward}`;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The relationship as one sentence read from `fromNodeId`'s side. */
export function relationSentence(relation: SemanticRelationType, labels: { source: string; target: string }, fromNodeId: string, t: Translate) {
  const { forward, reverse } = relationSides(relation.cardinality);
  const fromTarget = fromNodeId === relation.targetNodeTypeId && fromNodeId !== relation.sourceNodeTypeId;
  if (fromTarget) {
    return t(`relationSentence.sentence_${reverse}`, {
      subject: labels.target, verb: relation.inverseLabel || t('relationSentence.defaultInverse'), object: labels.source,
    });
  }
  return t(`relationSentence.sentence_${forward}`, { subject: labels.source, verb: relation.label, object: labels.target });
}
