import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import type { A2ADialogState } from '../hooks/useAgentOperations';

interface A2APublishDialogProps {
  result: A2ADialogState | null;
  onClose: () => void;
}

/** A single read-only credential row with a copy-to-clipboard button. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useModuleTranslation('agent');

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('a2a.dialog.copied', { defaultValue: 'Copied to clipboard' }));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('list.errors.unknownError'));
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={handleCopy}
          disabled={!value}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function A2APublishDialog({ result, onClose }: A2APublishDialogProps) {
  const { t } = useModuleTranslation('agent');

  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {result?.rotated
              ? t('a2a.dialog.titleRotated', { defaultValue: 'A2A key rotated' })
              : t('a2a.dialog.titlePublished', { defaultValue: 'Agent published over A2A' })}
          </DialogTitle>
          <DialogDescription>
            {t('a2a.dialog.warning', {
              defaultValue:
                'Copy the API key now — for security it will not be shown again. Rotating the key invalidates the previous one.',
            })}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="space-y-4 py-2">
            <CopyField
              label={t('a2a.dialog.agentCard', { defaultValue: 'Agent card URL' })}
              value={result.agentCardUrl}
            />
            <CopyField
              label={t('a2a.dialog.apiKeyHeader', { defaultValue: 'API key header' })}
              value={result.apiKeyHeader}
            />
            <CopyField
              label={t('a2a.dialog.apiKey', { defaultValue: 'API key' })}
              value={result.apiKey}
            />
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>
            {t('a2a.dialog.done', { defaultValue: 'Done' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
