import { useState, type ReactNode } from 'react';
import { Eraser, Regex, Scissors } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import type { ExtractionTake } from '../../types';
import { ChoiceGroup, RuleSection } from './RuleControls';
import { MAX_TAKE, ValueShaper } from './ValueShaper';

/**
 * The steps that shape a value once it is found or cut out: what part to keep, what it looks like
 * and how it is cleaned up. Shared by the reading rules and the computed fields.
 */

/** Ready-made patterns; each also reads in the runtime's regular expressions. */
export const PATTERN_PRESETS = {
  date: String.raw`\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4}|\d{1,2}(?:er)? [A-Za-zéû]+ \d{4}`,
  amount: String.raw`[-+]?\d[\d .,]*\d(?: ?(?:€|EUR|\$|USD|%))?`,
  reference: String.raw`[A-Z]{2,}[-_/]?\d[\w-]*`,
  number: String.raw`\d+(?:[.,]\d+)?`,
  email: String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`,
} as const;
export type PatternPreset = keyof typeof PATTERN_PRESETS;
type PatternChoice = PatternPreset | 'custom' | 'none';

export function presetOf(pattern?: string): PatternPreset | undefined {
  return (Object.keys(PATTERN_PRESETS) as PatternPreset[]).find((key) => PATTERN_PRESETS[key] === pattern);
}

/** A pattern the browser cannot read is very likely wrong for the runtime too. */
export function patternProblem(pattern?: string) {
  if (!pattern?.trim()) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** True when a take keeps a whole number of units the runtime accepts. */
export function takeProblem(take?: ExtractionTake) {
  return Boolean(take) && (!Number.isInteger(take!.count) || take!.count < 1 || take!.count > MAX_TAKE);
}

type SectionProps = { id: string; open: boolean; onToggle: () => void };

/** “first 4 characters”, or '' when everything is kept. */
export function useTakeSummary(take?: ExtractionTake) {
  const { t } = useModuleTranslation('semantic-model');
  return take ? t(`mapping.rules.summaryTake.${take.from}`, { amount: t(`mapping.rules.take.amount.${take.unit}`, { count: take.count }) }) : '';
}

/** “Keep”: everything, or the first or last characters, words or lines. */
export function KeepSection({ section, fieldLabel, take, onTake, help, children }: Readonly<{
  section: SectionProps;
  fieldLabel: string;
  take?: ExtractionTake;
  onTake: (take: ExtractionTake | undefined) => void;
  help?: string;
  /** A richer editor (the text read, to cut by clicking); the plain controls without one. */
  children?: ReactNode;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const summary = useTakeSummary(take);
  return <RuleSection {...section} title={t('mapping.rules.take.keep')} icon={<Scissors className='h-3.5 w-3.5' />}
    summary={summary || t('mapping.rules.take.mode.all')} help={help} invalid={takeProblem(take)}>
    {children ?? <ValueShaper fieldLabel={fieldLabel} location='auto' take={take} onTake={onTake} onAction={() => undefined} textless />}
  </RuleSection>;
}

/** “What the value looks like”: anything, a ready-made shape or one's own pattern. */
export function ValuePatternSection({ section, fieldLabel, pattern, onPattern, required }: Readonly<{
  section: SectionProps;
  fieldLabel: string;
  pattern?: string;
  onPattern: (pattern: string | undefined) => void;
  /** A pattern is needed (reading anywhere): its box stays open and an empty one is an error. */
  required?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [customPattern, setCustomPattern] = useState(false);
  // An empty custom pattern is not stored, so "My own pattern" (and a required one) keeps the box open.
  const preset: PatternChoice = pattern ? presetOf(pattern) ?? 'custom' : customPattern || required ? 'custom' : 'none';
  const problem = patternProblem(pattern);
  const missing = Boolean(required) && !pattern?.trim();
  const choose = (value: PatternChoice) => {
    setCustomPattern(value === 'custom');
    if (value === 'none') onPattern(undefined);
    else if (value === 'custom') onPattern(pattern || undefined);
    else onPattern(PATTERN_PRESETS[value]);
  };
  return <RuleSection {...section} title={t('mapping.rules.pattern')} icon={<Regex className='h-3.5 w-3.5' />}
    summary={preset === 'custom' ? pattern || t('mapping.rules.preset.custom') : t(`mapping.rules.preset.${preset}`)} help={t('mapping.rules.patternHelp')} invalid={Boolean(problem || missing)}>
    <ChoiceGroup variant='chips' label={t('mapping.rules.patternFor', { field: fieldLabel })} value={preset} onChange={choose}
      options={(['none', ...Object.keys(PATTERN_PRESETS) as PatternPreset[], 'custom'] as const).map((item) => ({ value: item, label: t(`mapping.rules.preset.${item}`) }))} />
    {preset !== 'none' && <Input className='h-7 font-mono text-xs' value={pattern ?? ''} aria-label={t('mapping.rules.patternText', { field: fieldLabel })}
      aria-invalid={Boolean(problem || missing)} placeholder={String.raw`CNT-\d{4}-\d{4}`} maxLength={200}
      onChange={(event) => onPattern(event.target.value || undefined)} />}
    {problem && <p role='alert' className='text-[11px] text-destructive'>{t('mapping.rules.patternInvalid', { problem })}</p>}
    {missing && <p role='alert' className='text-[11px] text-destructive'>{t('mapping.rules.patternRequired')}</p>}
  </RuleSection>;
}

/** “Clean-up”: one of the given conversions, as chips. */
export function CleanupSection<T extends string>({ section, fieldLabel, value, options, onChange }: Readonly<{
  section: SectionProps;
  fieldLabel: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  return <RuleSection {...section} title={t('mapping.rules.transform')} icon={<Eraser className='h-3.5 w-3.5' />}
    summary={t(`mapping.rules.transformOption.${value}` as never)}>
    <ChoiceGroup variant='chips' label={t('mapping.rules.transformFor', { field: fieldLabel })} value={value} onChange={onChange}
      options={options.map((item) => ({ value: item, label: t(`mapping.rules.transformOption.${item}` as never) }))} />
  </RuleSection>;
}
