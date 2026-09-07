import { useState } from 'react';
import { AlertTriangle, ArrowRight, Boxes, Database, FileText, Network, Share2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useModuleTranslation } from '@/modules/localization';
import type { SemanticModel } from '../../types';
import { ShareSemanticModelDialog } from './ShareSemanticModelDialog';

export function SemanticModelCard({ model }: Readonly<{ model: SemanticModel }>) {
  const { t } = useModuleTranslation('semantic-model');
  const navigate = useNavigate();
  const automatic = model.kind === 'workspace_default';
  const attention = Boolean(model.brokenBindingCount);
  const isOwner = model.role === 'owner' || !model.role;
  const [shareOpen, setShareOpen] = useState(false);

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
              <span role='status' aria-label={t(model.indexStatus === 'indexed' ? 'indexStatus.indexed' : model.indexStatus === 'failed' ? 'indexStatus.failed' : 'indexStatus.working')} className={`h-2.5 w-2.5 rounded-full ${model.indexStatus === 'indexed' ? 'bg-emerald-500' : model.indexStatus === 'failed' ? 'bg-red-500' : `bg-amber-500 ${model.indexStatus === 'pending' || model.indexStatus === 'in_progress' ? 'animate-pulse' : ''}`}`} title={t(model.indexStatus === 'indexed' ? 'indexStatus.indexed' : model.indexStatus === 'failed' ? 'indexStatus.failed' : 'indexStatus.working')} />
              {isOwner && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7 text-muted-foreground hover:text-primary'
                  title='Partager'
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
            <CardTitle className='line-clamp-1 text-lg'>{model.name}</CardTitle>
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
        <CardFooter>
          <Button className='w-full justify-between' variant='ghost' onClick={() => navigate(`/semantic-models/${model.id}`)}>
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
    </>
  );
}

function Metric({ icon: Icon, value, label }: Readonly<{ icon: typeof Database; value: number; label: string }>) {
  return <div className='rounded-lg bg-muted/45 p-2.5'><Icon className='mb-1 h-4 w-4 text-muted-foreground' /><span className='font-semibold text-foreground'>{value}</span><span className='ml-1 text-muted-foreground'>{label}</span></div>;
}
