import { useState } from 'react';
import { AlertTriangle, ArrowRight, Boxes, Copy, Database, FileText, Network, Pencil, Share2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { SemanticModel } from '../../types';
import { ShareSemanticModelDialog } from './ShareSemanticModelDialog';

export function SemanticModelCard({ model }: Readonly<{ model: SemanticModel }>) {
  const { t } = useModuleTranslation('semantic-model');
  const navigate = useNavigate();
  const automatic = model.kind === 'workspace_default';
  const attention = Boolean(model.brokenBindingCount);
  const isOwner = model.role === 'owner' || !model.role;
  const canEdit = model.role !== 'viewer';
  const [shareOpen, setShareOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState(`${model.name} ${t('clone.copySuffix')}`.trim());
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState(model.name);
  const queryClient = useQueryClient();
  const renameAction = useApiAction(
    (name: string) => semanticModelApi.update(model.id, { expectedRevision: model.revision, name }),
    {
      showSuccessToast: true,
      successMessage: t('catalog.rename.renamed'),
      onSuccess: () => {
        setRenameOpen(false);
        void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.all });
      },
    },
  );
  const cloneAction = useApiAction(
    (name: string) => semanticModelApi.clone(model.id, name),
    {
      showSuccessToast: true,
      successMessage: t('clone.created'),
      onSuccess: (copy) => {
        setCloneOpen(false);
        navigate(`/semantic-models/${copy.id}`);
      },
    },
  );

  return (
    <>
      <Card className='group flex h-full flex-col overflow-hidden border-border/70 bg-card/80 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg'>
        <div className={`h-1 ${attention ? 'bg-amber-500' : automatic ? 'bg-sky-500' : 'bg-primary'}`} />
        <CardHeader className='space-y-3 pb-3'>
          <div className='flex items-start justify-between gap-3'>
            <div className={`rounded-xl p-2.5 ${automatic ? 'bg-sky-500/10 text-sky-600' : 'bg-primary/10 text-primary'}`}>
              {automatic ? <Sparkles className='h-5 w-5' /> : <Network className='h-5 w-5' />}
            </div>
            <div className='flex flex-wrap items-center justify-end gap-1.5'>
              {isOwner && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7 text-muted-foreground hover:text-primary'
                  title={t('share.action')}
                  onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
                >
                  <Share2 className='h-4 w-4' />
                </Button>
              )}
              <Badge variant='secondary'>{t(automatic ? 'catalog.badge.automatic' : 'catalog.badge.designed')}</Badge>
              <Badge variant={model.status === 'published' ? 'default' : 'outline'}>{t(`status.${model.status}`)}</Badge>
            </div>
          </div>
          <div className='space-y-1'>
            <div className='flex items-center justify-between gap-1.5'>
              <CardTitle className='line-clamp-1 text-lg'>{model.name}</CardTitle>
              {canEdit && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7 shrink-0 text-muted-foreground opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 hover:text-primary'
                  aria-label={t('catalog.rename.button')}
                  title={t('catalog.rename.button')}
                  onClick={(e) => { e.stopPropagation(); setRenameName(model.name); setRenameOpen(true); }}
                >
                  <Pencil className='h-4 w-4' />
                </Button>
              )}
            </div>
            <p className='line-clamp-2 min-h-10 text-sm text-muted-foreground'>{model.description || t('catalog.noDescription')}</p>
          </div>
        </CardHeader>
        <CardContent className='flex-1 space-y-4'>
          <div className='grid grid-cols-2 gap-2 text-xs'>
            <Metric icon={Database} value={model.workspaceCount ?? 0} label={t('catalog.metric.workspaces')} />
            <Metric icon={Boxes} value={model.nodeCount ?? 0} label={t('catalog.metric.concepts')} />
            <Metric icon={Network} value={model.relationCount ?? 0} label={t('catalog.metric.relationships')} />
            <Metric icon={FileText} value={model.recordCount ?? 0} label={t('catalog.metric.records')} />
          </div>
          {attention && <div className='flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300'><AlertTriangle className='h-4 w-4 shrink-0' />{t('catalog.needsAttention', { count: model.brokenBindingCount ?? 0 })}</div>}
        </CardContent>
        <CardFooter className='gap-2'>
          <Button
            variant='outline'
            onClick={() => { setCloneName(`${model.name} ${t('clone.copySuffix')}`.trim()); setCloneOpen(true); }}
          >
            <Copy className='mr-1.5 h-4 w-4' />
            {t('clone.button')}
          </Button>
          <Button className='flex-1 justify-between' variant='ghost' onClick={() => navigate(`/semantic-models/${model.id}`)}>
            {t('catalog.open')}<ArrowRight className='h-4 w-4 transition group-hover:translate-x-1' />
          </Button>
        </CardFooter>
      </Card>

      {isOwner && (
        <ShareSemanticModelDialog
          open={shareOpen}
          modelId={model.id}
          modelName={model.name}
          onOpenChange={setShareOpen}
        />
      )}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('catalog.rename.title')}</DialogTitle>
            <DialogDescription>{t('catalog.rename.description')}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
            aria-label={t('catalog.rename.name')}
            autoFocus
            maxLength={160}
            onKeyDown={(event) => { if (event.key === 'Enter' && renameName.trim() && !renameAction.isLoading) void renameAction.execute(renameName.trim()); }}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenameOpen(false)}>{t('action.cancel')}</Button>
            <Button
              onClick={() => void renameAction.execute(renameName.trim())}
              disabled={!renameName.trim() || renameName.trim() === model.name || renameAction.isLoading}
            >
              {renameAction.isLoading ? t('catalog.rename.saving') : t('catalog.rename.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clone.title')}</DialogTitle>
            <DialogDescription>{t('clone.description')}</DialogDescription>
          </DialogHeader>
          <Input
            value={cloneName}
            onChange={(event) => setCloneName(event.target.value)}
            placeholder={t('clone.placeholder')}
            aria-label={t('clone.name')}
            autoFocus
            maxLength={160}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setCloneOpen(false)}>{t('action.cancel')}</Button>
            <Button
              onClick={() => void cloneAction.execute(cloneName.trim())}
              disabled={!cloneName.trim() || cloneAction.isLoading}
            >
              {cloneAction.isLoading ? t('clone.creating') : t('clone.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Metric({ icon: Icon, value, label }: Readonly<{ icon: typeof Database; value: number; label: string }>) {
  return <div className='rounded-lg bg-muted/45 p-2.5'><Icon className='mb-1 h-4 w-4 text-muted-foreground' /><span className='font-semibold text-foreground'>{value}</span><span className='ml-1 text-muted-foreground'>{label}</span></div>;
}
