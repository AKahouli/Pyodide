import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Brain, Download, FolderTree, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { createSkill, deleteSkill, exportSkill, getSkills, getSkillCategories, importSkill, updateSkill } from '../api';
import type { SkillListResponse, SkillResponse, SkillCategoryResponse } from '../types';
import { CreateEditSkillDialog } from './skills/CreateEditSkillDialog';
import { ManageSkillCategoriesDialog } from './skills/ManageSkillCategoriesDialog';
import { IconDisplay } from './connectors/IconDisplay';
import type { SkillFormValues } from './skills/skill-form-schema';
import { CatalogTransferDialog } from '../components/CatalogTransferDialog';

const CARDS_PER_CATEGORY = 6;
const UNCATEGORIZED_KEY = '__uncategorized__';

function parseMetadata(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Metadata must be a JSON object.');
  }

  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function parseAllowedTools(text: string): string[] {
  return text.split(',').map((value) => value.trim()).filter(Boolean);
}

export function SkillsPage() {
  const { t } = useModuleTranslation('admin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<SkillCategoryResponse[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('__all__');
  const [saving, setSaving] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [transferMode, setTransferMode] = useState<'export' | 'import' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchSkills = useCallback(async (searchValue?: string) => {
    setLoading(true);
    setError(null);

    try {
      const data: SkillListResponse = await getSkills({
        page: 1,
        limit: 1000,
        search: searchValue ?? search,
      });
      setSkills(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await getSkillCategories();
      setCategories(data);
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    void fetchSkills();
    void fetchCategories();
  }, [fetchSkills, fetchCategories]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchSkills(search); }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchSkills]);

  const toggleCategoryExpanded = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groupedSkills = (() => {
    const byCategory = new Map<string, SkillResponse[]>();
    for (const skill of skills) {
      const key = skill.categoryId || UNCATEGORIZED_KEY;
      const list = byCategory.get(key) ?? [];
      list.push(skill);
      byCategory.set(key, list);
    }

    const groups: Array<{ key: string; name: string; description: string; items: SkillResponse[] }> = [];
    for (const cat of categories) {
      const items = byCategory.get(cat.id);
      if (items && items.length > 0) {
        groups.push({ key: cat.id, name: cat.name, description: cat.description, items });
      }
    }
    const uncategorized = byCategory.get(UNCATEGORIZED_KEY);
    if (uncategorized && uncategorized.length > 0) {
      groups.push({ key: UNCATEGORIZED_KEY, name: 'Uncategorized', description: '', items: uncategorized });
    }
    return groups;
  })();

  const visibleGroups = categoryFilter === '__all__'
    ? groupedSkills
    : groupedSkills.filter((group) => group.key === categoryFilter);
  const visibleSkillIds = visibleGroups.flatMap((group) => group.items.map((skill) => skill.id));

  const handleSave = async (data: SkillFormValues) => {
    setSaving(true);
    try {
      const payload = {
        slug: editingSkill?.slug ?? data.name,
        name: data.name,
        description: data.description,
        icon: data.icon || undefined,
        color: data.color || undefined,
        iconColor: data.iconColor || undefined,
        categoryId: data.categoryId ? data.categoryId : null,
        license: data.license || undefined,
        compatibility: data.compatibility || undefined,
        allowedTools: parseAllowedTools(data.allowedToolsText),
        metadata: parseMetadata(data.metadataText),
        instructions: data.instructions,
        isActive: data.isActive,
      };

      if (editingSkill) {
        await updateSkill(editingSkill.id, payload);
        toast.success('Skill updated', { description: `${data.name} was updated.` });
      } else {
        await createSkill(payload);
        toast.success('Skill created', { description: `${data.name} was created.` });
      }

      setShowDialog(false);
      setEditingSkill(null);
      fetchSkills();
    } catch (err) {
      toast.error(editingSkill ? 'Failed to update skill' : 'Failed to create skill', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setSaving(true);
    try {
      const skill = await importSkill(file);
      toast.success('Skill imported', { description: `${skill.name} was imported from ${file.name}.` });
      fetchSkills();
    } catch (err) {
      toast.error('Failed to import skill', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (skill: SkillResponse) => {
    try {
      const blob = await exportSkill(skill.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(t('skills.toasts.exported.title'), { description: t('skills.toasts.exported.description', { name: skill.name }) });
    } catch (err) {
      toast.error(t('skills.toasts.errors.export'), {
        description: err instanceof Error ? err.message : t('skills.errors.unknown'),
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingSkill) {
      return;
    }
    try {
      await deleteSkill(deletingSkill.id);
      toast.success('Skill deleted', { description: `${deletingSkill.name} was deleted.` });
      setDeletingSkill(null);
      fetchSkills();
    } catch (err) {
      toast.error('Failed to delete skill', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  if (loading && skills.length === 0) {
    return <div className='flex items-center justify-center h-96'><Loader2 className='h-8 w-8 animate-spin text-muted-foreground' /></div>;
  }

  if (error && skills.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center h-96 gap-4'>
        <AlertCircle className='h-12 w-12 text-destructive' />
        <p className='text-muted-foreground'>{error}</p>
        <Button onClick={() => fetchSkills()} variant='outline'><RefreshCw className='mr-2 h-4 w-4' />Retry</Button>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <input ref={fileInputRef} type='file' className='hidden' accept='.md,.zip' onChange={handleImportFile} />

      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Skills</h1>
          <p className='text-muted-foreground'>Manage AgentSkills-compatible skill packages and imports.</p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button onClick={() => fetchSkills()} variant='outline' size='icon' aria-label={t('catalogTransfer.refreshSkills')}><RefreshCw className='h-4 w-4' /></Button>
          <Button variant='outline' onClick={() => setShowCategoriesDialog(true)}><FolderTree className='mr-2 h-4 w-4' />Manage Categories</Button>
          <Button variant='outline' onClick={handleImportClick} disabled={saving}><Upload className='mr-2 h-4 w-4' />Import .md/.zip</Button>
          <Button variant='outline' onClick={() => setTransferMode('import')}><Upload className='mr-2 h-4 w-4' />{t('catalogTransfer.importCatalog')}</Button>
          <Button variant='outline' onClick={() => setTransferMode('export')}><Download className='mr-2 h-4 w-4' />{t('catalogTransfer.exportCatalog')}</Button>
          <Button onClick={() => { setEditingSkill(null); setShowDialog(true); }}><Plus className='mr-2 h-4 w-4' />Add Skill</Button>
        </div>
      </div>

      <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
        <div className='relative w-full sm:max-w-sm'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
          <Input placeholder='Search skills' value={search} onChange={(e) => setSearch(e.target.value)} className='pl-9' />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className='w-full sm:w-[220px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__all__'>All categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
            <SelectItem value={UNCATEGORIZED_KEY}>Uncategorized</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className='flex items-center gap-3'>
        <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'><Brain className='h-5 w-5' /></div>
        <div>
          <h2 className='font-semibold'>Skill Catalog</h2>
          <p className='text-sm text-muted-foreground'>{total} skills available</p>
        </div>
      </div>

      {visibleSkillIds.length ? (
        <div className='flex items-center gap-3 text-sm text-muted-foreground'>
          <Checkbox
            id='select-visible-skills'
            checked={visibleSkillIds.every((id) => selectedIds.has(id))}
            onCheckedChange={(checked) => setSelectedIds((current) => {
              const next = new Set(current);
              visibleSkillIds.forEach((id) => checked === true ? next.add(id) : next.delete(id));
              return next;
            })}
          />
          <label htmlFor='select-visible-skills'>{t('catalogTransfer.selectVisibleSkills', { count: selectedIds.size })}</label>
        </div>
      ) : null}

      {skills.length === 0 ? (
        <div className='flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground'>
          {search ? 'No skills match your search.' : 'No skills yet.'}
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className='flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground'>
          No skills in this category.
        </div>
      ) : (
        <div className='space-y-8'>
          {visibleGroups.map((group) => {
            const isExpanded = expandedCategories.has(group.key);
            const visible = isExpanded ? group.items : group.items.slice(0, CARDS_PER_CATEGORY);
            const hasMore = group.items.length > CARDS_PER_CATEGORY;
            return (
              <section key={group.key} className='space-y-3'>
                <div>
                  <h3 className='text-lg font-semibold'>{group.name}</h3>
                  {group.description && (
                    <p className='text-sm text-muted-foreground'>{group.description}</p>
                  )}
                </div>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
                  {visible.map((skill) => {
                    const iconTextColor = skill.iconColor === 'dark' ? 'text-black' : 'text-white';
                    const initial = skill.name?.trim().charAt(0).toUpperCase() || '?';
                    return (
                      <div
                        key={skill.id}
                        role='button'
                        tabIndex={0}
                        onClick={() => { setEditingSkill(skill); setShowDialog(true); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditingSkill(skill);
                            setShowDialog(true);
                          }
                        }}
                        className={`group relative rounded-lg border bg-card p-4 cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring ${!skill.isActive ? 'opacity-60' : ''}`}
                      >
                        <div className='absolute left-2 top-2 z-10' onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            aria-label={t('catalogTransfer.selectItem', { name: skill.name })}
                            checked={selectedIds.has(skill.id)}
                            onCheckedChange={(checked) => setSelectedIds((current) => {
                              const next = new Set(current);
                              checked === true ? next.add(skill.id) : next.delete(skill.id);
                              return next;
                            })}
                          />
                        </div>
                        <button
                          type='button'
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const updated = await updateSkill(skill.id, { isActive: !skill.isActive });
                              setSkills((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
                            } catch (err) {
                              toast.error('Failed to update skill status', { description: err instanceof Error ? err.message : 'Unknown error' });
                            }
                          }}
                          className='absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          aria-label={skill.isActive ? 'Deactivate skill' : 'Activate skill'}
                          aria-pressed={skill.isActive}
                          title={skill.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                        >
                          <span className={`h-2.5 w-2.5 rounded-full transition-colors ${skill.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                        </button>

                        <div className='absolute top-2 right-9 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-7 w-7'
                            onClick={(e) => { e.stopPropagation(); void handleExport(skill); }}
                            aria-label={t('skills.actions.export')}
                            title={t('skills.actions.export')}
                          >
                            <Download className='h-3.5 w-3.5' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-7 w-7'
                            onClick={(e) => { e.stopPropagation(); setEditingSkill(skill); setShowDialog(true); }}
                            aria-label='Edit skill'
                          >
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-7 w-7 text-destructive'
                            onClick={(e) => { e.stopPropagation(); setDeletingSkill(skill); }}
                            aria-label='Delete skill'
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </Button>
                        </div>

                        <div className='flex items-start gap-3 pl-6 pr-12'>
                          <div
                            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-md'
                            style={{ backgroundColor: skill.color || 'transparent' }}
                          >
                            {skill.icon ? (
                              <IconDisplay icon={skill.icon} size={22} iconColor={skill.iconColor} />
                            ) : (
                              <span className={`text-sm font-bold ${iconTextColor}`}>{initial}</span>
                            )}
                          </div>
                          <div className='min-w-0 flex-1'>
                            <div className='font-semibold truncate'>{skill.name}</div>
                            <p className='text-sm text-muted-foreground line-clamp-2'>{skill.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasMore && (
                  <div className='flex justify-end'>
                    <Button variant='outline' size='sm' onClick={() => toggleCategoryExpanded(group.key)}>
                      {isExpanded ? 'Show less' : `View all (${group.items.length})`}
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <CreateEditSkillDialog open={showDialog} onOpenChange={setShowDialog} skill={editingSkill} onSave={handleSave} saving={saving} />

      <ManageSkillCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        onCategoriesChanged={() => { void fetchCategories(); void fetchSkills(); }}
      />

      <CatalogTransferDialog
        open={transferMode !== null}
        onOpenChange={(open) => { if (!open) setTransferMode(null); }}
        mode={transferMode ?? 'export'}
        resource='skills'
        selectedIds={[...selectedIds]}
        onImported={() => { void fetchCategories(); void fetchSkills(); }}
      />

      <AlertDialog open={!!deletingSkill} onOpenChange={() => setDeletingSkill(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Skill</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {deletingSkill?.name}? Any agents or agent types using it will lose the reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
