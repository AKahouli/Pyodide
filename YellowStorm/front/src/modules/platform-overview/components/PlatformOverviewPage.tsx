import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Briefcase,
  Boxes,
  Building2,
  FileCheck2,
  Gauge,
  KeyRound,
  LibraryBig,
  MessageCircle,
  Network,
  Scale,
  ShieldCheck,
  Store,
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
type AccessRule = 'governance' | 'semanticModels';

interface GoalPath {
  titleKey: OverviewKey;
  descriptionKey: OverviewKey;
  chainKey: OverviewKey;
  actionKey: OverviewKey;
  to: string;
  icon: LucideIcon;
  accessRule?: AccessRule;
}

interface SupportingLink {
  labelKey: OverviewKey;
  to: string;
  accessRule?: AccessRule;
}

interface JourneyStep {
  titleKey: OverviewKey;
  descriptionKey: OverviewKey;
  actionKey: OverviewKey;
  to: string;
  icon: LucideIcon;
  accessRule?: AccessRule;
  supportingLink?: SupportingLink;
}

interface QuickDestination {
  labelKey: OverviewKey;
  to: string;
  icon: LucideIcon;
}

interface AtlasCapability {
  titleKey: OverviewKey;
  descriptionKey: OverviewKey;
  to: string;
  icon: LucideIcon;
  accessRule?: AccessRule;
}

interface AtlasDomain {
  titleKey: OverviewKey;
  descriptionKey: OverviewKey;
  relationshipKey: OverviewKey;
  capabilities: AtlasCapability[];
}

const goalPaths: GoalPath[] = [
  {
    titleKey: 'goal.answer.title',
    descriptionKey: 'goal.answer.description',
    chainKey: 'goal.answer.chain',
    actionKey: 'goal.answer.action',
    to: '/',
    icon: MessageCircle,
  },
  {
    titleKey: 'goal.knowledge.title',
    descriptionKey: 'goal.knowledge.description',
    chainKey: 'goal.knowledge.chain',
    actionKey: 'goal.knowledge.action',
    to: '/workspace',
    icon: LibraryBig,
  },
  {
    titleKey: 'goal.automate.title',
    descriptionKey: 'goal.automate.description',
    chainKey: 'goal.automate.chain',
    actionKey: 'goal.automate.action',
    to: '/playbooks',
    icon: Workflow,
  },
  {
    titleKey: 'goal.govern.title',
    descriptionKey: 'goal.govern.description',
    chainKey: 'goal.govern.chain',
    actionKey: 'goal.govern.action',
    to: '/governance',
    icon: ShieldCheck,
    accessRule: 'governance',
  },
];

const journeySteps: JourneyStep[] = [
  {
    titleKey: 'journey.conversation.title',
    descriptionKey: 'journey.conversation.description',
    actionKey: 'journey.conversation.action',
    to: '/',
    icon: MessageCircle,
  },
  {
    titleKey: 'journey.context.title',
    descriptionKey: 'journey.context.description',
    actionKey: 'journey.context.action',
    to: '/workspace',
    icon: LibraryBig,
    supportingLink: {
      labelKey: 'journey.context.semanticModels',
      to: '/semantic-models',
      accessRule: 'semanticModels',
    },
  },
  {
    titleKey: 'journey.automate.title',
    descriptionKey: 'journey.automate.description',
    actionKey: 'journey.automate.action',
    to: '/playbooks',
    icon: Workflow,
    supportingLink: {
      labelKey: 'journey.automate.agentNetwork',
      to: '/agents',
    },
  },
  {
    titleKey: 'journey.governance.title',
    descriptionKey: 'journey.governance.description',
    actionKey: 'journey.governance.action',
    to: '/governance',
    icon: ShieldCheck,
    accessRule: 'governance',
  },
];

