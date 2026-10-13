import type { AttributeDefinition, FieldGraph } from './types';

/** How many characters of a long text the graph may keep (the server refuses other values). */
export const GRAPH_MAX_CHARS_RANGE = [50, 100_000] as const;

/** A field's graph settings without what is default (shown, whole); undefined when nothing is left. */
export function cleanFieldGraph(value: FieldGraph | undefined): FieldGraph | undefined {
  if (!value) return undefined;
  const settings: FieldGraph = {
    ...(value.expose === false ? { expose: false } : {}),
    ...(typeof value.maxChars === 'number' ? { maxChars: value.maxChars } : {}),
  };
  return Object.keys(settings).length ? settings : undefined;
}

/** The field with its graph settings, or without the key when only the defaults are left. */
export function withGraph(attribute: AttributeDefinition, graph: FieldGraph | undefined): AttributeDefinition {
  const { graph: _previous, ...rest } = attribute;
  const next = cleanFieldGraph(graph);
  return next ? { ...rest, graph: next } : rest;
}
