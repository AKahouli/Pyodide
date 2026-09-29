import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus, Search, Store, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import { adminTemplateApi } from '../api';
import { useAppBuilderStore } from '../store';
import type { AppTemplate, TemplateCategory } from '../types';
import { AppMarketAppsView } from './AppMarketAppsView';
import { CategorySidebar } from './templates/CategorySidebar';
import { TemplateGrid } from './templates/TemplateGrid';
import { TemplateDetailDialog } from './templates/TemplateDetailDialog';
import { CategoryFormDialog } from './templates/CategoryFormDialog';
import { TemplateFormDrawer } from './templates/TemplateFormDrawer';

type PendingDelete =
  | { kind: 'category'; item: TemplateCategory }
  | { kind: 'template'; item: AppTemplate };

export function AppBuilderPage() {
  const { t } = useModuleTranslation('app-builder');
  const { hasPermission } = usePermissions();
  const isSuperAdmin = hasPermission('*');

  const deployed = useAppBuilderStore((s) => s.deployed);
  const shared = useAppBuilderStore((s) => s.shared);
  const drafts = useAppBuilderStore((s) => s.drafts);
  const categories = useAppBuilderStore((s) => s.categories);
  const categoriesLoading = useAppBuilderStore((s) => s.categoriesLoading);
  const categoriesError = useAppBuilderStore((s) => s.categoriesError);
  const templates = useAppBuilderStore((s) => s.templates);
  const templatesLoading = useAppBuilderStore((s) => s.templatesLoading);
  const templatesError = useAppBuilderStore((s) => s.templatesError);
  const selectedCategoryId = useAppBuilderStore((s) => s.selectedCategoryId);
  const fetchCategories = useAppBuilderStore((s) => s.fetchCategories);
  const selectCategory = useAppBuilderStore((s) => s.selectCategory);
  const fetchTemplates = useAppBuilderStore((s) => s.fetchTemplates);

  const [activeTemplate, setActiveTemplate] = useState<AppTemplate | null>(null);
  const [categoryForm, setCategoryForm] = useState<{
    open: boolean;
    category: TemplateCategory | null;
  }>({ open: false, category: null });
  const [templateForm, setTemplateForm] = useState<{
    open: boolean;
    template: AppTemplate | null;
  }>({ open: false, template: null });
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [categorySidebarCollapsed, setCategorySidebarCollapsed] = useState(false);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (!mq.matches) setCategorySidebarCollapsed(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;
  const totalApps = deployed.length + shared.length + drafts.length;

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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'category') {
        await adminTemplateApi.deleteCategory(pendingDelete.item.id);
        if (selectedCategoryId === pendingDelete.item.id) selectCategory(null);
        fetchCategories();
      } else {
        await adminTemplateApi.deleteTemplate(pendingDelete.item.id);
        refreshTemplates();
      }
      toast.success(t('admin.deleteSuccess'));
    } catch {
      toast.error(t('admin.deleteError'));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <header className='border-b border-border/60 bg-card/40'>
        <div className='mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-10 sm:py-7'>
          <div className='min-w-0 max-w-2xl'>
            <div className='mb-2.5 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>
              <Store className='size-3.5 text-primary' aria-hidden />
              {t('page.eyebrow')}
            </div>
            <h1 className='text-2xl font-semibold tracking-tight text-foreground sm:text-3xl'>
              {t('page.title')}
            </h1>
            <p className='mt-2 text-sm leading-relaxed text-muted-foreground'>
              {t('page.description')}
            </p>
          </div>
          {totalApps > 0 ? (
            <p className='shrink-0 text-xs tabular-nums text-muted-foreground'>
              {totalApps === 1
                ? t('hub.sections.singleApp')
                : t('hub.sections.appsCount', { count: totalApps })}
            </p>
          ) : null}
        </div>
      </header>

      <div className='flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row'>
        <div
          className={cn(
            'shrink-0 bg-muted/15 transition-[width] duration-200 ease-out lg:bg-transparent',
            categorySidebarCollapsed ? 'lg:w-[4.25rem]' : 'lg:w-72 xl:w-80',
          )}
        >
          <div className='h-full overflow-y-auto px-3 py-4 lg:px-3 lg:py-4'>
            <CategorySidebar
              categories={categories}
              loading={categoriesLoading}
              error={categoriesError}
              selectedCategoryId={selectedCategoryId}
              isSuperAdmin={isSuperAdmin}
              collapsed={categorySidebarCollapsed}
              onToggleCollapsed={() => setCategorySidebarCollapsed((c) => !c)}
              onSelectAll={() => selectCategory(null)}
              onSelectCategory={(id) => selectCategory(id)}
              onAddCategory={() => setCategoryForm({ open: true, category: null })}
              onEditCategory={(category) => setCategoryForm({ open: true, category })}
              onDeleteCategory={(category) => setPendingDelete({ kind: 'category', item: category })}
              onRetry={fetchCategories}
            />
          </div>
        </div>

        <div className='min-w-0 flex-1 overflow-y-auto bg-gradient-to-br from-background via-background to-muted/25'>
          <div className='mx-auto max-w-6xl px-6 py-6 sm:px-10 sm:py-7'>
            <AppMarketAppsView>
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
                  />
                </section>
              ) : null}
            </AppMarketAppsView>
          </div>
        </div>
      </div>

      <TemplateDetailDialog
        template={activeTemplate}
        open={activeTemplate !== null}
        onOpenChange={(open) => !open && setActiveTemplate(null)}
        isSuperAdmin={isSuperAdmin}
        onEdit={(template) => {
          setActiveTemplate(null);
          setTemplateForm({ open: true, template });
        }}
        onDelete={(template) => {
          setActiveTemplate(null);
          setPendingDelete({ kind: 'template', item: template });
        }}
      />

      <CategoryFormDialog
        open={categoryForm.open}
        category={categoryForm.category}
        onOpenChange={(open) => setCategoryForm((prev) => ({ ...prev, open }))}
        onSaved={fetchCategories}
      />

      <TemplateFormDrawer
        open={templateForm.open}
        template={templateForm.template}
        categories={categories}
        defaultCategoryId={selectedCategoryId}
        onOpenChange={(open) => setTemplateForm((prev) => ({ ...prev, open }))}
        onSaved={refreshTemplates}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === 'category'
                ? t('admin.deleteCategoryTitle')
                : t('admin.deleteTemplateTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === 'category'
                ? t('admin.deleteCategoryDescription', { name: pendingDelete.item.name })
                : t('admin.deleteTemplateDescription', { name: pendingDelete?.item.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('card.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? <Loader2 className='mr-2 size-4 animate-spin' aria-hidden /> : null}
              {t('admin.confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
