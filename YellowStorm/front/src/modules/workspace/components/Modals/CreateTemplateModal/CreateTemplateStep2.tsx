/**
 * Create Template Step 2
 * Second step of workspace settings template creation - settings configuration
 * Allows copying from existing template to pre-fill form values
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ChevronLeft, Loader2, Star } from 'lucide-react';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useWorkspaceStore, useWorkspaceLoading } from '../../../store';
import type { RagType } from '../../../types';
import { ModuleTranslationKey, useModuleTranslation } from '@/modules/localization';

const step2Schema = z.object({
  instruction: z.string().max(10000, 'Instruction must be less than 10000 characters').optional(),
  chunks: z.number().min(1).max(100).default(5),
  hybridSearch: z.boolean().default(false),
  ragType: z.enum(['standard', 'advancedRag', 'smartRag']).default('standard'),
  maxToken: z.number().min(100).max(128000).default(32000),
  topK: z.number().min(1).max(100).default(10),
});

export type TemplateStep2FormValues = z.infer<typeof step2Schema>;

interface CreateTemplateStep2Props {
  onBack: () => void;
  onSubmit: (data: TemplateStep2FormValues) => void;
}

export function CreateTemplateStep2({ onBack, onSubmit }: CreateTemplateStep2Props) {
  const { isCreating, isLoadingTemplates } = useWorkspaceLoading();
  const templates = useWorkspaceStore((state) => state.templates);
  const fetchTemplates = useWorkspaceStore((state) => state.fetchTemplates);
  const { t } = useModuleTranslation('workspace');
  const key = useCallback((suffix: string) => `modal.createTemplate.step2.${suffix}` as ModuleTranslationKey<'workspace'>, []);

  const ragTypeOptions = useMemo(
    () => [
      {
        value: 'standard' as RagType,
        label: t(key('form.rag.options.standard.label')),
        description: t(key('form.rag.options.standard.description')),
      },
      {
        value: 'advancedRag' as RagType,
        label: t(key('form.rag.options.advanced.label')),
        description: t(key('form.rag.options.advanced.description')),
      },
      {
        value: 'smartRag' as RagType,
        label: t(key('form.rag.options.smart.label')),
        description: t(key('form.rag.options.smart.description')),
      },
    ],
    [t, key],
  );

  // State for selected template to copy from
  const [copyFromTemplateId, setCopyFromTemplateId] = useState<string>('');

  const form = useForm<TemplateStep2FormValues>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      instruction: '',
      chunks: 5,
      hybridSearch: false,
      ragType: 'standard',
      maxToken: 32000,
      topK: 10,
    },
  });

  // Fetch templates on mount
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Pre-fill form when template selected
  useEffect(() => {
    if (copyFromTemplateId) {
      const template = templates.find((t) => t.id === copyFromTemplateId);
      if (template) {
        form.reset({
          instruction: template.instruction || '',
          chunks: template.chunks,
          hybridSearch: template.hybridSearch,
          ragType: template.ragType,
          maxToken: template.maxToken,
          topK: template.topK,
        });
      }
    }
  }, [copyFromTemplateId, templates, form]);

  const handleSubmit = (data: TemplateStep2FormValues) => {
    onSubmit(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className='space-y-4'>
        {/* Copy from existing template (optional) */}
        {templates.length > 0 && (
          <>
            <div className='space-y-2'>
              <Label>{t(key('copy.label'))}</Label>
              <Select value={copyFromTemplateId || 'none'} onValueChange={(value) => setCopyFromTemplateId(value === 'none' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder={t(key('copy.placeholder'))} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>{t(key('copy.none'))}</SelectItem>
                  {isLoadingTemplates ? (
                    <div className='flex items-center justify-center py-4'>
                      <Loader2 className='h-4 w-4 animate-spin' />
                    </div>
                  ) : (
                    templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <div className='flex items-center gap-2'>
                          {template.isPredefined && <Star className='h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0' />}
                          <span>{template.name}</span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>{t(key('copy.helper'))}</p>
            </div>
            <Separator />
          </>
        )}
        {/* Instruction */}
        <FormField
          control={form.control}
          name='instruction'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(key('form.instructionLabel'))}</FormLabel>
              <FormControl>
                <Textarea placeholder={t(key('form.instructionPlaceholder'))} className='resize-none min-h-[100px]' {...field} />
              </FormControl>
              <FormDescription>{t(key('form.instructionDescription'))}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Chunks slider */}
        <FormField
          control={form.control}
          name='chunks'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(key('form.chunksLabel'), { value: field.value })}</FormLabel>
              <FormControl>
                <Slider min={1} max={100} step={1} value={[field.value]} onValueChange={(values) => field.onChange(values[0])} />
              </FormControl>
              <FormDescription>{t(key('form.chunksDescription'))}</FormDescription>
            </FormItem>
          )}
        />

        {/* Hybrid Search toggle */}
        <FormField
          control={form.control}
          name='hybridSearch'
          render={({ field }) => (
            <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
              <div className='space-y-0.5'>
                <FormLabel>{t(key('form.hybridLabel'))}</FormLabel>
                <FormDescription>{t(key('form.hybridDescription'))}</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        {/* RAG Type select */}
        <FormField
          control={form.control}
          name='ragType'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(key('form.rag.label'))}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t(key('form.rag.placeholder'))} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ragTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div>{option.label}</div>
                        <div className='text-xs text-muted-foreground'>{option.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          {/* Max Tokens */}
          <FormField
            control={form.control}
            name='maxToken'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(key('form.maxTokensLabel'))}</FormLabel>
                <FormControl>
                  <Input type='number' min={100} max={128000} {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 32000)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Top K */}
          <FormField
            control={form.control}
            name='topK'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(key('form.topKLabel'))}</FormLabel>
                <FormControl>
                  <Input type='number' min={1} max={100} {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 10)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='flex justify-between pt-4'>
          <Button type='button' variant='outline' onClick={onBack}>
            <ChevronLeft className='mr-2 h-4 w-4' />
            {t(key('actions.back'))}
          </Button>
          <Button type='submit' disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                {t(key('actions.creating'))}
              </>
            ) : (
              t(key('actions.submit'))
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
