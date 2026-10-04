import type { ValueReading } from '../types';

export type ValueReadingKey =
  | 'dataPreview.builtFrom' | 'dataPreview.takenFrom' | 'dataPreview.takenFromAny' | 'dataPreview.takenField'
  | 'dataPreview.takenRecords' | 'dataPreview.readRules' | 'dataPreview.readAi' | 'dataPreview.readRecipe'
  | 'dataPreview.readConstant';

const METHOD_KEYS: Record<string, ValueReadingKey> = {
  rules: 'dataPreview.readRules', ai: 'dataPreview.readAi', recipe: 'dataPreview.readRecipe', constant: 'dataPreview.readConstant',
};

/**
 * What a value was built from, in words: the columns or fields a recipe joined ("built from First + Last"),
 * or the other concept's record it was taken from ("from Contact “Ada” · field email · read with rules").
 * `conceptLabel` names a concept by its id; `fieldLabel` a field of it. Empty when there is nothing to say.
 */
export function valueReadingParts(
  field: ValueReading | undefined,
  t: (key: ValueReadingKey, options?: Record<string, string | number>) => string,
  conceptLabel: (conceptId: string) => string | undefined = () => undefined,
  fieldLabel: (conceptId: string | undefined, key: string) => string = (_concept, key) => key,
): string[] {
  if (!field) return [];
  const parts: string[] = [];
  const derived = field.derivedFrom;
  if (derived) {
    const concept = (derived.conceptId && conceptLabel(derived.conceptId)) || '';
    if (concept) parts.push(derived.label ? t('dataPreview.takenFrom', { concept, record: derived.label }) : t('dataPreview.takenFromAny', { concept }));
    const read = derived.attributes?.length ? derived.attributes : derived.attribute ? [derived.attribute] : [];
    if (read.length) parts.push(t('dataPreview.takenField', { field: read.map((key) => fieldLabel(derived.conceptId, key)).join(' + ') }));
    if (derived.method && METHOD_KEYS[derived.method]) parts.push(t(METHOD_KEYS[derived.method]));
    if (derived.records && derived.records > 1) parts.push(t('dataPreview.takenRecords', { count: derived.records }));
  }
  // A recipe reading more than its own column says every column or field it read.
  if (field.sources && (field.sources.length > 1 || (field.sources[0] && field.sources[0] !== field.reference))) {
    parts.push(t('dataPreview.builtFrom', { fields: field.sources.join(' + ') }));
  }
  return parts;
}
