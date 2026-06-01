import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, Loader2, Plus } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { scrollToFirstError } from '@/lib/form-utils';
import type { SkillResponse, SkillCategoryResponse } from '../../types';
import { getSkillCategories } from '../../api';
import { defaultSkillFormValues, skillFormSchema, type SkillFormValues } from './skill-form-schema';
import { ManageSkillCategoriesDialog } from './ManageSkillCategoriesDialog';
import { IconPickerPreview } from '../connectors/IconDisplay';
import { ColorPicker } from '../connectors/ColorPicker';

const ADD_CATEGORY_VALUE = '__add_category__';

interface CreateEditSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: SkillResponse | null;
  onSave: (data: SkillFormValues) => void;
  saving: boolean;
}

export function CreateEditSkillDialog({ open, onOpenChange, skill, onSave, saving }: CreateEditSkillDialogProps) {
  const [categories, setCategories] = useState<SkillCategoryResponse[]>([]);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: defaultSkillFormValues,
  });

  const refreshCategories = useCallback(() => {
    getSkillCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    refreshCategories();

    if (skill) {
      reset({
        name: skill.name,
        description: skill.description,
        icon: skill.icon || '',
        color: skill.color || '',
        iconColor: skill.iconColor || 'light',
        categoryId: skill.categoryId || '',
        license: skill.license || '',
        compatibility: skill.compatibility || '',
        allowedToolsText: (skill.allowedTools || []).join(', '),
        metadataText: JSON.stringify(skill.metadata || {}, null, 2),
        instructions: skill.instructions || '',
        isActive: skill.isActive,
      });
      return;
    }

    reset(defaultSkillFormValues);
  }, [open, reset, skill, refreshCategories]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl h-[85vh] overflow-hidden flex flex-col'>
        <DialogHeader className='shrink-0'>
          <DialogTitle>{skill ? 'Edit Skill' : 'Create Skill'}</DialogTitle>
          <DialogDescription>{skill ? 'Update the skill metadata and instructions.' : 'Create a new reusable skill.'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSave, scrollToFirstError)} className='flex flex-col min-h-0 flex-1'>
          <div className='overflow-y-auto flex-1 min-h-0 pr-2'>
            <div className='grid gap-4 py-2'>
              <div className='space-y-2'>
                <Label htmlFor='skill-name'>Name</Label>
                <Input id='skill-name' placeholder='pdf-processing' {...register('name')} />
                {errors.name && <p className='text-xs text-destructive'>{errors.name.message}</p>}
              </div>

              <div className='space-y-2'>
                <Label htmlFor='skill-description'>Description</Label>
                <Textarea id='skill-description' rows={3} {...register('description')} />
                {errors.description && <p className='text-xs text-destructive'>{errors.description.message}</p>}
              </div>

              {/* Category */}
              <div className='space-y-2'>
                <Label>Category</Label>
                <Select
                  value={watch('categoryId') || '__none__'}
                  onValueChange={(value) => {
                    if (value === ADD_CATEGORY_VALUE) {
                      setShowCategoriesDialog(true);
                      return;
                    }
                    setValue('categoryId', value === '__none__' ? '' : value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select a category' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ADD_CATEGORY_VALUE} className='text-primary'>
                      <span className='flex items-center gap-2'>
                        <Plus className='h-3.5 w-3.5' />
                        Add category
                      </span>
                    </SelectItem>
                    <SelectItem value='__none__'>No category</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Icon + Color */}
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-2'>
                  <Label htmlFor='skill-icon'>Icon</Label>
                  <div className='flex gap-2'>
                    <IconPickerPreview
                      icon={watch('icon')}
                      color={watch('color')}
                      iconColor={watch('iconColor')}
                      onClear={() => setValue('icon', '')}
                      onToggleColorMode={() =>
                        setValue('iconColor', watch('iconColor') === 'light' ? 'dark' : 'light')
                      }
                    />
                    <div className='flex-1 space-y-1'>
                      <Input id='skill-icon' placeholder='FaBrain' {...register('icon')} />
                      <a
                        href='https://react-icons.github.io/react-icons/search/#q='
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-xs text-primary hover:underline flex items-center gap-1'
                      >
                        <ExternalLink className='h-3 w-3' />
                        Browse icons
                      </a>
                    </div>
                  </div>
                </div>
                <div className='space-y-2'>
                  <Label>Color</Label>
                  <ColorPicker
                    value={watch('color')}
                    onChange={(value) => setValue('color', value)}
                    placeholder='#4285f4'
                  />
                </div>
              </div>

              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='skill-license'>License</Label>
                  <Input id='skill-license' {...register('license')} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='skill-compatibility'>Compatibility</Label>
                  <Input id='skill-compatibility' {...register('compatibility')} />
                </div>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='skill-allowed-tools'>Allowed tools</Label>
                <Input id='skill-allowed-tools' placeholder='Bash(git:*) Read' {...register('allowedToolsText')} />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='skill-metadata'>Metadata JSON</Label>
                <Textarea id='skill-metadata' rows={5} {...register('metadataText')} />
                {errors.metadataText && <p className='text-xs text-destructive'>{errors.metadataText.message}</p>}
              </div>

              <div className='space-y-2'>
                <Label htmlFor='skill-instructions'>Instructions</Label>
                <Textarea id='skill-instructions' rows={12} {...register('instructions')} />
                {errors.instructions && <p className='text-xs text-destructive'>{errors.instructions.message}</p>}
              </div>

              {skill && skill.files.length > 0 ? (
                <div className='space-y-2'>
                  <Label>Bundled files</Label>
                  <div className='rounded-md border p-3 text-sm text-muted-foreground space-y-1'>
                    {skill.files.map((file) => (
                      <div key={file.path}>{file.path} ({file.kind})</div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className='flex items-center justify-between'>
                <div className='space-y-0.5'>
                  <Label>Active</Label>
                  <p className='text-xs text-muted-foreground'>Inactive skills stay stored but are hidden from selectors.</p>
                </div>
                <Switch checked={watch('isActive')} onCheckedChange={(checked) => setValue('isActive', checked)} />
              </div>
            </div>
          </div>

          <DialogFooter className='pt-4 shrink-0'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type='submit' disabled={saving}>
              {saving ? <><Loader2 className='mr-2 h-4 w-4 animate-spin' />Saving</> : skill ? 'Save Changes' : 'Create Skill'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <ManageSkillCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        onCategoriesChanged={refreshCategories}
      />
    </Dialog>
  );
}
