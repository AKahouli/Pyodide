import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Check, ChevronDown, History, Layers, Loader2, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { SEARCH_THRESHOLD } from '../common/Select';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { MappingPreset, MappingSettings } from '../../types';
import { INPUT_COMPACT, ROW_LIST, SectionHeader } from '../form/FormParts';

/** What the mapping was started from, and its settings right after, to tell when it was changed since. */
interface Applied {
  name: string;
  presetId?: string;
  /** The settings before applying, for Undo. */
  before: MappingSettings;
  baseline?: string;
}

/** The fields a preset reads that the concept does not have (any more). */
export function droppedFields(settings: MappingSettings, attributes: ReadonlyArray<{ key: string }>) {
  const keys = new Set(attributes.map((attribute) => attribute.key));
  return settings.fieldMappings.map((mapping) => mapping.targetAttribute).filter((key) => !keys.has(key));
}

const settingsKey = (settings: MappingSettings) => JSON.stringify([settings.fieldMappings, settings.aiSettings, settings.identityFields]);

/**
 * Start a mapping from the last one saved for the concept or from a named preset, and save the
 * current settings as a preset. Applying copies the settings: changing a preset later does not
 * change mappings already saved. A new mapping starts from the last one by itself, with Undo.
 */
export function MappingPresetBar({ modelId, conceptId, attributes, current, onApply, autoStart, canEdit = true }: Readonly<{
  modelId: string;
  conceptId: string;
  attributes: ReadonlyArray<{ key: string; label?: string }>;
  current: MappingSettings;
  /** Replaces the settings; `exact` also replaces empty identity fields (Undo). */
  onApply: (settings: MappingSettings, exact: boolean) => void;
  /** A new mapping, not edited yet: start from the last mapping of the concept. */
  autoStart: boolean;
  canEdit?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const [applied, setApplied] = useState<Applied | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const autoStarted = useRef<string | null>(null);

  const presetsQuery = useQuery({
    queryKey: semanticModelQueryKeys.mappingPresets(modelId, conceptId),
    queryFn: () => semanticModelApi.listMappingPresets(modelId, conceptId),
    enabled: Boolean(conceptId),
  });
  const lastQuery = useQuery({
    queryKey: semanticModelQueryKeys.lastUsedMapping(modelId, conceptId),
    queryFn: () => semanticModelApi.lastUsedMapping(modelId, conceptId),
    enabled: Boolean(conceptId) && canEdit,
    staleTime: 30_000,
  });
  const presets = presetsQuery.data ?? [];
  const [presetSearch, setPresetSearch] = useState('');
  const presetQuery = presetSearch.trim().toLowerCase();
  const shownPresets = presetQuery ? presets.filter((preset) => `${preset.name} ${preset.description ?? ''}`.toLowerCase().includes(presetQuery)) : presets;
  const last = lastQuery.data;
  const currentKey = settingsKey(current);
  const label = (key: string) => attributes.find((attribute) => attribute.key === key)?.label ?? key;
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const lastName = last ? t('mapping.presets.lastUsedItem', { source: last.sourceName ?? t('mapping.presets.unlinked'), date: date(last.updatedAt) }) : '';

  const apply = (settings: MappingSettings, appliedName: string, presetId?: string) => {
    setApplied({ name: appliedName, presetId, before: current });
    setDropped(droppedFields(settings, attributes));
    onApply(settings, false);
  };
  // The settings right after applying are known once the drawer has re-rendered with them.
  useEffect(() => {
    if (applied && applied.baseline === undefined) setApplied({ ...applied, baseline: currentKey });
  }, [applied, currentKey]);
  // Declared before the auto start, so a concept change clears first and then starts again.
  useEffect(() => { setApplied(null); setDropped([]); }, [conceptId]);
  // Each new mapping of a concept starts once from its last mapping.
  useEffect(() => {
    const key = `${modelId}:${conceptId}`;
    if (!autoStart || !last || autoStarted.current === key) return;
    autoStarted.current = key;
    apply(last, lastName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, last, conceptId, modelId]);

  const undo = () => {
    if (!applied) return;
    onApply(applied.before, true);
    setApplied(null);
    setDropped([]);
  };
  const modified = Boolean(applied?.baseline && applied.baseline !== currentKey);

  const refresh = () => client.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingPresets(modelId, conceptId) });
  const save = useMutation({
    mutationFn: (presetId?: string) => semanticModelApi.saveMappingPreset(modelId, {
      conceptId, name: name.trim() || applied?.name || '', description: description.trim() || undefined, ...current,
    }, presetId),
    onSuccess: async (preset) => {
      await refresh();
      setApplied({ name: preset.name, presetId: preset.id, before: applied?.before ?? current, baseline: currentKey });
      setSaveOpen(false);
      showSuccess(t('mapping.presets.saved', { name: preset.name }));
    },
    onError: (error) => showError(parseApiError(error).message || t('mapping.presets.saveError')),
  });
  // Updating the applied preset keeps its name and description.
  const update = useMutation({
    mutationFn: (preset: MappingPreset) => semanticModelApi.saveMappingPreset(modelId, {
      conceptId, name: preset.name, description: preset.description ?? undefined, ...current,
    }, preset.id),
    onSuccess: async (preset) => {
      await refresh();
      setApplied((value) => value && { ...value, baseline: currentKey });
      showSuccess(t('mapping.presets.saved', { name: preset.name }));
    },
    onError: (error) => showError(parseApiError(error).message || t('mapping.presets.saveError')),
  });
  const remove = useMutation({
    mutationFn: (preset: MappingPreset) => semanticModelApi.deleteMappingPreset(modelId, preset.id),
    onSuccess: async (_result, preset) => {
      await refresh();
      setConfirmDelete(null);
      if (applied?.presetId === preset.id) setApplied((value) => value && { ...value, presetId: undefined });
      showSuccess(t('mapping.presets.deleted', { name: preset.name }));
    },
    onError: (error) => showError(parseApiError(error).message || t('mapping.presets.saveError')),
  });

  const sameName = presets.find((preset) => preset.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  const appliedPreset = presets.find((preset) => preset.id === applied?.presetId);
  const openSave = (open: boolean) => {
    setSaveOpen(open);
    if (open) { setName(appliedPreset?.name ?? ''); setDescription(appliedPreset?.description ?? ''); setConfirmDelete(null); }
  };

  return <div className='space-y-1.5'>
    <div className='flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/40 p-2' role='group' aria-label={t('mapping.presets.title')}>
      <Layers className='h-3.5 w-3.5 text-muted-foreground' aria-hidden />
      <span className='text-xs text-muted-foreground'>{t('mapping.presets.startFrom')}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type='button' size='sm' variant='outline' className='h-7 max-w-[16rem] gap-1 px-2 text-xs'>
            <span className='truncate'>{applied?.name ?? t('mapping.presets.choose')}</span>
            {(presetsQuery.isFetching || lastQuery.isFetching) ? <Loader2 className='h-3 w-3 shrink-0 animate-spin' /> : <ChevronDown className='h-3 w-3 shrink-0' />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='flex max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-72 flex-col overflow-hidden'>
          {canEdit && <>
            <DropdownMenuLabel className='text-[11px] font-medium text-muted-foreground'>{t('mapping.presets.lastUsed')}</DropdownMenuLabel>
            {last ? <DropdownMenuItem className='text-xs' onSelect={() => apply(last, lastName)}>
              <History className='mr-2 h-3.5 w-3.5 shrink-0' /><span className='truncate'>{lastName}</span>
            </DropdownMenuItem> : <p className='px-2 py-1 text-[11px] text-muted-foreground'>{t('mapping.presets.noLastUsed')}</p>}
            <DropdownMenuSeparator />
          </>}
          <DropdownMenuLabel className='text-[11px] font-medium text-muted-foreground'>{t('mapping.presets.presets')}</DropdownMenuLabel>
          {presets.length > SEARCH_THRESHOLD && <input
            className='mx-1 mb-1 h-8 rounded-md border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground'
            value={presetSearch}
            placeholder={t('action.searchList')}
            aria-label={t('action.searchList')}
            onChange={(event) => setPresetSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key !== 'Escape' && event.key !== 'ArrowDown') event.stopPropagation(); }}
          />}
          <div className='min-h-0 flex-1 overflow-y-auto'>
          {shownPresets.map((preset) => <DropdownMenuItem key={preset.id} className='items-start text-xs' onSelect={() => apply(preset, preset.name, preset.id)}>
            {applied?.presetId === preset.id ? <Check className='mr-2 mt-0.5 h-3.5 w-3.5 shrink-0' /> : <span className='mr-2 w-3.5 shrink-0' />}
            <span className='min-w-0'>
              <span className='block truncate'>{preset.name}</span>
              {preset.description && <span className='block truncate text-[11px] text-muted-foreground'>{preset.description}</span>}
            </span>
          </DropdownMenuItem>)}
          {presets.length > 0 && !shownPresets.length && <p className='px-2 py-1 text-[11px] text-muted-foreground'>{t('action.noListMatch')}</p>}
          </div>
          {!presets.length && <p className='px-2 py-1 text-[11px] text-muted-foreground'>{presetsQuery.isError ? t('mapping.presets.loadError') : t('mapping.presets.noPresets')}</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      {applied && modified && <span className='rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300'>{t('mapping.presets.modified')}</span>}
      {applied && <Button type='button' size='sm' variant='ghost' className='h-7 px-2 text-xs' onClick={undo}><Undo2 className='mr-1 h-3 w-3' />{t('mapping.presets.undo')}</Button>}
      {canEdit && <div className='ml-auto flex items-center gap-1'>
        {appliedPreset && modified && <Button type='button' size='sm' variant='ghost' className='h-7 px-2 text-xs' disabled={update.isPending}
          onClick={() => update.mutate(appliedPreset)}>{t('mapping.presets.update', { name: appliedPreset.name })}</Button>}
        <Popover open={saveOpen} onOpenChange={openSave}>
          <PopoverTrigger asChild>
            <Button type='button' size='sm' variant='outline' className='h-7 px-2 text-xs'><BookmarkPlus className='mr-1 h-3.5 w-3.5' />{t('mapping.presets.save')}</Button>
          </PopoverTrigger>
          <PopoverContent align='end' className='w-80 space-y-4 p-4'>
            <form className='space-y-3' onSubmit={(event) => { event.preventDefault(); if (name.trim()) save.mutate(sameName?.id); }}>
              <SectionHeader title={t('mapping.presets.save')} help={t('mapping.presets.saveHelp')} />
              <Input className={INPUT_COMPACT} value={name} maxLength={80} autoFocus placeholder={t('mapping.presets.name')} aria-label={t('mapping.presets.name')} onChange={(event) => setName(event.target.value)} />
              <Input className={INPUT_COMPACT} value={description} maxLength={500} placeholder={t('mapping.presets.description')} aria-label={t('mapping.presets.description')} onChange={(event) => setDescription(event.target.value)} />
              <Button type='submit' size='sm' className='h-8 w-full text-xs' disabled={!name.trim() || save.isPending}>
                {save.isPending && <Loader2 className='mr-1 h-3 w-3 animate-spin' />}
                {sameName ? t('mapping.presets.replace', { name: sameName.name }) : t('mapping.presets.saveButton')}
              </Button>
            </form>
            {presets.length > 0 && <div className='space-y-2 border-t pt-4'>
              <SectionHeader title={t('mapping.presets.presets')} count={presets.length} />
              <ul className={cn(ROW_LIST, 'max-h-40 overflow-y-auto')}>
                {presets.map((preset) => <li key={preset.id} className='flex items-center gap-1 py-1 pl-2.5 pr-1 text-xs'>
                  <span className='min-w-0 flex-1 truncate'>{preset.name}</span>
                  {confirmDelete === preset.id
                    ? <Button type='button' size='sm' variant='destructive' className='h-6 px-2 text-[11px]' disabled={remove.isPending} onClick={() => remove.mutate(preset)}>{t('mapping.presets.confirmDelete')}</Button>
                    : <Button type='button' size='icon' variant='ghost' className='h-6 w-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive' aria-label={t('mapping.presets.delete', { name: preset.name })} title={t('mapping.presets.delete', { name: preset.name })} onClick={() => setConfirmDelete(preset.id)}><Trash2 className='h-3 w-3' /></Button>}
                </li>)}
              </ul>
            </div>}
          </PopoverContent>
        </Popover>
      </div>}
    </div>
    {applied && <p role='status' className='text-[11px] text-muted-foreground'>
      {t('mapping.presets.started', { name: applied.name })}
      {dropped.length > 0 && <span className='text-amber-800 dark:text-amber-300'> · {t('mapping.presets.dropped', { count: dropped.length, fields: dropped.map(label).join(', ') })}</span>}
    </p>}
  </div>;
}
