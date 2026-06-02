import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  createConnectorCategory,
  deleteConnectorCategory,
  getConnectorCategories,
  updateConnectorCategory,
} from '../../api';
import type { ConnectorCategoryResponse } from '../../types';

interface ManageCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCategoriesChanged?: () => void;
}

export function ManageCategoriesDialog({ open, onOpenChange, onCategoriesChanged }: Readonly<ManageCategoriesDialogProps>) {
  const [categories, setCategories] = useState<ConnectorCategoryResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [deleting, setDeleting] = useState<ConnectorCategoryResponse | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConnectorCategories();
      setCategories(data);
    } catch (err) {
      toast.error('Failed to load categories', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchCategories();
      setNewName('');
      setNewDescription('');
      setEditingId(null);
    }
  }, [open, fetchCategories]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      await createConnectorCategory({ name, description: newDescription.trim() || undefined });
      toast.success('Category created');
      setNewName('');
      setNewDescription('');
      await fetchCategories();
      onCategoriesChanged?.();
    } catch (err) {
      toast.error('Failed to create category', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (category: ConnectorCategoryResponse) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditDescription('');
  };

  const handleUpdate = async (id: string) => {
    const name = editName.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      await updateConnectorCategory(id, { name, description: editDescription.trim() });
      toast.success('Category updated');
      cancelEdit();
      await fetchCategories();
      onCategoriesChanged?.();
    } catch (err) {
      toast.error('Failed to update category', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteConnectorCategory(deleting.id);
      toast.success('Category deleted');
      setDeleting(null);
      await fetchCategories();
      onCategoriesChanged?.();
    } catch (err) {
      toast.error('Failed to delete category', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-w-xl max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>Manage categories</DialogTitle>
          </DialogHeader>

          <div className='space-y-4 py-2'>
            <div className='space-y-2 rounded-md border p-3'>
              <Label className='text-sm font-medium'>New category</Label>
              <Input
                placeholder='Name'
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={saving}
              />
              <Textarea
                placeholder='Description (optional)'
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                disabled={saving}
              />
              <div className='flex justify-end'>
                <Button size='sm' onClick={handleCreate} disabled={saving || !newName.trim()}>
                  {saving ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Plus className='mr-2 h-4 w-4' />}
                  Add
                </Button>
              </div>
            </div>

            {loading ? (
              <div className='flex justify-center py-6'>
                <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
              </div>
            ) : categories.length === 0 ? (
              <p className='py-6 text-center text-sm text-muted-foreground'>No categories yet.</p>
            ) : (
              <ul className='divide-y rounded-md border'>
                {categories.map((cat) => {
                  const isEditing = editingId === cat.id;
                  return (
                    <li key={cat.id} className='p-3'>
                      {isEditing ? (
                        <div className='space-y-2'>
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder='Name'
                            disabled={saving}
                          />
                          <Textarea
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder='Description (optional)'
                            rows={2}
                            disabled={saving}
                          />
                          <div className='flex justify-end gap-2'>
                            <Button variant='outline' size='sm' onClick={cancelEdit} disabled={saving}>
                              <X className='mr-1 h-4 w-4' />
                              Cancel
                            </Button>
                            <Button size='sm' onClick={() => handleUpdate(cat.id)} disabled={saving || !editName.trim()}>
                              {saving ? <Loader2 className='mr-1 h-4 w-4 animate-spin' /> : <Check className='mr-1 h-4 w-4' />}
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <span className='font-medium'>{cat.name}</span>
                              {cat.isSystem && (
                                <span className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
                                  <Lock className='h-3 w-3' />
                                  System
                                </span>
                              )}
                            </div>
                            {cat.description && (
                              <p className='text-sm text-muted-foreground line-clamp-2'>{cat.description}</p>
                            )}
                          </div>
                          {cat.isSystem ? (
                            <p className='shrink-0 text-xs text-muted-foreground'>Built-in</p>
                          ) : (
                            <div className='flex gap-1'>
                              <Button variant='ghost' size='icon' onClick={() => startEdit(cat)} aria-label='Edit category'>
                                <Pencil className='h-4 w-4' />
                              </Button>
                              <Button
                                variant='ghost'
                                size='icon'
                                className='text-destructive'
                                onClick={() => setDeleting(cat)}
                                aria-label='Delete category'
                              >
                                <Trash2 className='h-4 w-4' />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleting?.name}</strong>? Connectors using this category will keep working but lose their category assignment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-destructive text-destructive-foreground'>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
