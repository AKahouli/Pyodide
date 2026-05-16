import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore, useCurrentPlaybook } from '../store';
import type { DataBinding, DataBindingSourceKind } from '../types';

const SOURCE_KIND_LABELS: Record<DataBindingSourceKind, string> = {
  'node-output': 'Node Output',
  'trigger': 'Trigger',
  'state': 'State',
  'constant': 'Constant',
  'expression': 'Expression',
};

interface Props {
  targetNodeId?: string;
}

export function PlaybookDataBindingSection({ targetNodeId }: Props) {
  const { t } = useModuleTranslation('playbook');
  const playbook = useCurrentPlaybook();
  const updateDataBindings = usePlaybookStore((s) => s.updateDataBindings);

  const allBindings = playbook?.dataBindings ?? [];
  const nodeBindings = targetNodeId
    ? allBindings.filter((b) => b.targetNode === targetNodeId)
    : allBindings;

  const addBinding = useCallback(() => {
    const newBinding: DataBinding = {
      id: `db-${crypto.randomUUID().slice(0, 8)}`,
      targetNode: targetNodeId ?? '',
      targetPort: 'default',
      sourceKind: 'node-output',
    };
    updateDataBindings([...allBindings, newBinding]);
  }, [allBindings, targetNodeId, updateDataBindings]);

  const removeBinding = useCallback(
    (id: string) => {
      updateDataBindings(allBindings.filter((b) => b.id !== id));
    },
    [allBindings, updateDataBindings],
  );

  const updateBinding = useCallback(
    (id: string, patch: Partial<DataBinding>) => {
      updateDataBindings(
        allBindings.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      );
    },
    [allBindings, updateDataBindings],
  );

  const renderSourceFields = (binding: DataBinding) => {
    switch (binding.sourceKind) {
      case 'node-output':
        return (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('dataBindingEditor.sourceNode')}</Label>
              <Input
                value={binding.sourceNode ?? ''}
                onChange={(e) => updateBinding(binding.id, { sourceNode: e.target.value || undefined })}
                className="h-8 text-xs"
                placeholder="node-id"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('dataBindingEditor.sourcePort')}</Label>
              <Input
                value={binding.sourcePort ?? ''}
                onChange={(e) => updateBinding(binding.id, { sourcePort: e.target.value || undefined })}
                className="h-8 text-xs"
                placeholder="port-id"
              />
            </div>
          </div>
        );
      case 'constant':
        return (
          <div className="space-y-1">
            <Label className="text-xs">{t('dataBindingEditor.constantValue')}</Label>
            <Input
              value={typeof binding.constantValue === 'string' ? binding.constantValue : ''}
              onChange={(e) => updateBinding(binding.id, { constantValue: e.target.value || undefined })}
              className="h-8 text-xs"
              placeholder="value"
            />
          </div>
        );
      case 'expression':
        return (
          <div className="space-y-1">
            <Label className="text-xs">{t('dataBindingEditor.expression')}</Label>
            <Input
              value={binding.expression ?? ''}
              onChange={(e) => updateBinding(binding.id, { expression: e.target.value || undefined })}
              className="h-8 text-xs"
              placeholder="{{item.name}}"
            />
          </div>
        );
      case 'trigger':
      case 'state':
        return (
          <div className="space-y-1">
            <Label className="text-xs">{t('dataBindingEditor.expression')}</Label>
            <Input
              value={binding.expression ?? ''}
              onChange={(e) => updateBinding(binding.id, { expression: e.target.value || undefined })}
              className="h-8 text-xs"
              placeholder={binding.sourceKind === 'trigger' ? 'trigger.path' : 'state.path'}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t('dataBindingEditor.title')}</h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={addBinding}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('dataBindingEditor.addBinding')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('dataBindingEditor.description')}</p>
      {nodeBindings.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('dataBindingEditor.empty')}</p>
      ) : (
        <div className="space-y-3">
          {nodeBindings.map((binding) => (
            <div key={binding.id} className="rounded-md border p-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('dataBindingEditor.sourceKind')}</Label>
                    <select
                      value={binding.sourceKind}
                      onChange={(e) =>
                        updateBinding(binding.id, { sourceKind: e.target.value as DataBindingSourceKind })
                      }
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('dataBindingEditor.targetPort')}</Label>
                    <Input
                      value={binding.targetPort}
                      onChange={(e) => updateBinding(binding.id, { targetPort: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeBinding(binding.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {renderSourceFields(binding)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
