import type { AttributeDefinition, SheetFieldProfile } from '../types';
import { businessKey } from './model-utils';

/** One sheet of a spreadsheet as read by source analysis: its columns and a bounded sample of rows. */
export interface SheetSample {
  sheet: string;
  fields: SheetFieldProfile[];
  sampleRows: Record<string, unknown>[];
}

export interface ConceptFieldProposal {
  column: string;
  key: string;
  label: string;
  type: AttributeDefinition['type'];
}

export interface ConceptProposal {
  sheet: string;
  label: string;
  fields: ConceptFieldProposal[];
  /** Column whose values tell records apart, or null when none is unique and always filled. */
  keyColumn: string | null;
}

export interface RelationProposal {
  /** Sheet holding the reference column ("Contracts"). */
  fromSheet: string;
  fromColumn: string;
  /** Sheet whose key the column points at ("Customers"). */
  toSheet: string;
}

const KEY_NAME = /(^|[\s_\-.])(id|ident|identifier|number|num|no|nr|code|ref|reference|key)$/i;
const KEY_PREFIX = /^(id|code|ref|no|num)([\s_\-.]|$)/i;

export function normalizeName(value: string): string {
  return value.normalize('NFD').replaceAll(/[̀-ͯ]/g, '').toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function singular(value: string): string {
  return value.length > 3 && value.endsWith('s') ? value.slice(0, -1) : value;
}

/** "customer_id" → "Customer id". */
export function readableName(value: string): string {
  const words = value.replaceAll(/[_\-.]+/g, ' ').replaceAll(/\s+/g, ' ').trim();
  return words ? words[0].toLocaleUpperCase() + words.slice(1) : value;
}

function sampleValues(sample: SheetSample, column: string): string[] {
  return sample.sampleRows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && String(value).trim() !== '').map((value) => String(value).trim());
}

/** Type guessed from sampled values; the analysis type is used when the sample is empty. */
export function guessType(values: string[], fallback: SheetFieldProfile['type'] = 'text'): AttributeDefinition['type'] {
  if (!values.length) return fallback;
  if (values.every((value) => /^(true|false|yes|no|oui|non)$/i.test(value))) return 'boolean';
  if (values.every((value) => /^-?\d+([.,]\d+)?$/.test(value.replaceAll(/\s/g, '')))) return 'number';
  if (values.every((value) => /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(value) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(value))) return 'date';
  return 'text';
}

function isUniqueAndFilled(sample: SheetSample, field: SheetFieldProfile): boolean {
  if (field.populatedRatio < 1 || field.uniqueRatio < 1) return false;
  const values = sampleValues(sample, field.name);
  return values.length === sample.sampleRows.length && new Set(values).size === values.length;
}

/** The column that makes each row unique: always filled, never repeated; id/number/code-like names first. */
export function suggestKey(sample: SheetSample): string | null {
  const candidates = sample.fields.filter((field) => isUniqueAndFilled(sample, field));
  const named = candidates.find((field) => KEY_NAME.test(field.name) || KEY_PREFIX.test(field.name));
  return (named ?? candidates[0])?.name ?? null;
}

export function suggestConcept(sample: SheetSample): ConceptProposal {
  const used = new Set<string>();
  const fields = sample.fields.map((field) => {
    // Field keys must start with a letter ("2024 amount" → "field_2024_amount").
    const base = /^[a-z]/.test(businessKey(field.name)) ? businessKey(field.name) : `field_${businessKey(field.name)}`.replace(/_$/, '');
    let key = base;
    for (let index = 2; used.has(key); index += 1) key = `${base}_${index}`;
    used.add(key);
    return { column: field.name, key, label: readableName(field.name), type: guessType(sampleValues(sample, field.name), field.type) };
  });
  return { sheet: sample.sheet, label: readableName(singular(sample.sheet)), fields, keyColumn: suggestKey(sample) };
}

/**
 * A column of one sheet that names or holds another sheet's key ("Customer number" in Contracts
 * pointing at Customers' "Number"): same name, name of the other sheet plus its key, or sampled
 * values that are all among the other sheet's key values.
 */
export function suggestRelations(samples: SheetSample[], concepts: ConceptProposal[]): RelationProposal[] {
  const relations: RelationProposal[] = [];
  for (const from of samples) {
    const fromKey = concepts.find((concept) => concept.sheet === from.sheet)?.keyColumn;
    for (const to of samples) {
      if (to === from) continue;
      const toKey = concepts.find((concept) => concept.sheet === to.sheet)?.keyColumn;
      if (!toKey) continue;
      const keyName = normalizeName(toKey);
      const sheetName = singular(normalizeName(to.sheet));
      const keyValues = new Set(sampleValues(to, toKey));
      const column = from.fields.find((field) => {
        if (field.name === fromKey) return false;
        const name = normalizeName(field.name);
        if (name === `${sheetName}${keyName}` || (name.startsWith(sheetName) && KEY_NAME.test(field.name))) return true;
        if (name === keyName && !['id', 'code', 'number', 'no', 'ref', 'key'].includes(keyName)) return true;
        const values = sampleValues(from, field.name);
        return values.length >= 2 && keyValues.size >= 2 && values.every((value) => keyValues.has(value)) && !isUniqueAndFilled(from, field);
      });
      if (column) relations.push({ fromSheet: from.sheet, fromColumn: column.name, toSheet: to.sheet });
    }
  }
  return relations;
}

export function suggestModel(samples: SheetSample[]): { concepts: ConceptProposal[]; relations: RelationProposal[] } {
  const usable = samples.filter((sample) => sample.fields.length > 0);
  const concepts = usable.map(suggestConcept);
  return { concepts, relations: suggestRelations(usable, concepts) };
}
