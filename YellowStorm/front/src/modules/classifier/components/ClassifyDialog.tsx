import { useEffect, useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, Workflow } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { useClassifierStore } from '../store';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const PLAYBOOK_OPTIONS = [
  { value: 'auto-classify-v1', label: 'Auto-classifier · Standard' },
  { value: 'auto-classify-v2', label: 'Auto-classifier · Smart RAG' },
  { value: 'auto-classify-legal', label: 'Spécialisé Legal & Conformité' },
];

export function ClassifyDialog({ open, onOpenChange }: Props) {
  const runClassification = useClassifierStore((s) => s.runClassification);
  const lastRun = useClassifierStore((s) => s.lastRun);
  const files = useClassifierStore((s) => s.files);
  const folders = useClassifierStore((s) => s.folders);
  const workspaceId = useClassifierStore((s) => s.selectedWorkspaceId);

  const wsFiles = files.filter((f) => f.workspaceId === workspaceId);
  const wsFolders = folders.filter((f) => f.workspaceId === workspaceId);
  const unmapped = wsFiles.filter((f) => !f.folderId).length;

  const [playbook, setPlaybook] = useState('auto-classify-v2');
  const [overwrite, setOverwrite] = useState(false);
  const [hint, setHint] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) {
      setProgress(0);
    }
  }, [open]);

  useEffect(() => {
    if (lastRun?.status !== 'running') return;
    const interval = setInterval(() => {
      setProgress((p) => Math.min(95, p + 7));
    }, 120);
    return () => clearInterval(interval);
  }, [lastRun?.status]);

  useEffect(() => {
    if (lastRun?.status === 'success') {
      setProgress(100);
    }
  }, [lastRun?.status]);

  const running = lastRun?.status === 'running';
  const done = lastRun?.status === 'success' && progress === 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary'>
              <Sparkles className='h-5 w-5' />
            </div>
            <div>
              <DialogTitle>Lancer la classification</DialogTitle>
              <DialogDescription>
                Le playbook range automatiquement les fichiers dans les bons dossiers selon leur description.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!running && !done && (
          <div className='space-y-4 py-2'>
            <div className='grid grid-cols-3 gap-2'>
              <Stat label='Fichiers' value={wsFiles.length} />
              <Stat label='Dossiers' value={wsFolders.length} />
              <Stat label='Non mappés' value={unmapped} accent={unmapped > 0} />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='playbook'>
                <span className='inline-flex items-center gap-1.5'>
                  <Workflow className='h-3.5 w-3.5' />
                  Playbook
                </span>
              </Label>
              <Select value={playbook} onValueChange={setPlaybook}>
                <SelectTrigger id='playbook'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAYBOOK_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='hint'>Instructions additionnelles (optionnel)</Label>
              <Textarea
                id='hint'
                rows={3}
                placeholder="Ex: prioriser le classement par client plutôt que par type de document."
                value={hint}
                onChange={(e) => setHint(e.target.value)}
              />
            </div>

            <div className='flex items-center justify-between rounded-md border p-3'>
              <div>
                <p className='text-sm font-medium'>Reclasser les fichiers déjà mappés</p>
                <p className='text-xs text-muted-foreground'>
                  Si désactivé, seuls les fichiers sans dossier sont traités.
                </p>
              </div>
              <Switch checked={overwrite} onCheckedChange={setOverwrite} />
            </div>
          </div>
        )}

        {running && (
          <div className='py-6 space-y-4'>
            <div className='flex items-center gap-3'>
              <Loader2 className='h-5 w-5 animate-spin text-primary' />
              <p className='text-sm'>Analyse des fichiers en cours…</p>
            </div>
            <Progress value={progress} />
            <p className='text-xs text-muted-foreground'>
              Le playbook lit chaque fichier et le compare aux descriptions des dossiers.
            </p>
          </div>
        )}

        {done && (
          <div className='py-6 space-y-3'>
            <div className='flex items-center gap-3 text-primary'>
              <CheckCircle2 className='h-5 w-5' />
              <p className='text-sm font-medium'>Classification terminée</p>
            </div>
            <p className='text-sm text-muted-foreground'>
              {lastRun?.classifiedFiles ?? 0} fichier(s) classifié(s). Vérifie le mapping dans la vue.
            </p>
          </div>
        )}

        <DialogFooter>
          {!running && !done && (
            <>
              <Button variant='ghost' onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  void runClassification(playbook);
                }}
                disabled={wsFiles.length === 0 || wsFolders.length === 0}
                className='gap-2'
              >
                <Sparkles className='h-4 w-4' />
                Classifier {overwrite ? 'tout' : `${unmapped} fichier(s)`}
              </Button>
            </>
          )}
          {running && (
            <Button variant='ghost' disabled>
              Veuillez patienter…
            </Button>
          )}
          {done && <Button onClick={() => onOpenChange(false)}>Fermer</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className='rounded-md border bg-muted/30 px-3 py-2'>
      <div className={accent ? 'text-lg font-semibold text-primary' : 'text-lg font-semibold'}>{value}</div>
      <div className='text-xs text-muted-foreground'>{label}</div>
    </div>
  );
}
