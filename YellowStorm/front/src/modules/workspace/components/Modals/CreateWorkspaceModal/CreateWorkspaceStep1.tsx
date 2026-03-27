/**
 * Create Workspace Step 1
 * First step of workspace creation wizard - basic info
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ChevronRight } from 'lucide-react';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '../../../store';
import { useModuleTranslation } from '@/modules/localization';

const step1Schema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  tag: z.string().max(50, 'Tag must be less than 50 characters').optional(),
});

export type Step1FormValues = z.infer<typeof step1Schema>;

interface CreateWorkspaceStep1Props {
  defaultValues?: Partial<Step1FormValues>;
  onNext: (data: Step1FormValues) => void;
}

export function CreateWorkspaceStep1({ defaultValues, onNext }: CreateWorkspaceStep1Props) {
  const closeCreateModal = useWorkspaceStore((state) => state.closeCreateModal);
  const { t } = useModuleTranslation('workspace');

  const form = useForm<Step1FormValues>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      name: defaultValues?.name || '',
      description: defaultValues?.description || '',
      tag: defaultValues?.tag || '',
    },
  });

  const handleSubmit = (data: Step1FormValues) => {
    onNext(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className='space-y-4'>
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('modal.createWorkspace.step1.nameLabel')}</FormLabel>
              <FormControl>
                <Input placeholder={t('modal.createWorkspace.step1.namePlaceholder')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='description'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('modal.createWorkspace.step1.descriptionLabel')}</FormLabel>
              <FormControl>
                <Textarea placeholder={t('modal.createWorkspace.step1.descriptionPlaceholder')} className='resize-none' rows={3} {...field} />
              </FormControl>
              <FormDescription>{t('modal.createWorkspace.step1.descriptionHelp')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='tag'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('modal.createWorkspace.step1.tagLabel')}</FormLabel>
              <FormControl>
                <Input placeholder={t('modal.createWorkspace.step1.tagPlaceholder')} {...field} />
              </FormControl>
              <FormDescription>{t('modal.createWorkspace.step1.tagHelp')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='flex justify-end gap-2 pt-4'>
          <Button type='button' variant='outline' onClick={closeCreateModal}>
            {t('modal.createWorkspace.step1.cancel')}
          </Button>
          <Button type='submit'>
            {t('modal.createWorkspace.step1.next')}
            <ChevronRight className='ml-2 h-4 w-4' />
          </Button>
        </div>
      </form>
    </Form>
  );
}
