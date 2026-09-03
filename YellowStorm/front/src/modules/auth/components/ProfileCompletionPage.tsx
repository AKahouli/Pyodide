/**
 * Profile Completion Page
 * Required step after email verification for new users
 */

import * as React from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, User, Building, FileCheck, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import { appConfig } from '@/config/app';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '../useAuth';
import { AuthScrollShell } from './AuthScrollShell';

type ProfileFormValues = {
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  description: string;
  privacyPolicy: boolean;
  dataSharing: boolean;
};
export function ProfileCompletionPage() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('auth');
  const { completeProfile, logout, isLoading: authLoading, isAuthenticated, user, requiresProfileCompletion } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const profileSchema = React.useMemo<z.ZodType<ProfileFormValues>>(
    () =>
      z.object({
        firstName: z.string().min(1, t('profileCompletion.error.firstNameRequired')).max(50, t('profileCompletion.error.firstNameMax')),
        lastName: z.string().min(1, t('profileCompletion.error.lastNameRequired')).max(50, t('profileCompletion.error.lastNameMax')),
        company: z.string().min(1, t('profileCompletion.error.companyRequired')).max(100, t('profileCompletion.error.companyMax')),
        role: z.string().max(200, t('profileCompletion.error.roleMax')),
        description: z.string().max(1000, t('profileCompletion.error.descriptionMax')),
        privacyPolicy: z.boolean().refine((val) => val === true, {
          message: t('profileCompletion.privacyPolicy.required'),
        }),
        dataSharing: z.boolean(),
      }),
    [t],
  );

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.profile?.firstName || '',
      lastName: user?.profile?.lastName || '',
      company: user?.profile?.company || '',
      role: user?.profile?.role || '',
      description: user?.profile?.description || '',
      privacyPolicy: false,
      dataSharing: false,
    },
  });
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Redirect based on auth state
  React.useEffect(() => {
    // Still loading - wait
    if (authLoading) return;

    // Not authenticated - go to landing
    if (!isAuthenticated) {
      navigate('/');
      return;
    }

    // Profile already complete - go to app
    if (!requiresProfileCompletion) {
      navigate('/');
    }
  }, [authLoading, isAuthenticated, requiresProfileCompletion, navigate]);

  // Show loading while auth is being checked
  if (authLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-neutral-950'>
        <Loader2 className='h-8 w-8 animate-spin text-primary' />
      </div>
    );
  }

  // Don't render form if not authenticated or profile already complete
  if (!isAuthenticated || !requiresProfileCompletion) {
    return null;
  }

  const onSubmit = async (data: ProfileFormValues) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await completeProfile({
        firstName: data.firstName,
        lastName: data.lastName,
        company: data.company,
        role: data.role,
        description: data.description,
        privacyPolicy: data.privacyPolicy,
        dataSharing: data.dataSharing,
      });
      navigate('/');
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError((err as { message: string }).message);
      } else {
        setError(t('profileCompletion.error.failed'));
      }
      setIsSubmitting(false);
    }
  };
  return (
    <AuthScrollShell>
      <StarsBackground shootingStars={false} />

      {/* Header */}
      <div className='absolute top-6 left-6 right-6 z-20 flex items-center justify-between'>
        <NavLink to='/' className='flex items-center'>
          <AppBrandLogo className='h-12 w-56' />
        </NavLink>
        <Button variant='ghost' size='sm' onClick={handleLogout} className='text-neutral-400 hover:text-white hover:bg-neutral-800'>
          <LogOut className='h-4 w-4 mr-2' />
          {t('profileCompletion.logout')}
        </Button>
      </div>
      {/* Main content */}
      <main className='relative z-10 flex min-h-full flex-col items-center justify-center px-6 py-24'>
        <Card className='w-full max-w-lg bg-neutral-900/90 border-neutral-800'>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-4'>
              <User className='h-12 w-12 text-primary' />
            </div>
            <CardTitle className='text-2xl text-white'>{t('profileCompletion.title')}</CardTitle>
            <CardDescription className='text-neutral-400'>{t('profileCompletion.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
                {error && <div className='rounded-md bg-destructive/10 p-3 text-sm text-destructive'>{error}</div>}
                <div className='grid grid-cols-2 gap-4'>
                  <FormField
                    control={form.control}
                    name='firstName'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className='text-neutral-200'>{t('profileCompletion.firstName.label')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('profileCompletion.firstName.placeholder')} disabled={isSubmitting} className='bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' {...field} />
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
                        <FormLabel className='text-neutral-200'>{t('profileCompletion.lastName.label')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('profileCompletion.lastName.placeholder')} disabled={isSubmitting} className='bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' {...field} />
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
                      <FormLabel className='text-neutral-200'>
                        <div className='flex items-center gap-2'>
                          <Building className='h-4 w-4' />
                          {t('profileCompletion.company.label')}
                        </div>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={t('profileCompletion.company.placeholder')} disabled={isSubmitting} className='bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='role'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='text-neutral-200'>{t('profileCompletion.role.label')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('profileCompletion.role.placeholder')} disabled={isSubmitting} className='bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' {...field} />
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
                      <FormLabel className='text-neutral-200'>{t('profileCompletion.description.label')}</FormLabel>
                      <FormControl>
                        <Textarea placeholder={t('profileCompletion.description.placeholder')} disabled={isSubmitting} className='bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='space-y-4 pt-4 border-t border-neutral-800'>
                  <div className='flex items-center gap-2 text-neutral-200'>
                    <FileCheck className='h-4 w-4' />
                    <span className='text-sm font-medium'>{t('profileCompletion.legal.title')}</span>
                  </div>

                  <FormField
                    control={form.control}
                    name='privacyPolicy'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-start space-x-3 space-y-0'>
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isSubmitting} className='border-neutral-600 data-[state=checked]:bg-primary' />
                        </FormControl>
                        <div className='space-y-1 leading-none'>
                          <FormLabel className='text-sm text-neutral-300 font-normal cursor-pointer'>
                            {t('profileCompletion.privacyPolicy.accept')}{' '}
                            <a href='#' className='text-primary hover:underline' onClick={(e) => e.stopPropagation()}>
                              {t('profileCompletion.privacyPolicy.link')}
                            </a>{' '}
                            <span className='text-red-400'>*</span>
                          </FormLabel>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='dataSharing'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-start space-x-3 space-y-0'>
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isSubmitting} className='border-neutral-600 data-[state=checked]:bg-primary' />
                        </FormControl>
                        <div className='space-y-1 leading-none'>
                          <FormLabel className='text-sm text-neutral-300 font-normal cursor-pointer'>
                            {t('profileCompletion.dataSharing.label', { appName: appConfig.name })}
                          </FormLabel>
                          <FormDescription className='text-xs text-neutral-500'>{t('profileCompletion.dataSharing.description')}</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>

                <Button type='submit' className='w-full' size='lg' disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {t('profileCompletion.submitting')}
                    </>
                  ) : (
                    t('profileCompletion.submit')
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </AuthScrollShell>
  );
}
