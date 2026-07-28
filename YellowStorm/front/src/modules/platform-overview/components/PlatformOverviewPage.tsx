import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Bot,
  Boxes,
  Briefcase,
  Building2,
  LibraryBig,
  Link2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminAccess } from '@/modules/admin/hooks/useAdminAccess';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization';

type OverviewKey = ModuleTranslationKey<'platform-overview'>;

interface Capability {
  titleKey: OverviewKey;
  descriptionKey: OverviewKey;
  to: string;
  icon: LucideIcon;
}

interface CapabilityPaneProps {
  titleKey: OverviewKey;
  descriptionKey: OverviewKey;
  icon: LucideIcon;
  capabilities: Capability[];
  className: string;
  canOpenGovernance?: boolean;
}

const knowledgeCapabilities: Capability[] = [
  {
    titleKey: 'feature.workspace.title',
    descriptionKey: 'feature.workspace.description',
    to: '/workspace',
    icon: LibraryBig,
  },
  {
    titleKey: 'feature.connectedApps.title',
    descriptionKey: 'feature.connectedApps.description',
    to: '/apps',
    icon: Link2,
  },
];

const collaborationCapabilities: Capability[] = [
  {
    titleKey: 'feature.conversation.title',
    descriptionKey: 'feature.conversation.description',
    to: '/',
    icon: MessageCircle,
  },
  {
    titleKey: 'feature.teams.title',
    descriptionKey: 'feature.teams.description',
    to: '/teams',
    icon: Users,
  },
];

const automationCapabilities: Capability[] = [
  {
    titleKey: 'feature.agents.title',
    descriptionKey: 'feature.agents.description',
    to: '/agents',
    icon: Bot,
  },
  {
    titleKey: 'feature.playbooks.title',
    descriptionKey: 'feature.playbooks.description',
    to: '/playbooks',
    icon: Workflow,
  },
  {
    titleKey: 'feature.worky.title',
    descriptionKey: 'feature.worky.description',
    to: '/worky',
    icon: Briefcase,
  },
];

const governanceCapabilities: Capability[] = [
  {
    titleKey: 'feature.governance.title',
    descriptionKey: 'feature.governance.description',
    to: '/governance',
    icon: ShieldCheck,
  },
];

const featuredAdminDestinations = new Set([
  'users',
  'roles',
  'connected-apps',
  'audit',
  'guardrails',
  'analytics',
  'system',
]);

