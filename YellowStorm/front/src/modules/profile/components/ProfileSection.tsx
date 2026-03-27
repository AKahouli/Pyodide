/**
 * Profile Section
 * Edit user profile information
 */

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/modules/auth';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';
import * as profileApi from '../api';

type ProfileTranslator = (key: ModuleTranslationKey<'profile'>, params?: TranslationParams) => string;

const buildProfileSchema = (translate: ProfileTranslator) =>
  z.object({
    firstName: z.string().min(1, translate('profileSection.validation.firstNameRequired')).max(50, translate('profileSection.validation.firstNameMax')),
    lastName: z.string().min(1, translate('profileSection.validation.lastNameRequired')).max(50, translate('profileSection.validation.lastNameMax')),
    company: z.string().max(100, translate('profileSection.validation.companyMax')).optional(),
  });

type ProfileSchema = ReturnType<typeof buildProfileSchema>;
type ProfileFormValues = z.infer<ProfileSchema>;

export function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const { t } = useModuleTranslation('profile');
  const profileSchema = React.useMemo(() => buildProfileSchema(t), [t]);

  const { execute: updateProfile, isLoading } = useApiAction(profileApi.updateProfile, {
    showSuccessToast: true,
    successMessage: t('profileSection.toasts.success'),
    onSuccess: () => refreshUser(),
  });

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.profile?.firstName || '',
      lastName: user?.profile?.lastName || '',
      company: user?.profile?.company || '',
    },
  });

  // Update form when user data changes
  React.useEffect(() => {
    if (user) {
      form.reset({
        firstName: user.profile?.firstName || '',
        lastName: user.profile?.lastName || '',
        company: user.profile?.company || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const onSubmit = async (data: ProfileFormValues) => {
    await updateProfile(data);
  };

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-xl font-semibold'>{t('profileSection.title')}</h2>
        <p className='text-sm text-muted-foreground'>{t('profileSection.description')}</p>
      </div>

      <Separator />

      {/* Email (read-only) */}
      <div className='space-y-2'>
        <label className='text-sm font-medium'>{t('profileSection.emailLabel')}</label>
        <Input value={user?.email || ''} disabled className='bg-muted' />
        <p className='text-xs text-muted-foreground'>{t('profileSection.emailNote')}</p>
      </div>

      <Separator />

      {/* Editable fields */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <FormField
              control={form.control}
              name='firstName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profileSection.fields.firstName.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('profileSection.fields.firstName.placeholder')} disabled={isLoading} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='lastName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profileSection.fields.lastName.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('profileSection.fields.lastName.placeholder')} disabled={isLoading} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='company'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profileSection.fields.company.label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('profileSection.fields.company.placeholder')} disabled={isLoading} {...field} />
                </FormControl>
                <FormDescription>{t('profileSection.fields.company.optional')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='flex items-center gap-4'>
            <Button type='submit' disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {t('profileSection.actions.saving')}
                </>
              ) : (
                t('profileSection.actions.save')
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