const quickDestinations: QuickDestination[] = [
  { labelKey: 'quick.conversation', to: '/', icon: MessageCircle },
  { labelKey: 'quick.workspace', to: '/workspace', icon: LibraryBig },
  { labelKey: 'quick.agents', to: '/agents', icon: Bot },
  { labelKey: 'quick.playbooks', to: '/playbooks', icon: Workflow },
  { labelKey: 'quick.marketplace', to: '/app-builder', icon: Store },
];

const atlasDomains: AtlasDomain[] = [
  {
    titleKey: 'atlas.context.title',
    descriptionKey: 'atlas.context.description',
    relationshipKey: 'atlas.context.relationship',
    capabilities: [
      {
        titleKey: 'atlas.workspace.title',
        descriptionKey: 'atlas.workspace.description',
        to: '/workspace',
        icon: LibraryBig,
      },
      {
        titleKey: 'atlas.semanticModels.title',
        descriptionKey: 'atlas.semanticModels.description',
        to: '/semantic-models',
        icon: Network,
        accessRule: 'semanticModels',
      },
    ],
  },
  {
    titleKey: 'atlas.automate.title',
    descriptionKey: 'atlas.automate.description',
    relationshipKey: 'atlas.automate.relationship',
    capabilities: [
      {
        titleKey: 'atlas.agents.title',
        descriptionKey: 'atlas.agents.description',
        to: '/agents',
        icon: Bot,
      },
      {
        titleKey: 'atlas.teams.title',
        descriptionKey: 'atlas.teams.description',
        to: '/teams',
        icon: Users,
      },
      {
        titleKey: 'atlas.groups.title',
        descriptionKey: 'atlas.groups.description',
        to: '/groups',
        icon: Building2,
      },
      {
        titleKey: 'atlas.worky.title',
        descriptionKey: 'atlas.worky.description',
        to: '/worky',
        icon: Briefcase,
      },
      {
        titleKey: 'atlas.playbooks.title',
        descriptionKey: 'atlas.playbooks.description',
        to: '/playbooks',
        icon: Workflow,
      },
      {
        titleKey: 'atlas.connectedApps.title',
        descriptionKey: 'atlas.connectedApps.description',
        to: '/apps',
        icon: KeyRound,
      },
      {
        titleKey: 'atlas.marketplace.title',
        descriptionKey: 'atlas.marketplace.description',
        to: '/app-builder',
        icon: Store,
      },
    ],
  },
  {
    titleKey: 'atlas.trust.title',
    descriptionKey: 'atlas.trust.description',
    relationshipKey: 'atlas.trust.relationship',
    capabilities: [
      {
        titleKey: 'atlas.governance.title',
        descriptionKey: 'atlas.governance.description',
        to: '/governance',
        icon: ShieldCheck,
        accessRule: 'governance',
      },
    ],
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

export function PlatformOverviewPage() {
  const { t } = useModuleTranslation('platform-overview');
  const { t: tAdmin } = useModuleTranslation('admin');
  const { hasAdminAccess, accessibleMenuItems } = useAdminAccess();
  const { hasAnyPermission } = usePermissions();
  const canOpenGovernance = hasAnyPermission(['governance.read', 'governance.*', '*']);
  const canOpenSemanticModels = hasAnyPermission(['semantic_models.read', 'semantic_models.*', '*']);
  const adminDestinations = accessibleMenuItems.filter((item) => featuredAdminDestinations.has(item.id));
  const canAccess = (accessRule?: AccessRule) => {
    if (accessRule === 'governance') return canOpenGovernance;
    if (accessRule === 'semanticModels') return canOpenSemanticModels;
    return true;
  };

  return (
    <div className='h-full w-full overflow-y-auto'>
      <Tabs defaultValue='journey' className='min-h-full gap-0'>
        <div className='mx-auto flex w-full max-w-7xl items-center justify-end px-4 pt-3 sm:px-6 sm:pt-5 lg:px-8'>
          <TabsList aria-label={t('lens.ariaLabel')} className='h-11 w-full sm:h-9 sm:w-auto'>
              <TabsTrigger value='journey' className='h-9 flex-1 px-2 text-xs sm:h-auto sm:flex-none sm:px-3 sm:text-sm'>{t('lens.journey')}</TabsTrigger>
              <TabsTrigger value='atlas' className='h-9 flex-1 px-2 text-xs sm:h-auto sm:flex-none sm:px-3 sm:text-sm'>{t('lens.atlas')}</TabsTrigger>
            {hasAdminAccess && (
              <TabsTrigger value='administration' className='h-9 flex-1 sm:h-auto sm:flex-none'>{t('lens.administration')}</TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value='journey' className='mt-0'>
          <div className='mx-auto w-full max-w-7xl px-4 pb-44 pt-4 sm:px-6 sm:pb-36 sm:pt-6 lg:px-8'>
            <header className='overflow-hidden rounded-3xl border bg-card shadow-sm'>
              <div className='grid lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]'>
                <div className='flex flex-col justify-center px-5 py-9 sm:px-8 sm:py-12 lg:px-12 lg:py-14'>
                  <h1 className='max-w-3xl text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl lg:text-5xl'>
                    {t('hero.title')}
                  </h1>
                  <p className='mt-5 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg'>
                    {t('hero.description')}
                  </p>
                  <div className='mt-8 flex flex-col gap-3 sm:flex-row'>
                    <Button asChild size='lg' className='min-h-11'>
                      <Link to='/'>
                        {t('hero.startConversation')}
                        <ArrowRight className='size-4' aria-hidden='true' />
                      </Link>
                    </Button>
                    <Button asChild size='lg' variant='outline' className='min-h-11'>
                      <Link to='/worky'>{t('hero.openWorky')}</Link>
                    </Button>
                  </div>
                  <div className='mt-8 flex items-start gap-3 border-t pt-5 text-sm text-muted-foreground'>
                    <FileCheck2 className='mt-0.5 size-5 shrink-0 text-primary' aria-hidden='true' />
                    <p className='max-w-xl leading-6'>{t('hero.assurance')}</p>
                  </div>
                </div>

                <section id='recommended-routes' aria-labelledby='recommended-routes-title' className='border-t bg-muted/35 p-4 sm:p-6 lg:border-l lg:border-t-0 lg:p-8'>
                  <h2 id='recommended-routes-title' className='text-xl font-semibold tracking-tight sm:text-2xl'>
                    {t('goals.title')}
                  </h2>
                  <p className='mt-2 text-sm leading-6 text-muted-foreground'>{t('goals.description')}</p>
                  <div className='mt-5 divide-y overflow-hidden rounded-2xl border bg-background/70'>
                    {goalPaths.map((goal) => {
                      const GoalIcon = goal.icon;
                      const goalAccessible = canAccess(goal.accessRule);
                      const content = (
                        <>
                          <div className='flex size-9 items-center justify-center rounded-lg border bg-card'>
                            <GoalIcon className='size-4 text-primary' aria-hidden='true' />
                          </div>
                          <div>
                            <h3 className='font-semibold'>{t(goal.titleKey)}</h3>
                            <p className='mt-1 text-sm leading-5 text-muted-foreground'>{t(goal.descriptionKey)}</p>
                            <p className='mt-2 text-xs font-medium text-foreground'>{t(goal.chainKey)}</p>
                          </div>
                          <span className='flex items-center gap-1 text-sm font-semibold text-foreground'>
                            {goalAccessible ? t(goal.actionKey) : t('access.restricted')}
                            {goalAccessible && <ArrowRight className='size-4 transition-transform group-hover:translate-x-0.5' aria-hidden='true' />}
                          </span>
                        </>
                      );

                      if (!goalAccessible) {
                        return (
                          <div
                            key={goal.titleKey}
                            className='grid gap-3 p-4 opacity-70 sm:grid-cols-[auto_1fr_auto] sm:items-center'
                          >
                            {content}
                          </div>
                        );
                      }

                      return (
                        <Link
                          key={goal.titleKey}
                          to={goal.to}
                          className='group grid gap-3 p-4 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[auto_1fr_auto] sm:items-center'
                        >
                          {content}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              </div>
            </header>

            <section aria-labelledby='trust-title' className='mt-8 overflow-hidden rounded-3xl border bg-foreground text-background shadow-sm'>
              <div className='grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'>
                <div className='p-6 sm:p-8 lg:p-10'>
                  <h2 id='trust-title' className='max-w-xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl'>
                    {t('trust.title')}
                  </h2>
                  <p className='mt-4 max-w-xl text-sm leading-6 text-background/70 sm:text-base'>
                    {t('trust.description')}
                  </p>
                  <Button asChild variant='secondary' className='mt-6 min-h-11 sm:min-h-0'>
                    <Link to='/'>
                      {t('trust.action')}
                      <ArrowRight className='size-4' aria-hidden='true' />
                    </Link>
                  </Button>
                </div>
                <div className='grid border-t border-background/15 sm:grid-cols-3 lg:border-l lg:border-t-0'>
                  <div className='p-6 sm:p-7'>
                    <Gauge className='size-6 text-background' aria-hidden='true' />
                    <h3 className='mt-5 font-semibold'>{t('trust.score.title')}</h3>
                    <p className='mt-2 text-sm leading-6 text-background/70'>{t('trust.score.description')}</p>
                  </div>
                  <div className='border-t border-background/15 p-6 sm:border-l sm:border-t-0 sm:p-7'>
                    <Scale className='size-6 text-background' aria-hidden='true' />
                    <h3 className='mt-5 font-semibold'>{t('trust.claims.title')}</h3>
                    <p className='mt-2 text-sm leading-6 text-background/70'>{t('trust.claims.description')}</p>
                  </div>
                  <div className='border-t border-background/15 p-6 sm:border-l sm:border-t-0 sm:p-7'>
                    <FileCheck2 className='size-6 text-background' aria-hidden='true' />
                    <h3 className='mt-5 font-semibold'>{t('trust.audit.title')}</h3>
                    <p className='mt-2 text-sm leading-6 text-background/70'>{t('trust.audit.description')}</p>
                  </div>
                </div>
              </div>
            </section>

            <section aria-labelledby='journey-title' className='mt-12'>
              <div className='max-w-3xl'>
                <h2 id='journey-title' className='text-balance text-2xl font-semibold tracking-tight sm:text-3xl'>
                  {t('journey.title')}
                </h2>
                <p className='mt-3 text-sm leading-6 text-muted-foreground sm:text-base'>{t('journey.description')}</p>
              </div>

              <div className='mt-7 divide-y overflow-hidden rounded-2xl border bg-card shadow-sm'>
                {journeySteps.map((step) => {
                  const StepIcon = step.icon;
                  const stepAccessible = canAccess(step.accessRule);
                  const supportingAccessible = canAccess(step.supportingLink?.accessRule);

                  return (
                    <div key={step.titleKey} className='grid gap-4 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-6'>
                      <div className='flex size-11 items-center justify-center rounded-xl border bg-muted/60'>
                        <StepIcon className='size-5 text-primary' aria-hidden='true' />
                      </div>
                      <div>
                        <h3 className='text-lg font-semibold'>{t(step.titleKey)}</h3>
                        <p className='mt-1 max-w-3xl text-sm leading-6 text-muted-foreground'>{t(step.descriptionKey)}</p>
                        {step.supportingLink && (
                          supportingAccessible ? (
                            <Link
                              to={step.supportingLink.to}
                              className='mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0'
                            >
                              {t(step.supportingLink.labelKey)}
                              <ArrowRight className='size-3.5' aria-hidden='true' />
                            </Link>
                          ) : (
                            <p className='mt-2 text-xs font-medium text-muted-foreground'>{t('access.restricted')}</p>
                          )
                        )}
                      </div>
                      {stepAccessible ? (
                        <Button asChild variant='outline' className='min-h-11 w-full sm:min-h-0 sm:w-auto'>
                          <Link to={step.to}>{t(step.actionKey)}</Link>
                        </Button>
                      ) : (
                        <span className='text-sm font-medium text-muted-foreground'>{t('access.restricted')}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby='quick-title' className='mt-12 border-y py-7'>
              <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
                <div>
                  <h2 id='quick-title' className='text-xl font-semibold tracking-tight'>{t('quick.title')}</h2>
                  <p className='mt-1 text-sm leading-6 text-muted-foreground'>{t('quick.description')}</p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  {quickDestinations.map((destination) => {
                    const DestinationIcon = destination.icon;
                    return (
                      <Button key={destination.labelKey} asChild variant='outline' className='min-h-11 sm:min-h-0'>
                        <Link to={destination.to}>
                          <DestinationIcon className='size-4' aria-hidden='true' />
                          {t(destination.labelKey)}
                        </Link>
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className='mt-5 flex items-start gap-3 rounded-xl bg-muted/50 p-4'>
                <KeyRound className='mt-0.5 size-5 shrink-0 text-primary' aria-hidden='true' />
                <div>
                  <h3 className='text-sm font-semibold'>{t('authorizations.title')}</h3>
                  <p className='mt-1 text-sm leading-6 text-muted-foreground'>{t('authorizations.description')}</p>
                  <Link
                    to='/apps'
                    className='mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0'
                  >
                    {t('authorizations.action')}
                    <ArrowRight className='size-4' aria-hidden='true' />
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </TabsContent>

        <TabsContent value='atlas' className='mt-0'>
          <div className='mx-auto w-full max-w-7xl px-4 pb-44 pt-6 sm:px-6 sm:pb-36 lg:px-8'>
            <section aria-labelledby='platform-atlas-title'>
              <div className='max-w-3xl'>
                <h1 id='platform-atlas-title' className='text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl'>
                  {t('atlas.title')}
                </h1>
                <p className='mt-4 text-pretty text-base leading-7 text-muted-foreground'>{t('atlas.description')}</p>
              </div>

              <div className='relative mt-9 overflow-hidden rounded-3xl border bg-card p-4 shadow-sm sm:p-6 lg:p-8'>
                <div className='pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/8 to-transparent' aria-hidden='true' />

                <div className='relative mx-auto max-w-xl'>
                  <Link
                    to='/'
                    className='group flex min-h-11 items-center gap-4 rounded-2xl border border-primary/30 bg-background p-5 shadow-sm transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  >
                    <div className='flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground'>
                      <MessageCircle className='size-5' aria-hidden='true' />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h2 className='text-lg font-semibold'>{t('atlas.conversation.title')}</h2>
                      <p className='mt-1 text-sm leading-5 text-muted-foreground'>{t('atlas.conversation.description')}</p>
                    </div>
                    <ArrowRight className='size-5 shrink-0 transition-transform group-hover:translate-x-0.5' aria-hidden='true' />
                  </Link>
                </div>

                <div className='relative mx-auto flex h-20 max-w-xl items-center justify-center' aria-hidden='true'>
                  <span className='absolute inset-y-0 w-px bg-border' />
                  <span className='relative rounded-full border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground'>
                    {t('atlas.flow')}
                  </span>
                </div>

                <div className='relative grid items-start gap-4 lg:grid-cols-3'>
                  {atlasDomains.map((domain, domainIndex) => (
                    <section
                      key={domain.titleKey}
                      aria-labelledby={`atlas-domain-${domainIndex}`}
                      className='overflow-hidden rounded-2xl border bg-background/80'
                    >
                      <div className='border-b bg-muted/35 p-5 sm:p-6'>
                        <div className='flex items-center gap-3'>
                          <span className='h-px flex-1 bg-border' aria-hidden='true' />
                          <span className='text-xs font-semibold text-muted-foreground'>{t(domain.relationshipKey)}</span>
                        </div>
                        <h2 id={`atlas-domain-${domainIndex}`} className='mt-4 text-xl font-semibold tracking-tight'>
                          {t(domain.titleKey)}
                        </h2>
                        <p className='mt-2 text-sm leading-6 text-muted-foreground'>{t(domain.descriptionKey)}</p>
                      </div>

                      <div className='divide-y'>
                        {domain.capabilities.map((capability) => {
                          const CapabilityIcon = capability.icon;
                          const capabilityAccessible = canAccess(capability.accessRule);
                          const content = (
                            <>
                              <div className='flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card'>
                                <CapabilityIcon className='size-4 text-primary' aria-hidden='true' />
                              </div>
                              <div className='min-w-0 flex-1'>
                                <h3 className='font-semibold'>{t(capability.titleKey)}</h3>
                                <p className='mt-1 text-sm leading-5 text-muted-foreground'>{t(capability.descriptionKey)}</p>
                                {!capabilityAccessible && (
                                  <p className='mt-2 text-xs font-semibold text-muted-foreground'>{t('access.restricted')}</p>
                                )}
                              </div>
                            </>
                          );

                          return capabilityAccessible ? (
                            <Link
                              key={capability.titleKey}
                              to={capability.to}
                              className='group flex min-h-11 items-center gap-4 p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5'
                            >
                              {content}
                              <ArrowRight className='size-4 shrink-0 transition-transform group-hover:translate-x-0.5' aria-hidden='true' />
                            </Link>
                          ) : (
                            <div key={capability.titleKey} className='flex items-center gap-4 p-4 opacity-70 sm:p-5'>
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                <div className='relative mt-5 flex items-start gap-3 rounded-2xl border border-dashed bg-muted/25 p-4 sm:items-center sm:p-5'>
                  <Boxes className='mt-0.5 size-5 shrink-0 text-primary sm:mt-0' aria-hidden='true' />
                  <p className='text-sm leading-6 text-muted-foreground'>{t('atlas.footer')}</p>
                </div>
              </div>
            </section>
          </div>
        </TabsContent>

        {hasAdminAccess && (
          <TabsContent value='administration' className='mt-0'>
            <div className='mx-auto w-full max-w-7xl px-4 pb-14 pt-6 sm:px-6 lg:px-8'>
              <section aria-labelledby='platform-administration-title' className='rounded-2xl border bg-card p-5 shadow-sm sm:p-7'>
                <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-start'>
                  <div>
                    <h1 id='platform-administration-title' className='text-2xl font-semibold tracking-tight'>
                      {t('administration.title')}
                    </h1>
                    <p className='mt-2 max-w-3xl text-sm leading-6 text-muted-foreground'>{t('administration.description')}</p>
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
                            {t('administration.open')}
                            <ArrowRight className='size-3.5' aria-hidden='true' />
                          </Link>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className='mt-6 rounded-xl border bg-muted/40 p-5'>
                    <h2 className='font-medium'>{t('administration.empty.title')}</h2>
                    <p className='mt-1 text-sm text-muted-foreground'>{t('administration.empty.description')}</p>
                  </div>
                )}
              </section>
            </div>
          </TabsContent>
        )}
      </Tabs>

      <Link
        to='/worky'
        aria-label={t('worky.launchAriaLabel')}
        className='group fixed bottom-4 right-4 z-40 flex size-14 items-center justify-center rounded-2xl border bg-card/95 p-0 shadow-lg backdrop-blur-sm transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-auto sm:w-64 sm:justify-start sm:gap-3 sm:p-3'
      >
        <div className='relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground'>
          <BrainCircuit className='size-5' aria-hidden='true' />
          <span className='absolute -right-1 -top-1 size-3 rounded-full border-2 border-card bg-primary' />
        </div>
        <div className='hidden min-w-0 flex-1 sm:block'>
          <div className='flex items-center justify-between gap-3'>
            <span className='font-semibold'>{t('worky.title')}</span>
            <ArrowRight className='size-4 shrink-0 transition-transform group-hover:translate-x-0.5' aria-hidden='true' />
          </div>
          <p className='mt-0.5 text-xs font-medium text-muted-foreground'>{t('worky.mobileAction')}</p>
        </div>
      </Link>
    </div>
  );
}
