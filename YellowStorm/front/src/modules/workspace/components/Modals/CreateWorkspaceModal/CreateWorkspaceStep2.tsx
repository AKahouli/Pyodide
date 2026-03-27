/**
 * Create Workspace Step 2
 * Second step of workspace creation wizard - settings configuration
 *
 * Three modes:
 * 1. Default Settings - No custom configuration
 * 2. Use Template - Select and use a template as-is
 * 3. Custom Settings - Configure manually (optionally pre-fill from template)
 */

import { useState, useEffect, useMemo } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useWorkspaceStore, useWorkspaceLoading } from '../../../store';
import type { RagType } from '../../../types';
import { TemplatePreview } from './TemplatePreview';
import { useModuleTranslation } from '@/modules/localization';

// Settings mode enum
type SettingsMode = 'default' | 'template' | 'custom';

const customSettingsSchema = z.object({
  instruction: z.string().max(10000, 'Instruction must be less than 10000 characters').optional(),
  chunks: z.number().min(1).max(100).default(5),
  hybridSearch: z.boolean().default(false),
  ragType: z.enum(['standard', 'advancedRag', 'smartRag']).default('standard'),
  maxToken: z.number().min(100).max(128000).default(4096),
  topK: z.number().min(1).max(100).default(10),
});

export type Step2FormValues = {
  mode: SettingsMode;
  templateId?: string;
  customSettings?: z.infer<typeof customSettingsSchema>;
};

interface CreateWorkspaceStep2Props {
  onBack: () => void;
  onSubmit: (data: Step2FormValues) => void;
}

const DEFAULT_SETTINGS = {
  instruction: '',
  chunks: 5,
  hybridSearch: false,
  ragType: 'standard' as RagType,
  maxToken: 4096,
  topK: 10,
};

