import { useEffect, useState } from 'react';
import { Loader2, Plus, Store } from 'lucide-react';
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
import { TemplateFormDialog } from './templates/TemplateFormDialog';

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

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;
  const totalApps = deployed.length + shared.length + drafts.length;

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
      <header className='relative overflow-hidden border-b border-border/60'>
        <div
          className='pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-muted/30'
          aria-hidden
        />
        <div className='relative mx-auto max-w-6xl px-6 pb-6 pt-8 sm:px-10 sm:pt-10'>
          <div className='mb-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-sm backdrop-blur-sm'>
            <Store className='size-3.5 text-primary' aria-hidden />
            {t('page.eyebrow')}
          </div>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div className='min-w-0 max-w-2xl'>
              <h1 className='text-3xl font-semibold tracking-tight text-foreground sm:text-4xl'>
                {t('page.title')}
              </h1>
              <p className='mt-2.5 text-sm leading-relaxed text-muted-foreground sm:text-[15px]'>
                {t('page.description')}
              </p>
            </div>
            {selectedCategoryId === null && totalApps > 0 ? (
              <p className='shrink-0 text-xs tabular-nums text-muted-foreground sm:pb-1'>
                {totalApps === 1
                  ? t('hub.sections.singleApp')
                  : t('hub.sections.appsCount', { count: totalApps })}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className='flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row'>
        <div className='shrink-0 overflow-y-auto border-b border-border/60 lg:w-64 lg:border-b-0'>
          <div className='px-3 py-4 lg:px-3'>
            <CategorySidebar
              categories={categories}
              loading={categoriesLoading}
              error={categoriesError}
              selectedCategoryId={selectedCategoryId}
              isSuperAdmin={isSuperAdmin}
              onSelectAll={() => selectCategory(null)}
              onSelectCategory={(id) => selectCategory(id)}
              onAddCategory={() => setCategoryForm({ open: true, category: null })}
              onEditCategory={(category) => setCategoryForm({ open: true, category })}
              onDeleteCategory={(category) => setPendingDelete({ kind: 'category', item: category })}
              onRetry={fetchCategories}
            />
          </div>
        </div>

        <div className='flex-1 overflow-y-auto'>
          <div className='mx-auto max-w-6xl px-6 py-7 sm:px-10'>
            {selectedCategoryId === null ? (
              <AppMarketAppsView />
            ) : (
              <div className='space-y-6'>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                  <div className='min-w-0'>
                    <h2 className='truncate text-xl font-semibold tracking-tight text-foreground'>
                      {selectedCategory?.name ?? t('templates.heading')}
                    </h2>
                    <p className='mt-1 text-sm text-muted-foreground'>
                      {templatesLoading
                        ? t('templates.loading')
                        : t('templates.count', { count: templates.length })}
                    </p>
                  </div>
                  {isSuperAdmin ? (
                    <Button
                      type='button'
                      size='sm'
                      className='gap-1.5'
                      onClick={() => setTemplateForm({ open: true, template: null })}
                    >
                      <Plus className='size-4' aria-hidden />
                      {t('templates.new')}
                    </Button>
                  ) : null}
                </div>

                <TemplateGrid
                  templates={templates}
                  loading={templatesLoading}
                  error={templatesError}
                  categoryName={selectedCategory?.name}
                  onRetry={refreshTemplates}
                  onOpen={setActiveTemplate}
                />
              </div>
            )}
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

      <TemplateFormDialog
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
