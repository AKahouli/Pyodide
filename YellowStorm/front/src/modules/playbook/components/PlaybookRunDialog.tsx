import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookInputContract } from '../types';
import { PlaybookInputSourcePicker } from './PlaybookInputSourcePicker';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbookName: string;
  contract: PlaybookInputContract;
  canRun?: boolean;
  onRun: (inputContext: Record<string, unknown>, idempotencyKey: string) => Promise<boolean | void>;
}

export function PlaybookRunDialog({ open, onOpenChange, playbookName, contract, canRun = true, onRun }: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const firstInvalidRef = useRef<HTMLDivElement | null>(null);
  const runtimeInputs = contract.inputs.filter((input) => input.readiness === 'runtime_required');

  const submit = async () => {
    const nextErrors: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const input of runtimeInputs) {
      const path = input.binding.triggerPath;
      const value = path ? draft[path] : undefined;
      if (value === undefined || value === null || value === '') {
        nextErrors[input.id] = t('inputs.required');
        continue;
      }
      if (input.artifactKind === 'data' && typeof value === 'string') {
        try { values[path!] = JSON.parse(value); } catch { nextErrors[input.id] = t('inputs.invalidJson'); }
      } else if (path) values[path] = value;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      window.setTimeout(() => firstInvalidRef.current?.querySelector<HTMLElement>('textarea,button')?.focus(), 0);
      return;
    }
    setSubmitting(true);
    try {
      const started = await onRun({ playbookInputs: Object.fromEntries(Object.entries(values).map(([path, value]) => [path.slice('playbookInputs.'.length), value])) }, crypto.randomUUID());
      if (started === false) return;
      onOpenChange(false);
      setDraft({});
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('inputs.runTitle', { name: playbookName })}</DialogTitle>
          <DialogDescription>{t('inputs.runDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {runtimeInputs.map((input, index) => (
            <div key={input.id} ref={index === 0 ? firstInvalidRef : undefined} className="space-y-1">
              <label className="text-sm font-medium">{input.label} *</label>
              <PlaybookInputSourcePicker input={input} value={input.binding.triggerPath ? draft[input.binding.triggerPath] : undefined} onChange={(value) => input.binding.triggerPath && setDraft((current) => ({ ...current, [input.binding.triggerPath!]: value }))} />
              {errors[input.id] ? <p role="alert" className="text-sm text-destructive">{errors[input.id]}</p> : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="button" disabled={submitting || !canRun} onClick={() => void submit()}>{submitting ? t('inputs.running') : t('inputs.run')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