export function CreateWorkspaceStep2({ onBack, onSubmit }: CreateWorkspaceStep2Props) {
  const { isCreating, isLoadingTemplates } = useWorkspaceLoading();
  const templates = useWorkspaceStore((state) => state.templates);
  const { t } = useModuleTranslation('workspace');

  const ragTypeOptions = useMemo(
    () => [
      {
        value: 'standard' as RagType,
        label: t('modal.createWorkspace.step2.form.rag.options.standard.label'),
        description: t('modal.createWorkspace.step2.form.rag.options.standard.description'),
      },
      {
        value: 'advancedRag' as RagType,
        label: t('modal.createWorkspace.step2.form.rag.options.advanced.label'),
        description: t('modal.createWorkspace.step2.form.rag.options.advanced.description'),
      },
      {
        value: 'smartRag' as RagType,
        label: t('modal.createWorkspace.step2.form.rag.options.smart.label'),
        description: t('modal.createWorkspace.step2.form.rag.options.smart.description'),
      },
    ],
    [t],
  );

  // Mode state
  const [mode, setMode] = useState<SettingsMode>('default');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [prefillTemplateId, setPrefillTemplateId] = useState<string>('');

  // Custom settings form
  const form = useForm<z.infer<typeof customSettingsSchema>>({ resolver: zodResolver(customSettingsSchema), defaultValues: DEFAULT_SETTINGS });

  // Get selected template for preview
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  // Pre-fill form when selecting a template to base custom settings on
  useEffect(() => {
    if (prefillTemplateId && mode === 'custom') {
      const template = templates.find((t) => t.id === prefillTemplateId);
      if (template) {
        form.setValue('instruction', template.instruction || '');
        form.setValue('chunks', template.chunks);
        form.setValue('hybridSearch', template.hybridSearch);
        form.setValue('ragType', template.ragType);
        form.setValue('maxToken', template.maxToken);
        form.setValue('topK', template.topK);
      }
    }
  }, [prefillTemplateId, mode, templates, form]);

  // Reset form when switching to custom mode without prefill
  useEffect(() => {
    if (mode === 'custom' && !prefillTemplateId) {
      form.reset(DEFAULT_SETTINGS);
    }
  }, [mode, prefillTemplateId, form]);

  const handleSubmit = () => {
    if (mode === 'default') {
      onSubmit({ mode: 'default' });
    } else if (mode === 'template') {
      if (!selectedTemplateId) return;
      onSubmit({ mode: 'template', templateId: selectedTemplateId });
    } else {
      // Custom mode - validate and submit
      form.handleSubmit((customSettings) => {
        onSubmit({ mode: 'custom', customSettings });
      })();
    }
  };

  return (
    <div className='space-y-6'>
      {/* Mode Selection */}
      <div className='space-y-3'>
        <Label className='text-base font-medium'>{t('modal.createWorkspace.step2.heading')}</Label>
        <RadioGroup
          value={mode}
          onValueChange={(value) => {
            setMode(value as SettingsMode);
            // Reset template selections when changing mode
            if (value !== 'template') {
              setSelectedTemplateId('');
            }
            if (value !== 'custom') {
              setPrefillTemplateId('');
            }
          }}
          className='space-y-2'>
          <div className='flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 cursor-pointer'>
            <RadioGroupItem value='default' id='mode-default' />
            <Label htmlFor='mode-default' className='flex-1 cursor-pointer'>
              <div className='font-medium'>{t('modal.createWorkspace.step2.modes.default.title')}</div>
              <div className='text-sm text-muted-foreground'>{t('modal.createWorkspace.step2.modes.default.description')}</div>
            </Label>
          </div>

          <div className='flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 cursor-pointer'>
            <RadioGroupItem value='template' id='mode-template' />
            <Label htmlFor='mode-template' className='flex-1 cursor-pointer'>
              <div className='font-medium'>{t('modal.createWorkspace.step2.modes.template.title')}</div>
              <div className='text-sm text-muted-foreground'>{t('modal.createWorkspace.step2.modes.template.description')}</div>
            </Label>
            {templates.length > 0 && (
              <Badge variant='secondary' className='ml-auto'>
                {t('modal.createWorkspace.step2.template.available', { count: templates.length })}
              </Badge>
            )}
          </div>

          <div className='flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 cursor-pointer'>
            <RadioGroupItem value='custom' id='mode-custom' />
            <Label htmlFor='mode-custom' className='flex-1 cursor-pointer'>
              <div className='font-medium'>{t('modal.createWorkspace.step2.modes.custom.title')}</div>
              <div className='text-sm text-muted-foreground'>{t('modal.createWorkspace.step2.modes.custom.description')}</div>
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Template Selection (when mode is 'template') */}
      {mode === 'template' && (
        <div className='space-y-3 animate-in fade-in-50 duration-200'>
          <div className='space-y-2'>
            <Label>{t('modal.createWorkspace.step2.template.selectLabel')}</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder={t('modal.createWorkspace.step2.template.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {isLoadingTemplates ? (
                  <div className='flex items-center justify-center py-4'>
                    <Loader2 className='h-4 w-4 animate-spin' />
                  </div>
                ) : templates.length === 0 ? (
                  <div className='py-4 px-2 text-center text-sm text-muted-foreground'>
                    <p>{t('modal.createWorkspace.step2.template.empty.title')}</p>
                    <p className='mt-1'>{t('modal.createWorkspace.step2.template.empty.description')}</p>
                  </div>
                ) : (
                  templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      <div className='flex items-start gap-2'>
                        {template.isPredefined && <Star className='h-3 w-3 text-yellow-500 fill-yellow-500 mt-0.5 flex-shrink-0' />}
                        <div className='flex flex-col'>
                          <span>{template.name}</span>
                          {template.description && <span className='text-xs text-muted-foreground'>{template.description}</span>}
                        </div>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Template Preview */}
          {selectedTemplate && <TemplatePreview template={selectedTemplate} ragTypeOptions={ragTypeOptions} />}
        </div>
      )}

      {/* Custom Settings Form (when mode is 'custom') */}
      {mode === 'custom' && (
        <div className='space-y-4 animate-in fade-in-50 duration-200'>
          {/* Optional: Pre-fill from template */}
          {templates.length > 0 && (
            <div className='space-y-2'>
              <Label className='text-sm text-muted-foreground'>{t('modal.createWorkspace.step2.template.prefillLabel')}</Label>
              <Select value={prefillTemplateId || 'none'} onValueChange={(value) => setPrefillTemplateId(value === 'none' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('modal.createWorkspace.step2.template.prefillPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>{t('modal.createWorkspace.step2.template.prefillNone')}</SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      <div className='flex items-center gap-2'>
                        {template.isPredefined && <Star className='h-3 w-3 text-yellow-500 fill-yellow-500 flex-shrink-0' />}
                        <span>{template.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Form {...form}>
            <div className='space-y-4'>
              {/* Instruction */}
              <FormField
                control={form.control}
                name='instruction'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('modal.createWorkspace.step2.form.instructionLabel')}</FormLabel>
                    <FormControl>
                      <Textarea placeholder={t('modal.createWorkspace.step2.form.instructionPlaceholder')} className='resize-none min-h-[80px]' {...field} />
                    </FormControl>
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
                    <FormLabel>{t('modal.createWorkspace.step2.form.chunksLabel', { value: field.value })}</FormLabel>
                    <FormControl>
                      <Slider min={1} max={100} step={1} value={[field.value]} onValueChange={(values) => field.onChange(values[0])} />
                    </FormControl>
                    <FormDescription>{t('modal.createWorkspace.step2.form.chunksDescription')}</FormDescription>
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
                      <FormLabel>{t('modal.createWorkspace.step2.form.hybridLabel')}</FormLabel>
                      <FormDescription>{t('modal.createWorkspace.step2.form.hybridDescription')}</FormDescription>
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
                    <FormLabel>{t('modal.createWorkspace.step2.form.rag.label')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('modal.createWorkspace.step2.form.rag.placeholder')} />
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
                    <FormLabel>{t('modal.createWorkspace.step2.form.maxTokensLabel')}</FormLabel>
                    <FormControl>
                      <Input type='number' min={100} max={128000} {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 4096)} />
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
                    <FormLabel>{t('modal.createWorkspace.step2.form.topKLabel')}</FormLabel>
                    <FormControl>
                      <Input type='number' min={1} max={100} {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 10)} />
                    </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </Form>
        </div>
      )}

      {/* Action Buttons */}
      <div className='flex justify-between pt-4'>
        <Button type='button' variant='outline' onClick={onBack}>
          <ChevronLeft className='mr-2 h-4 w-4' />
          {t('modal.createWorkspace.step2.actions.back')}
        </Button>
        <Button onClick={handleSubmit} disabled={isCreating || (mode === 'template' && !selectedTemplateId)}>
          {isCreating ? (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              {t('modal.createWorkspace.step2.actions.creating')}
            </>
          ) : (
            t('modal.createWorkspace.step2.actions.submit')
          )}
        </Button>
      </div>
    </div>
  );
}
