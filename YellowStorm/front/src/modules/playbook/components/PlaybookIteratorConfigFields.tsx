import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookIteratorConfig } from '../types';

interface Props {
  value: PlaybookIteratorConfig;
  onChange: (next: PlaybookIteratorConfig) => void;
}

export function PlaybookIteratorConfigFields({ value, onChange }: Props) {
  const { t } = useModuleTranslation('playbook');

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-2">
        <Label>{t('nodeEditor.iteratorSource')}</Label>
        <Input
          value={value.source}
          onChange={(e) => onChange({ ...value, source: e.target.value })}
          placeholder="{{items}}"
        />
        <p className="text-xs text-muted-foreground">{t('nodeEditor.iteratorPortHint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>{t('nodeEditor.iteratorMode')}</Label>
          <select
            value={value.mode}
            onChange={(e) => onChange({ ...value, mode: e.target.value as 'item' | 'batch' })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="item">{t('nodeEditor.iteratorModeItem')}</option>
            <option value="batch">{t('nodeEditor.iteratorModeBatch')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>{t('nodeEditor.iteratorErrorStrategy')}</Label>
          <select
            value={value.errorStrategy ?? 'stop'}
            onChange={(e) => onChange({ ...value, errorStrategy: e.target.value as 'stop' | 'continue' })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="stop">{t('nodeEditor.iteratorErrorStop')}</option>
            <option value="continue">{t('nodeEditor.iteratorErrorContinue')}</option>
          </select>
        </div>
      </div>
      {value.mode === 'batch' && (
        <div className="space-y-2">
          <Label>{t('nodeEditor.iteratorBatchSize')}</Label>
          <Input
            type="number"
            min={1}
            value={value.batchSize ?? 10}
            onChange={(e) => onChange({ ...value, batchSize: Number(e.target.value || 1) })}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>{t('nodeEditor.iteratorItemVariable')}</Label>
          <Input
            value={value.itemVariable ?? ''}
            onChange={(e) => onChange({ ...value, itemVariable: e.target.value })}
            placeholder="item"
          />
        </div>
        <div className="space-y-2">
          <Label>{t('nodeEditor.iteratorOutputVariable')}</Label>
          <Input
            value={value.outputVariable ?? ''}
            onChange={(e) => onChange({ ...value, outputVariable: e.target.value })}
            placeholder="processed_items"
          />
        </div>
      </div>
    </div>
  );
}
