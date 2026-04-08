import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Brain, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createSkill, deleteSkill, getSkills, importSkill, updateSkill } from '../api';
import type { SkillListResponse, SkillResponse } from '../types';
import { CreateEditSkillDialog } from './skills/CreateEditSkillDialog';
import type { SkillFormValues } from './skills/skill-form-schema';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchSkills = useCallback(async (searchValue?: string, pageValue?: number) => {
    setLoading(true);
    setError(null);

    try {
      const data: SkillListResponse = await getSkills({
        page: pageValue ?? page,
        limit: 10,
        search: searchValue ?? search,
      });
      setSkills(data.data);
      setTotal(data.meta.total);
      setTotalPages(data.meta.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchSkills(search, 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchSkills, search]);

  const handleSave = async (data: SkillFormValues) => {
    setSaving(true);
    try {
      const payload = {
        name: data.name,
        description: data.description,
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
        <div className='flex gap-2'>
          <Button onClick={() => fetchSkills()} variant='outline' size='icon'><RefreshCw className='h-4 w-4' /></Button>
          <Button variant='outline' onClick={handleImportClick} disabled={saving}><Upload className='mr-2 h-4 w-4' />Import .md/.zip</Button>
          <Button onClick={() => { setEditingSkill(null); setShowDialog(true); }}><Plus className='mr-2 h-4 w-4' />Add Skill</Button>
        </div>
      </div>

      <div className='relative max-w-sm'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
        <Input placeholder='Search skills' value={search} onChange={(e) => setSearch(e.target.value)} className='pl-9' />
      </div>

      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'><Brain className='h-5 w-5' /></div>
            <div>
              <CardTitle>Skill Catalog</CardTitle>
              <CardDescription>{total} skills available</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className='hidden md:table-cell'>Description</TableHead>
                  <TableHead className='hidden lg:table-cell'>Files</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className='h-24 text-center'>{search ? 'No skills match your search.' : 'No skills yet.'}</TableCell></TableRow>
                ) : skills.map((skill) => (
                  <TableRow key={skill.id} className={!skill.isActive ? 'opacity-50' : undefined}>
                    <TableCell>
                      <div className='font-medium'>{skill.name}</div>
                      {skill.allowedTools.length > 0 ? <div className='mt-1 flex flex-wrap gap-1'>{skill.allowedTools.slice(0, 3).map((tool) => <Badge key={tool} variant='secondary' className='text-xs'>{tool}</Badge>)}</div> : null}
                    </TableCell>
                    <TableCell className='hidden md:table-cell max-w-[320px] truncate'>{skill.description}</TableCell>
                    <TableCell className='hidden lg:table-cell'>
                      <Badge variant='outline' className='text-xs'>{skill.files.length}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch checked={skill.isActive} onCheckedChange={async (checked) => {
                        try {
                          const updated = await updateSkill(skill.id, { isActive: checked });
                          setSkills((prev) => prev.map((item) => item.id === updated.id ? updated : item));
                        } catch (err) {
                          toast.error('Failed to update skill status', { description: err instanceof Error ? err.message : 'Unknown error' });
                        }
                      }} />
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-2'>
                        <Button variant='ghost' size='icon' onClick={() => { setEditingSkill(skill); setShowDialog(true); }}><Pencil className='h-4 w-4' /></Button>
                        <Button variant='ghost' size='icon' className='text-destructive' onClick={() => setDeletingSkill(skill)}><Trash2 className='h-4 w-4' /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 ? (
            <div className='flex items-center justify-end gap-2 pt-4'>
              <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); fetchSkills(search, next); }}>Previous</Button>
              <span className='text-sm text-muted-foreground'>Page {page} of {totalPages}</span>
              <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => { const next = page + 1; setPage(next); fetchSkills(search, next); }}>Next</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <CreateEditSkillDialog open={showDialog} onOpenChange={setShowDialog} skill={editingSkill} onSave={handleSave} saving={saving} />

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
