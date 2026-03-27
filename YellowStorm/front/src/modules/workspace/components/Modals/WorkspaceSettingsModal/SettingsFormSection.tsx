import { Loader2 } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceSetting } from '../../../types';
import type { SettingsFormValues } from './schema';
import { RAG_TYPE_OPTIONS } from './schema';

type SettingsFormSectionProps = Readonly<{
  form: UseFormReturn<SettingsFormValues>;
  currentSettings: WorkspaceSetting | null;
  isSaving: boolean;
  hasChanges: boolean;
  onCancel: () => void;
  onSubmit: (data: SettingsFormValues) => Promise<void> | void;
}>;

export function SettingsFormSection({ form, currentSettings, isSaving, hasChanges, onCancel, onSubmit }: SettingsFormSectionProps) {
  const { t } = useModuleTranslation('workspace');
  const { t: tCommon } = useModuleTranslation('common');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <p className='text-sm font-medium'>{currentSettings ? t('settings.form.sectionTitleEdit') : t('settings.form.sectionTitleCreate')}</p>

        <FormField
          control={form.control}
          name='instruction'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='text-xs sm:text-sm'>{t('settings.form.instruction.label')}</FormLabel>
              <FormControl>
                <Textarea placeholder={t('settings.form.instruction.placeholder')} className='resize-none min-h-[80px] sm:min-h-[100px] text-sm' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='chunks'
          render={({ field }) => (
            <FormItem>
              <div className='flex items-center justify-between'>
                <FormLabel className='text-xs sm:text-sm'>{t('settings.form.chunks.label')}</FormLabel>
                <span className='text-xs sm:text-sm font-medium tabular-nums'>{field.value}</span>
              </div>
              <FormControl>
                <Slider min={1} max={100} step={1} value={[field.value]} onValueChange={(values) => field.onChange(values[0])} className='py-2' />
              </FormControl>
              <FormDescription className='text-xs'>{t('settings.form.chunks.helper')}</FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='hybridSearch'
          render={({ field }) => (
            <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3 gap-3'>
              <div className='space-y-0.5 min-w-0 flex-1'>
                <FormLabel className='text-xs sm:text-sm'>{t('settings.form.hybrid.label')}</FormLabel>
                <FormDescription className='text-xs'>{t('settings.form.hybrid.description')}</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='ragType'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='text-xs sm:text-sm'>{t('settings.form.rag.label')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className='h-10 sm:h-9'>
                    <SelectValue placeholder={t('settings.form.rag.placeholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {RAG_TYPE_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      <div className='py-0.5'>
                        <div className='text-sm'>{t(`settings.form.rag.types.${value}.label`)}</div>
                        <div className='text-xs text-muted-foreground'>{t(`settings.form.rag.types.${value}.description`)}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        <div className='grid grid-cols-2 gap-3 sm:gap-4'>
          <FormField
            control={form.control}
            name='maxToken'
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-xs sm:text-sm'>{t('settings.form.maxToken')}</FormLabel>
                <FormControl>
                  <Input type='number' min={100} max={128000} className='h-10 sm:h-9 text-sm' {...field} onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 4096)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='topK'
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-xs sm:text-sm'>{t('settings.form.topK')}</FormLabel>
                <FormControl>
                  <Input type='number' min={1} max={100} className='h-10 sm:h-9 text-sm' {...field} onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 10)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 border-t mt-6'>
          <Button type='button' variant='outline' onClick={onCancel} className='h-10 sm:h-9'>
            {tCommon('actionCancel')}
          </Button>
          <Button type='submit' disabled={isSaving || !hasChanges} className='h-10 sm:h-9'>
            {isSaving ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                {t('settings.actions.saving')}
              </>
            ) : currentSettings ? (
              t('settings.actions.save')
            ) : (
              t('settings.actions.create')
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
