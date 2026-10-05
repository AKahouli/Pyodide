import { createContext, useContext } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import type { DocumentFieldReading } from '../../types';

/**
 * What a field's value is read out of: a document, a sheet cell's text, or a field of another concept's
 * record (a derived source). The reasons a value was not found name it ("The label is not in this cell."),
 * so a cell or a record is never called a document.
 */
export type ReadingTextKind = 'document' | 'cell' | 'record';

export const ReadingTextContext = createContext<ReadingTextKind>('document');

// Reasons and hints whose wording names what was read; the others read the same everywhere.
const SOURCE_AWARE_REASONS = new Set(['label_not_found', 'no_match']);
const SOURCE_AWARE_HINTS = new Set(['label_not_found', 'no_match', 'no_input', 'several_values', 'ai_not_found']);

type Reading = Pick<DocumentFieldReading, 'reason'> & Partial<Pick<DocumentFieldReading, 'values' | 'detail'>>;

/** The translation keys of a reading's reason and hint for this kind of text. */
export function readingKeys(kind: ReadingTextKind, reason: string) {
  const reasonKey = kind !== 'document' && SOURCE_AWARE_REASONS.has(reason) ? `mapping.reading.in.${kind}.reason.${reason}` : `mapping.reading.reason.${reason}`;
  const hintKey = kind !== 'document' && SOURCE_AWARE_HINTS.has(reason) ? `mapping.reading.in.${kind}.hint.${reason}` : `mapping.reading.hint.${reason}`;
  return { reasonKey, hintKey };
}

/** Why a value was (not) found, and what to try next, worded for the text the field reads. */
export function useReadingText() {
  const { t } = useModuleTranslation('semantic-model');
  const kind = useContext(ReadingTextContext);
  const quoted = (values?: string[]) => (values ?? []).map((value) => `“${value}”`).join(', ');
  return {
    kind,
    reason: (reading: Reading) => t(readingKeys(kind, reading.reason).reasonKey as never, { values: quoted(reading.values), detail: reading.detail ?? '' }),
    hint: (reading: Reading) => t(readingKeys(kind, reading.reason).hintKey as never),
    /** The method badge of a value read as it is: a column of a sheet, or a field of a record. */
    direct: () => t(kind === 'record' ? 'mapping.reading.in.record.direct' : 'mapping.reading.method.direct'),
  };
}
