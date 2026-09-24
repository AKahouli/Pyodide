import { useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../../store';

export function ObjectNavigator() {
  const { t } = useModuleTranslation('semantic-model');
  const [search, setSearch] = useState('');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const selectedId = useSemanticModelEditorStore((state) => state.selectedId);
  const select = useSemanticModelEditorStore((state) => state.select);
  const nodes = (graph?.nodes ?? []).filter((node) => !node.systemKey && `${node.label} ${node.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));

  return <aside className='flex w-full shrink-0 flex-col border-b bg-background md:w-72 md:border-b-0 md:border-r' aria-label={t('workspaceUi.objects')}>
    <div className='space-y-3 border-b p-3 md:p-4'>
      <div className='hidden md:block'><h2 className='font-semibold'>{t('workspaceUi.objects')}</h2><p className='text-xs text-muted-foreground'>{t('journey.conceptCount', { count: graph?.nodes.filter((node) => !node.systemKey).length ?? 0 })}</p></div>
      <select className='h-11 w-full rounded-lg border bg-background px-3 text-sm md:hidden' value={selectedId ?? ''} onChange={(event) => select(event.target.value || null)} aria-label={t('workspaceUi.objects')}><option value=''>{t('workspaceUi.chooseObject')}</option>{graph?.nodes.filter((node) => !node.systemKey).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
      <div className='relative hidden md:block'><Search className='pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' /><Input className='pl-9' value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('workspaceUi.searchObjects')} aria-label={t('workspaceUi.searchObjects')} /></div>
    </div>
    <div className='hidden space-y-1 overflow-y-auto p-2 md:block md:flex-1'>
      {nodes.map((node) => {
        const relationships = graph?.relations.filter((relation) => relation.sourceNodeTypeId === node.id || relation.targetNodeTypeId === node.id).length ?? 0;
        return <button key={node.id} type='button' onClick={() => select(node.id)} aria-current={selectedId === node.id ? 'true' : undefined} className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selectedId === node.id ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/70'}`}>
          <span className='min-w-0 flex-1'><span className='block truncate text-sm font-semibold'>{node.label}</span><span className='mt-0.5 block line-clamp-2 text-xs text-muted-foreground'>{node.description || t('editor.noDescription')}</span><span className='mt-2 block text-[11px] text-muted-foreground'>{t('workspaceUi.objectMeta', { fields: node.attributes.length, relationships })}</span></span><ArrowRight className='mt-1 h-4 w-4 shrink-0 text-muted-foreground' />
        </button>;
      })}
      {nodes.length === 0 && <p className='p-4 text-sm text-muted-foreground'>{search ? t('workspaceUi.noMatch') : t('editor.emptyDescription')}</p>}
    </div>
  </aside>;
}
