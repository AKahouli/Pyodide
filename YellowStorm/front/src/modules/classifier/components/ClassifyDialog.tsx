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
import {
  usePlaybooks,
  usePlaybookStore,
  usePlaybooksLoading,
} from '@/modules/playbook/store';
import { useClassifierStore } from '../store';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ClassifyDialog({ open, onOpenChange }: Props) {
  const runClassification = useClassifierStore((s) => s.runClassification);
  const runningClassification = useClassifierStore((s) => s.runningClassification);
  const lastRun = useClassifierStore((s) => s.lastRun);
  const files = useClassifierStore((s) => s.files);
  const folders = useClassifierStore((s) => s.folders);
  const workspaceId = useClassifierStore((s) => s.selectedWorkspaceId);

  const playbooks = usePlaybooks();
  const playbooksLoading = usePlaybooksLoading();
  const fetchPlaybooks = usePlaybookStore((s) => s.fetchPlaybooks);

  const wsFiles = files.filter((f) => f.workspaceId === workspaceId);
  const wsFolders = folders.filter((f) => f.workspaceId === workspaceId);
  const unmapped = wsFiles.filter((f) => !f.folderId).length;

  const [playbookId, setPlaybookId] = useState<string>('');
  const [overwrite, setOverwrite] = useState(false);
  const [hint, setHint] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (open && playbooks.length === 0 && !playbooksLoading) {
      void fetchPlaybooks();
    }
  }, [open, playbooks.length, playbooksLoading, fetchPlaybooks]);

  useEffect(() => {
    if (open && !playbookId && playbooks.length > 0) {
      setPlaybookId(playbooks[0].id);
    }
  }, [open, playbookId, playbooks]);

  useEffect(() => {
    if (!open) {
      setProgress(0);
    }
  }, [open]);

  const status = lastRun?.status;
  const running = runningClassification || status === 'queued' || status === 'running';

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setProgress((p) => Math.min(95, p + 7));
    }, 120);
    return () => clearInterval(interval);
  }, [running]);

  useEffect(() => {
    if (status === 'success') setProgress(100);
  }, [status]);

  const done = status === 'success' && progress === 100;
  const failed = status === 'failed';

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

        {!running && !done && !failed && (
          <div className='space-y-4 py-2'>
            <div className='grid grid-cols-3 gap-2'>
              <Stat label='Fichiers' value={wsFiles.length} />
              <Stat label='Dossiers' value={wsFolders.length} />
              <Stat label='Non classés' value={unmapped} accent={unmapped > 0} />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='playbook'>
                <span className='inline-flex items-center gap-1.5'>
                  <Workflow className='h-3.5 w-3.5' />
                  Playbook
                </span>
              </Label>
              <Select value={playbookId} onValueChange={setPlaybookId} disabled={playbooksLoading}>
                <SelectTrigger id='playbook'>
                  <SelectValue
                    placeholder={playbooksLoading ? 'Chargement…' : 'Sélectionner un playbook'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {playbooks.length === 0 && !playbooksLoading && (
                    <div className='px-2 py-3 text-xs text-muted-foreground'>
                      Aucun playbook disponible.
                    </div>
                  )}
                  {playbooks.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
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
                <p className='text-sm font-medium'>Reclasser les fichiers déjà classés</p>
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

        {failed && (
          <div className='py-6 space-y-3'>
            <p className='text-sm font-medium text-destructive'>La classification a échoué.</p>
            {lastRun?.error && (
              <p className='text-xs text-muted-foreground'>{lastRun.error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {!running && !done && !failed && (
            <>
              <Button variant='ghost' onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  if (!playbookId) return;
                  void runClassification({
                    playbookId,
                    hint: hint.trim() || undefined,
                    overwrite,
                  });
                }}
                disabled={
                  !playbookId ||
                  wsFiles.length === 0 ||
                  wsFolders.length === 0 ||
                  (!overwrite && unmapped === 0)
                }
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
          {(done || failed) && <Button onClick={() => onOpenChange(false)}>Fermer</Button>}
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
