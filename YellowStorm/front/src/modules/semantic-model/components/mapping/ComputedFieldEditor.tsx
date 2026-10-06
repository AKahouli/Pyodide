import type { ComputedFieldRule } from '../../types';
import { FieldRecipeEditor } from './FieldRecipeEditor';

export { COMPUTED_TRANSFORMS, computedPayload, computedProblem, newComputedRule } from './FieldRecipeEditor';

/** A document's computed field: the shared recipe editor, taken from the file name or another field. */
export function ComputedFieldEditor({ fileSamples, fieldSamples, ...props }: Readonly<{
  modelId: string;
  fieldLabel: string;
  rule: ComputedFieldRule;
  onChange: (rule: ComputedFieldRule) => void;
  /** The other fields of this mapping it can be taken from. */
  fields: Array<{ key: string; label: string }>;
  /** The source's own files (a workspace's, subfolders included), offered to try the rule on. */
  fileSamples: string[];
  /** Values read for each field in the last document preview, when there is one. */
  fieldSamples?: Record<string, string[]>;
}>) {
  return <FieldRecipeEditor {...props} source={{ kind: 'document', fileSamples, fieldSamples }} />;
}
