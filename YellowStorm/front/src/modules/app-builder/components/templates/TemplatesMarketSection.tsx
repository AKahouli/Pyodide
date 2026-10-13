import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { startTemplateSession } from '@/modules/app-builder-studio/startAgentSession';
import { useAppBuilderStore } from '../../store';
import type { AppTemplate } from '../../types';
import { TemplateGrid } from './TemplateGrid';
import { TemplateDetailDialog } from './TemplateDetailDialog';
import { TemplateFormDrawer } from './TemplateFormDrawer';

export interface TemplatesMarketSectionProps {
  isSuperAdmin: boolean;
  onRequestDeleteTemplate: (template: AppTemplate) => void;
}

/**
 * App Market templates for the selected category: grid, detail, create/edit drawer, Clone App.
 */
export function TemplatesMarketSection({
  isSuperAdmin,
  onRequestDeleteTemplate,
}: TemplatesMarketSectionProps) {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();

  const categories = useAppBuilderStore((s) => s.categories);
  const templates = useAppBuilderStore((s) => s.templates);
  const templatesLoading = useAppBuilderStore((s) => s.templatesLoading);
  const templatesError = useAppBuilderStore((s) => s.templatesError);
  const selectedCategoryId = useAppBuilderStore((s) => s.selectedCategoryId);
  const fetchCategories = useAppBuilderStore((s) => s.fetchCategories);
  const fetchTemplates = useAppBuilderStore((s) => s.fetchTemplates);

  const [activeTemplate, setActiveTemplate] = useState<AppTemplate | null>(null);
  const [cloningTemplateId, setCloningTemplateId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState<{
    open: boolean;
    template: AppTemplate | null;
  }>({ open: false, template: null });
  const [templateSearch, setTemplateSearch] = useState('');

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (tpl) =>
        tpl.title.toLowerCase().includes(q) ||
        tpl.description.toLowerCase().includes(q) ||
        tpl.categoryName.toLowerCase().includes(q),
    );
  }, [templates, templateSearch]);

  useEffect(() => {
    setTemplateSearch('');
  }, [selectedCategoryId]);

  const refreshTemplates = () => {
    if (selectedCategoryId) fetchTemplates(selectedCategoryId);
  };

  const refreshCatalog = () => {
    fetchCategories();
    refreshTemplates();
  };

  const handleCloneTemplate = async (template: AppTemplate) => {
    if (cloningTemplateId) return;
    setCloningTemplateId(template.id);
    try {
      await startTemplateSession({
        templateId: template.id,
        navigate,
      });
    } catch {
      toast.error(t('templates.cloneError'));
    } finally {
      setCloningTemplateId(null);
    }
  };

  return (
    <>
      {selectedCategoryId !== null ? (
        <section
          key={selectedCategoryId}
          aria-labelledby='app-builder-templates-heading'
          className='animate-in fade-in-0 slide-in-from-top-1 space-y-6 border-t border-border/50 pt-8 duration-200'
        >
          <div className='flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
            <div className='min-w-0 space-y-2.5'>
              <nav
                aria-label={t('templates.breadcrumbAria')}
                className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:text-sm'
              >
                <span>{t('page.eyebrow')}</span>
                <ChevronRight className='size-3.5 shrink-0 opacity-50' aria-hidden />
                <span className='truncate font-medium text-foreground'>
                  {selectedCategory?.name ?? t('templates.heading')}
                </span>
              </nav>
              <div className='space-y-1'>
                <h2
                  id='app-builder-templates-heading'
                  className='truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl'
                >
                  {selectedCategory?.name ?? t('templates.heading')}
                </h2>
                <p className='text-sm leading-relaxed text-muted-foreground'>
                  {templatesLoading
                    ? t('templates.loading')
                    : templateSearch.trim()
                      ? t('templates.filteredCount', {
                          count: filteredTemplates.length,
                          total: templates.length,
                        })
                      : t('templates.count', { count: templates.length })}
                </p>
              </div>
            </div>
            <div className='flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:min-w-[280px]'>
              <div className='relative flex-1'>
                <Search
                  className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
                  aria-hidden
                />
                <Input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder={t('templates.searchPlaceholder')}
                  className='h-10 rounded-xl border-border/60 bg-card pl-9 pr-9 shadow-sm'
                  aria-label={t('templates.searchPlaceholder')}
                />
                {templateSearch ? (
                  <button
                    type='button'
                    onClick={() => setTemplateSearch('')}
                    className='absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground'
                    aria-label={t('hub.filters.clear')}
                  >
                    <X className='size-4' />
                  </button>
                ) : null}
              </div>
              {isSuperAdmin ? (
                <Button
                  type='button'
                  size='sm'
                  className='h-10 shrink-0 gap-1.5 rounded-full px-4'
                  onClick={() => setTemplateForm({ open: true, template: null })}
                >
                  <Plus className='size-4' aria-hidden />
                  {t('templates.new')}
                </Button>
              ) : null}
            </div>
          </div>

          <TemplateGrid
            templates={filteredTemplates}
            loading={templatesLoading}
            error={templatesError}
            categoryName={selectedCategory?.name}
            onRetry={refreshTemplates}
            onOpen={setActiveTemplate}
            onClone={handleCloneTemplate}
            cloningTemplateId={cloningTemplateId}
            isSuperAdmin={isSuperAdmin}
            onEdit={(template) => setTemplateForm({ open: true, template })}
            onDelete={onRequestDeleteTemplate}
          />
        </section>
      ) : null}

      <TemplateDetailDialog
        template={activeTemplate}
        open={activeTemplate !== null}
        onOpenChange={(open) => !open && setActiveTemplate(null)}
        isSuperAdmin={isSuperAdmin}
        onClone={handleCloneTemplate}
        cloning={cloningTemplateId === activeTemplate?.id}
        onEdit={(template) => {
          setActiveTemplate(null);
          setTemplateForm({ open: true, template });
        }}
        onDelete={(template) => {
          setActiveTemplate(null);
          onRequestDeleteTemplate(template);
        }}
      />

      <TemplateFormDrawer
        open={templateForm.open}
        template={templateForm.template}
        categories={categories}
        defaultCategoryId={selectedCategoryId}
        onOpenChange={(open) => setTemplateForm((prev) => ({ ...prev, open }))}
        onSaved={refreshCatalog}
      />
    </>
  );
}
