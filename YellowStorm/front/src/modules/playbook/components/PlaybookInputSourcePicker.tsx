import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookInputDescriptor, PlaybookIntentClarificationResource } from '../types';
import { PlaybookClarificationResourcePicker } from './PlaybookClarificationResourcePicker';

interface Props {
  input: PlaybookInputDescriptor;
  value?: unknown;
  onChange: (value: unknown) => void;
}

export function PlaybookInputSourcePicker({ input, value, onChange }: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const [resourceOpen, setResourceOpen] = useState(false);
  const canBrowse = input.acceptedSources.some((source) => source === 'workspace' || source === 'document' || source === 'folder');
  const displayValue = typeof value === 'string' ? value : value && typeof value === 'object'
    ? String((value as Record<string, unknown>).label ?? (value as Record<string, unknown>).name ?? '')
    : '';
  const handleResource = (resource: PlaybookIntentClarificationResource) => {
    onChange({
      kind: resource.kind,
      id: resource.id,
      ...(resource.kind === 'document' ? { documentId: resource.id } : {}),
      workspaceId: resource.workspaceId || resource.id,
      workspaceName: resource.workspaceName,
      label: resource.name,
      path: resource.path,
      mimeType: resource.mimeType,
    });
  };
  return (
    <div className="space-y-2">
      {input.acceptedSources.includes('manual') || input.acceptedSources.includes('url') ? (
        <Textarea
          aria-label={input.label}
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('inputs.manualPlaceholder')}
        />
      ) : displayValue ? <p className="rounded-md border px-3 py-2 text-sm">{displayValue}</p> : null}
      {canBrowse ? (
        <Button type="button" variant="outline" onClick={() => setResourceOpen(true)}>
          {t('inputs.browseWorkspace')}
        </Button>
      ) : null}
      <PlaybookClarificationResourcePicker
        open={resourceOpen}
        mode={input.scope === 'configuration' ? 'destination_workspace' : 'workspace_or_document'}
        onOpenChange={setResourceOpen}
        onSelect={handleResource}
      />
    </div>
  );
}