function CapabilityPane({
  titleKey,
  descriptionKey,
  icon: PaneIcon,
  capabilities,
  className,
  canOpenGovernance = true,
}: Readonly<CapabilityPaneProps>) {
  const { t } = useModuleTranslation('platform-overview');

  return (
    <section className={`relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6 ${className}`}>
      <div className='pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/5' />
      <div className='relative'>
        <div className='mb-5 flex items-start gap-3'>
          <div className='flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background/80 shadow-sm'>
            <PaneIcon className='size-5 text-primary' aria-hidden='true' />
          </div>
          <div>
            <h2 className='text-lg font-semibold tracking-tight'>{t(titleKey)}</h2>
            <p className='mt-1 max-w-xl text-sm leading-6 text-muted-foreground'>{t(descriptionKey)}</p>
          </div>
        </div>

        <div className='grid gap-2 sm:grid-cols-2'>
          {capabilities.map((capability) => {
            const CapabilityIcon = capability.icon;
            const isRestrictedGovernance = capability.to === '/governance' && !canOpenGovernance;

            if (isRestrictedGovernance) {
              return (
                <div key={capability.to} className='rounded-xl border bg-background/60 p-4'>
                  <div className='flex items-center gap-3'>
                    <CapabilityIcon className='size-5 text-muted-foreground' aria-hidden='true' />
                    <h3 className='font-medium'>{t(capability.titleKey)}</h3>
                  </div>
                  <p className='mt-2 text-sm leading-5 text-muted-foreground'>{t(capability.descriptionKey)}</p>
                  <p className='mt-3 text-xs font-medium text-muted-foreground'>{t('feature.governance.restricted')}</p>
                </div>
              );
            }

            return (
              <Link
                key={capability.to}
                to={capability.to}
                className='group rounded-xl border bg-background/60 p-4 transition-colors hover:border-primary/40 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              >
                <div className='flex items-center gap-3'>
                  <CapabilityIcon className='size-5 text-muted-foreground transition-colors group-hover:text-primary' aria-hidden='true' />
                  <h3 className='font-medium'>{t(capability.titleKey)}</h3>
                </div>
                <p className='mt-2 text-sm leading-5 text-muted-foreground'>{t(capability.descriptionKey)}</p>
                <span className='mt-3 flex items-center gap-1 text-xs font-semibold text-foreground'>
                  {t('feature.explore')}
                  <ArrowRight className='size-3.5 transition-transform group-hover:translate-x-0.5' aria-hidden='true' />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function PlatformOverviewPage() {
  const { t } = useModuleTranslation('platform-overview');
  const { t: tAdmin } = useModuleTranslation('admin');
  const { hasAdminAccess, accessibleMenuItems } = useAdminAccess();
  const { hasAnyPermission } = usePermissions();
  const canOpenGovernance = hasAnyPermission(['governance.read', 'governance.*', '*']);
  const adminDestinations = accessibleMenuItems.filter((item) => featuredAdminDestinations.has(item.id));

  return (
    <div className='h-full w-full overflow-y-auto'>
      <div className='mx-auto w-full max-w-7xl px-4 pb-10 pt-3 sm:px-6 sm:pb-14 sm:pt-6 lg:px-8'>
        <header className='relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-accent/60 px-5 py-8 shadow-sm sm:px-8 sm:py-10 lg:px-12 lg:py-12'>
          <div className='pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border border-primary/10' />
          <div className='pointer-events-none absolute -bottom-32 right-20 size-64 rounded-full bg-primary/5 blur-2xl' />
          <div className='relative max-w-3xl'>
            <div className='mb-4 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground backdrop-blur'>
              <Sparkles className='size-3.5 text-primary' aria-hidden='true' />
              {t('eyebrow')}
            </div>
            <h1 className='text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl lg:text-5xl'>
              {t('hero.title')}
            </h1>
            <p className='mt-4 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg'>
              {t('hero.description')}
            </p>
            <div className='mt-7 flex flex-col gap-3 sm:flex-row'>
              <Button asChild size='lg'>
                <Link to='/'>
                  {t('hero.startConversation')}
                  <ArrowRight className='size-4' aria-hidden='true' />
                </Link>
              </Button>
              <Button asChild size='lg' variant='outline' className='bg-background/60'>
                <Link to='/workspace'>{t('hero.openWorkspace')}</Link>
              </Button>
            </div>
          </div>
        </header>

        <Tabs defaultValue='overview' className='mt-8 gap-6'>
          <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-end'>
            <div>
              <h2 className='text-2xl font-semibold tracking-tight'>{t('overview.title')}</h2>
              <p className='mt-1 max-w-3xl text-sm leading-6 text-muted-foreground'>{t('overview.description')}</p>
            </div>
            {hasAdminAccess && (
              <TabsList aria-label={t('lens.ariaLabel')} className='w-full sm:w-auto'>
                <TabsTrigger value='overview'>{t('lens.overview')}</TabsTrigger>
                <TabsTrigger value='administration'>{t('lens.administration')}</TabsTrigger>
              </TabsList>
            )}
          </div>

          <TabsContent value='overview'>
            <div className='grid gap-4 lg:grid-cols-12'>
              <CapabilityPane
                titleKey='pane.knowledge.title'
                descriptionKey='pane.knowledge.description'
                icon={LibraryBig}
                capabilities={knowledgeCapabilities}
                className='lg:col-span-7'
              />
              <CapabilityPane
                titleKey='pane.collaboration.title'
                descriptionKey='pane.collaboration.description'
                icon={Building2}
                capabilities={collaborationCapabilities}
                className='lg:col-span-5'
              />
              <CapabilityPane
                titleKey='pane.automation.title'
                descriptionKey='pane.automation.description'
                icon={Boxes}
                capabilities={automationCapabilities}
                className='lg:col-span-8'
              />
              <CapabilityPane
                titleKey='pane.governance.title'
                descriptionKey='pane.governance.description'
                icon={ShieldCheck}
                capabilities={governanceCapabilities}
                className='lg:col-span-4'
                canOpenGovernance={canOpenGovernance}
              />
            </div>
          </TabsContent>

          {hasAdminAccess && (
            <TabsContent value='administration'>
              <section aria-labelledby='platform-administration-title' className='rounded-2xl border bg-card p-5 shadow-sm sm:p-7'>
                <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-start'>
                  <div>
                    <h2 id='platform-administration-title' className='text-xl font-semibold tracking-tight'>
                      {t('administration.title')}
                    </h2>
                    <p className='mt-1 max-w-3xl text-sm leading-6 text-muted-foreground'>{t('administration.description')}</p>
                  </div>
                  <Button asChild variant='outline'>
                    <Link to='/admin'>
                      {t('administration.console')}
                      <ArrowRight className='size-4' aria-hidden='true' />
                    </Link>
                  </Button>
                </div>

                {adminDestinations.length > 0 ? (
                  <div className='mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                    {adminDestinations.map((item) => (
                      <Card key={item.id} className='gap-4 py-5 transition-colors hover:border-primary/40'>
                        <CardHeader className='px-5'>
                          <div className='mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10'>
                            <item.icon className='size-4 text-primary' aria-hidden='true' />
                          </div>
                          <CardTitle className='text-base'>{tAdmin(item.labelKey)}</CardTitle>
                          <CardDescription className='leading-5'>{tAdmin(item.descriptionKey)}</CardDescription>
                        </CardHeader>
                        <CardContent className='px-5'>
                          <Link
                            to={item.path}
                            className='inline-flex items-center gap-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          >
                            {t('feature.explore')}
                            <ArrowRight className='size-3.5' aria-hidden='true' />
                          </Link>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className='mt-6 rounded-xl border bg-muted/40 p-5'>
                    <h3 className='font-medium'>{t('administration.empty.title')}</h3>
                    <p className='mt-1 text-sm text-muted-foreground'>{t('administration.empty.description')}</p>
                  </div>
                )}
              </section>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
