import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseApiError } from '@/lib/api-error';
import { normalizeHitlBlocker } from '@/modules/playbook/api';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateHitlBlockerMutation } from '@/modules/playbook/query/hooks/useHitlMutations';

type HitlBlockerEditorDialogProps = Readonly<{
  flowId: string;
  nodeId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>;

/** Converts a natural-language blocker into the structured DTO expected by backend blocker creation. */
export function HitlBlockerEditorDialog({ flowId, nodeId, open, onOpenChange }: HitlBlockerEditorDialogProps) {
  const { t } = useModuleTranslation('playbook');
  const createBlocker = useCreateHitlBlockerMutation();
  const [description, setDescription] = useState('');
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmed = description.trim();
    if (!trimmed) return;
    setIsNormalizing(true);
    setError(null);
    try {
      const normalized = await normalizeHitlBlocker(flowId, { description: trimmed, nodeId });
      await createBlocker.mutateAsync({
        flowId,
        data: {
          ...normalized,
          kind: normalized.kind ?? 'custom',
          label: normalized.label ?? trimmed,
          description: normalized.description ?? trimmed,
          action: normalized.action ?? 'clarify',
          scope: nodeId ? 'node' : 'workflow',
          nodeId: nodeId ?? null,
        },
      });
      setDescription('');
      onOpenChange(false);
    } catch (err) {
      setError(parseApiError(err).message || t('hitl.editor.error'));
    } finally {
      setIsNormalizing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('hitl.editor.title')}</DialogTitle>
          <DialogDescription>{t('hitl.editor.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="hitl-blocker-description">{t('hitl.editor.ruleLabel')}</Label>
          <Textarea
            id="hitl-blocker-description"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setError(null);
            }}
            rows={4}
            placeholder={t('hitl.editor.placeholder')}
          />
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!description.trim() || isNormalizing || createBlocker.isPending} onClick={() => void handleSave()}>
            {(isNormalizing || createBlocker.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('hitl.editor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
