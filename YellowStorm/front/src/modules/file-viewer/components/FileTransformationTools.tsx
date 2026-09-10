import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileCog, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showError, showSuccess } from '@/lib/notifications';
import { createDecisionFlowArtifact, getWorkspaceArtifactConfiguration } from '@/modules/workspace/artifact-api';
import { useWorkspaceStore } from '@/modules/workspace/store';
import type { DecisionFlowDetailLevel, DecisionFlowGenerationOptions, DecisionFlowTargetAudience, DecisionFlowType } from '@/modules/workspace/types';
import { useModuleTranslation } from '@/modules/localization';
import type { FileTab } from '../types';
import { useFileViewerStore } from '../store';
import { PageRangeField } from '../transformations/decision-flow/PageRangeField';
import { PageRangeError, parsePageRange } from '../transformations/decision-flow/page-range';

const defaultOptions: DecisionFlowGenerationOptions = {
  flowType: 'eligibility',
  targetAudiences: ['infer_from_document'],
  detailLevel: 'standard',
  ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true },
};

const flowTypes: DecisionFlowType[] = ['eligibility', 'orientation', 'guided_diagnostic', 'procedure', 'other'];
const audiences: DecisionFlowTargetAudience[] = ['business_creator', 'artisan', 'merchant', 'existing_business', 'infer_from_document'];
const detailLevels: DecisionFlowDetailLevel[] = ['synthetic', 'standard', 'detailed'];
const ambiguityPolicyKeys: Array<keyof DecisionFlowGenerationOptions['ambiguityPolicy']> = ['doNotInvent', 'createToConfirmNodes', 'citeSourcePassages', 'identifyContradictions'];

