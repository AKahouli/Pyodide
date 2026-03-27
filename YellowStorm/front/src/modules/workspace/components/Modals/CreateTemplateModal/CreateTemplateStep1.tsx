/**
 * Create Template Step 1
 * First step of workspace settings template creation - basic info
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
import type { ModuleTranslationKey } from '@/modules/localization';

const step1Schema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  tag: z.string().max(50, 'Tag must be less than 50 characters').optional(),
});

export type TemplateStep1FormValues = z.infer<typeof step1Schema>;

interface CreateTemplateStep1Props {
  defaultValues?: Partial<TemplateStep1FormValues>;
  onNext: (data: TemplateStep1FormValues) => void;
}

export function CreateTemplateStep1({ defaultValues, onNext }: CreateTemplateStep1Props) {
  const closeCreateTemplateModal = useWorkspaceStore((state) => state.closeCreateTemplateModal);
  const { t } = useModuleTranslation('workspace');
  const key = (suffix: string) => `modal.createTemplate.step1.${suffix}` as ModuleTranslationKey<'workspace'>;

  const form = useForm<TemplateStep1FormValues>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      name: defaultValues?.name || '',
      description: defaultValues?.description || '',
      tag: defaultValues?.tag || '',
    },
  });

  const handleSubmit = (data: TemplateStep1FormValues) => {
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
              <FormLabel>{t(key('nameLabel'))}</FormLabel>
              <FormControl>
                <Input placeholder={t(key('namePlaceholder'))} {...field} />
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
              <FormLabel>{t(key('descriptionLabel'))}</FormLabel>
              <FormControl>
                <Textarea placeholder={t(key('descriptionPlaceholder'))} className='resize-none' rows={3} {...field} />
              </FormControl>
              <FormDescription>{t(key('descriptionHelp'))}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='tag'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(key('tagLabel'))}</FormLabel>
              <FormControl>
                <Input placeholder={t(key('tagPlaceholder'))} {...field} />
              </FormControl>
              <FormDescription>{t(key('tagHelp'))}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='flex justify-end gap-2 pt-4'>
          <Button type='button' variant='outline' onClick={closeCreateTemplateModal}>
            {t(key('cancel'))}
          </Button>
          <Button type='submit'>
            {t(key('next'))}
            <ChevronRight className='ml-2 h-4 w-4' />
          </Button>
        </div>
      </form>
    </Form>
  );
}
