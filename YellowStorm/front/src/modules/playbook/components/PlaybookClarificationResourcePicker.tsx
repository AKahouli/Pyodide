import { useModuleTranslation } from '@/modules/localization';
import { SourceChooserDialog } from '@/modules/semantic-model/components/assistant/SourceChooser';
import { searchPlaybookSourceFiles } from '../assistant-sources-api';
import type { PlaybookIntentClarificationQuestion, PlaybookIntentClarificationResource } from '../types';

interface Props {
  open: boolean;
  mode: NonNullable<PlaybookIntentClarificationQuestion['resourceSelector']> | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (resource: PlaybookIntentClarificationResource) => void;
  /** What the search starts with. */
  initialSearch?: string;
}

const searchFiles = async (term: string) => ({
  files: (await searchPlaybookSourceFiles(term)).files.map((file) => ({ ...file, kind: 'document' as const })),
});

/**
 * One workspace or one file for a playbook: a destination workspace, a clarification source, a task or run
 * input. The person scrolls and searches every workspace they can open (their own and the shared ones), and
 * searching also finds files by name in all of them, as in the Yellowmind sources card.
 */
export function PlaybookClarificationResourcePicker({ open, mode, onOpenChange, onSelect, initialSearch }: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const destination = mode === 'destination_workspace';
  return (
    <SourceChooserDialog
      open={open && Boolean(mode)}
      mode={destination ? 'workspace' : 'file'}
      conceptLabel=''
      title={t(destination ? 'intentBar.design.resource.destinationTitle' : 'intentBar.design.resource.sourceTitle')}
      description={t('intentBar.design.resource.description')}
      useLabel={t('intentBar.design.resource.use')}
      initialSearch={initialSearch}
      searchFiles={searchFiles}
      onClose={() => onOpenChange(false)}
      onChoose={(option) => {
        const [documentId] = option.documentIds;
        onSelect(option.kind === 'workspace' || !documentId
          ? { kind: 'workspace', id: option.workspaceId, name: option.workspaceName, workspaceId: option.workspaceId, workspaceName: option.workspaceName }
          : {
            kind: 'document',
            id: documentId,
            name: option.documents[0] ?? option.workspaceName,
            workspaceId: option.workspaceId,
            workspaceName: option.workspaceName,
            ...(option.mimeType ? { mimeType: option.mimeType } : {}),
          });
        onOpenChange(false);
      }} />
  );
}