function navigateToArtifact(workspaceId: string, artifactId: string) {
  const hash = `#/workspace/${workspaceId}/artifacts/${artifactId}`;
  window.history.pushState(null, '', hash);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function FileTransformationTools({ tab }: Readonly<{ tab: FileTab }>) {
  const { t } = useModuleTranslation('file-viewer');
  const refreshArtifacts = useWorkspaceStore((state) => state.refreshWorkspaceArtifacts);
  const closeViewer = useFileViewerStore((state) => state.closeViewer);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const dialogOpenTimeoutRef = useRef<number | null>(null);
  const [name, setName] = useState(t('transformation.defaultName', { name: tab.fileName.replace(/\.pdf$/i, '') }));
  const [mode, setMode] = useState<'all' | 'pages'>('all');
  const [pages, setPages] = useState('');
  const [options, setOptions] = useState<DecisionFlowGenerationOptions>(defaultOptions);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (dialogOpenTimeoutRef.current !== null) {
      window.clearTimeout(dialogOpenTimeoutRef.current);
      dialogOpenTimeoutRef.current = null;
    }
    setOpen(false);
    setMenuOpen(false);
    setName(t('transformation.defaultName', { name: tab.fileName.replace(/\.pdf$/i, '') }));
    setMode('all');
    setPages('');
    setOptions(defaultOptions);
  }, [tab.documentId, tab.fileName]);

  useEffect(() => () => {
    if (dialogOpenTimeoutRef.current !== null) window.clearTimeout(dialogOpenTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!tab.workspaceId) return;
    setConfigured(null);
    void getWorkspaceArtifactConfiguration(tab.workspaceId).then((value) => setConfigured(value.configured)).catch(() => setConfigured(false));
  }, [tab.workspaceId]);

  if (tab.mimeType !== 'application/pdf' || !tab.workspaceId || !tab.documentId || !tab.path || !tab.canWriteWorkspace) return null;

  const selectAudience = (audience: DecisionFlowTargetAudience, checked: boolean) => {
    setOptions((current) => {
      if (audience === 'infer_from_document') return { ...current, targetAudiences: checked ? ['infer_from_document'] : current.targetAudiences.filter((value) => value !== audience) };
      const explicit = current.targetAudiences.filter((value) => value !== 'infer_from_document');
      return { ...current, targetAudiences: checked ? [...new Set([...explicit, audience])] : explicit.filter((value) => value !== audience) };
    });
  };

  const openDecisionFlowDialog = () => {
    if (dialogOpenTimeoutRef.current !== null) return;
    setMenuOpen(false);
    dialogOpenTimeoutRef.current = window.setTimeout(() => {
      dialogOpenTimeoutRef.current = null;
      setOpen(true);
    }, 0);
  };

  const create = async () => {
    let selected: number[] | undefined;
    if (mode === 'pages') {
      try {
        selected = parsePageRange(pages, tab.pageCount ?? 0);
      } catch (error) {
        const code = error instanceof PageRangeError ? error.code : 'invalid';
        showError(t(`transformation.pageError.${code}`, { pageCount: tab.pageCount ?? 0 }));
        return;
      }
    }
    if (!options.targetAudiences.length || (options.flowType === 'other' && !options.customFlowType?.trim())) {
      showError(t('transformation.optionsRequired'));
      return;
    }
    setSaving(true);
    try {
      const artifact = await createDecisionFlowArtifact(tab.workspaceId!, { sourceDocumentId: tab.documentId!, name: name.trim(), selectionMode: mode, pages: selected, generationOptions: options });
      navigateToArtifact(tab.workspaceId!, artifact.id);
      setOpen(false);
      closeViewer();
      showSuccess(t('transformation.queued'));
      void refreshArtifacts();
    } catch (error) {
      const description = error && typeof error === 'object' && 'message' in error ? String(error.message) : undefined;
      showError(t('transformation.createFailed'), { description });
    } finally {
      setSaving(false);
    }
  };

  return <>
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button ref={toolsButtonRef} size='sm' variant='outline' className='gap-1.5' disabled={configured !== true} title={configured === false ? t('transformation.notConfigured') : undefined}>
          {configured === null ? <Loader2 className='h-4 w-4 animate-spin' /> : <Sparkles className='h-4 w-4' />}
          {t('transformation.tools')}
          <ChevronDown className='h-3.5 w-3.5' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='z-[60]'>
        <DropdownMenuItem className='cursor-pointer' onClick={openDecisionFlowDialog} onSelect={openDecisionFlowDialog}>
          <FileCog className='h-4 w-4' />
          {t('transformation.decisionFlow')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className='z-[70] max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto' onCloseAutoFocus={(event) => {
      event.preventDefault();
      toolsButtonRef.current?.focus();
    }}>
      <form className='space-y-6' onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}>
        <DialogHeader>
          <DialogTitle>{t('transformation.title')}</DialogTitle>
          <DialogDescription>{t('transformation.description')}</DialogDescription>
        </DialogHeader>
        <div className='grid gap-6 md:grid-cols-2'>
          <section className='space-y-4'>
            <h3 className='text-sm font-semibold'>{t('transformation.sourceSection')}</h3>
            <div className='space-y-2'>
              <Label htmlFor='decision-flow-name'>{t('transformation.name')}</Label>
              <Input id='decision-flow-name' value={name} onChange={(event) => setName(event.target.value)} maxLength={150} />
            </div>
            <fieldset className='space-y-2'>
              <legend className='text-sm font-medium'>{t('transformation.content')}</legend>
              <label className='flex items-center gap-2 text-sm'><input type='radio' checked={mode === 'all'} onChange={() => setMode('all')} />{t('transformation.entireDocument')}</label>
              <label className='flex items-center gap-2 text-sm'><input type='radio' checked={mode === 'pages'} onChange={() => setMode('pages')} />{t('transformation.selectedPages')}</label>
            </fieldset>
            {mode === 'pages' && <PageRangeField value={pages} onChange={setPages} currentPage={tab.currentPage} disabled={!tab.pageCount} />}
            <fieldset className='space-y-2'>
              <legend className='text-sm font-semibold'>{t('transformation.flowType')}</legend>
              {flowTypes.map((flowType) => <label key={flowType} className='flex items-center gap-2 text-sm'><input type='radio' name='flow-type' checked={options.flowType === flowType} onChange={() => setOptions((current) => ({ ...current, flowType }))} />{t(`transformation.flowType.${flowType}`)}</label>)}
              {options.flowType === 'other' && <Input value={options.customFlowType ?? ''} onChange={(event) => setOptions((current) => ({ ...current, customFlowType: event.target.value }))} placeholder={t('transformation.flowType.otherPlaceholder')} maxLength={120} />}
            </fieldset>
          </section>
          <section className='space-y-5'>
            <fieldset className='space-y-2'>
              <legend className='text-sm font-semibold'>{t('transformation.audience')}</legend>
              {audiences.map((audience) => <label key={audience} className='flex items-center gap-2 text-sm'><Checkbox checked={options.targetAudiences.includes(audience)} onCheckedChange={(checked) => selectAudience(audience, checked === true)} />{t(`transformation.audience.${audience}`)}</label>)}
            </fieldset>
            <fieldset className='space-y-2'>
              <legend className='text-sm font-semibold'>{t('transformation.detail')}</legend>
              {detailLevels.map((detailLevel) => <label key={detailLevel} className='flex items-start gap-2 text-sm'><input className='mt-1' type='radio' name='detail-level' checked={options.detailLevel === detailLevel} onChange={() => setOptions((current) => ({ ...current, detailLevel }))} /><span>{t(`transformation.detail.${detailLevel}`)}</span></label>)}
            </fieldset>
            <fieldset className='space-y-2'>
              <legend className='text-sm font-semibold'>{t('transformation.ambiguity')}</legend>
              {ambiguityPolicyKeys.map((key) => <label key={key} className='flex items-start gap-2 text-sm'><Checkbox checked={options.ambiguityPolicy[key]} onCheckedChange={(next) => setOptions((current) => ({ ...current, ambiguityPolicy: { ...current.ambiguityPolicy, [key]: next === true } }))} /><span>{t(`transformation.ambiguity.${key}`)}</span></label>)}
            </fieldset>
          </section>
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => setOpen(false)} disabled={saving}>{t('transformation.cancel')}</Button>
          <Button type='submit' disabled={saving || !name.trim() || (mode === 'pages' && (!pages.trim() || !tab.pageCount))}>
            {saving ? t('transformation.creating') : t('transformation.create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
    </Dialog>
  </>;
}
