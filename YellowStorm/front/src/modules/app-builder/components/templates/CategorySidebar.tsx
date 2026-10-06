import { useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Store,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { TemplateCategory } from '../../types';
import { CategoryIcon } from './category-icons';

interface CategorySidebarProps {
  categories: TemplateCategory[];
  loading: boolean;
  error: boolean;
  selectedCategoryId: string | null;
  isSuperAdmin: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectAll: () => void;
  onSelectCategory: (id: string) => void;
  onAddCategory: () => void;
  onEditCategory: (category: TemplateCategory) => void;
  onDeleteCategory: (category: TemplateCategory) => void;
  onRetry: () => void;
}

function AllAppsItem({
  active,
  onClick,
  label,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      aria-label={compact ? label : undefined}
      title={label}
      className={cn(
        'group/nav relative flex w-full min-w-0 items-center rounded-xl text-left text-sm transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        compact ? 'justify-center px-1.5 py-2' : 'gap-3 px-2.5 py-2.5',
        active
          ? 'bg-primary/[0.1] font-semibold text-foreground shadow-[inset_3px_0_0_0_hsl(var(--primary))]'
          : 'font-medium text-foreground/85 hover:bg-muted/55 hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg transition-colors',
          compact ? 'size-9' : 'size-8',
          active
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted/70 text-muted-foreground group-hover/nav:bg-muted group-hover/nav:text-foreground',
        )}
        aria-hidden
      >
        <Store className={cn(compact ? 'size-4' : 'size-3.5')} />
      </span>
      {!compact ? <span className='min-w-0 flex-1 truncate leading-snug'>{label}</span> : null}
    </button>
  );
}

function CategoryRow({
  category,
  active,
  compact,
  isSuperAdmin,
  onSelect,
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
}: {
  category: TemplateCategory;
  active: boolean;
  compact: boolean;
  isSuperAdmin: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  editLabel: string;
  deleteLabel: string;
}) {
  const showCount = category.templateCount > 0;

  if (compact) {
    return (
      <button
        type='button'
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        aria-label={category.name}
        title={category.name}
        className={cn(
          'mx-auto flex size-9 items-center justify-center rounded-xl transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
          active
            ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        <CategoryIcon name={category.icon} className='size-4' />
      </button>
    );
  }

  return (
    <div
      className={cn(
        'group/row relative flex items-center gap-0.5 rounded-xl p-0.5 transition-colors',
        active ? 'bg-primary/[0.08]' : 'hover:bg-muted/40',
      )}
    >
      <button
        type='button'
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
          active ? 'text-foreground' : 'text-foreground/85',
          isSuperAdmin && 'pr-1',
        )}
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
            active
              ? 'border-primary/25 bg-primary/12 text-primary shadow-sm'
              : 'border-border/60 bg-background/80 text-muted-foreground group-hover/row:border-border group-hover/row:text-foreground',
          )}
          aria-hidden
        >
          <CategoryIcon name={category.icon} className='size-3.5' />
        </span>

        <span className='min-w-0 flex-1'>
          <span
            className={cn(
              'block truncate leading-snug tracking-tight',
              active ? 'font-semibold' : 'font-medium',
            )}
          >
            {category.name}
          </span>
        </span>

        {showCount ? (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
              isSuperAdmin &&
                'transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0',
              active
                ? 'bg-primary/12 text-primary'
                : 'bg-muted/80 text-muted-foreground',
            )}
          >
            {category.templateCount}
          </span>
        ) : null}
      </button>

      {isSuperAdmin ? (
        <div
          className={cn(
            'absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-background/95 p-0.5 shadow-sm ring-1 ring-border/60 backdrop-blur-sm',
            'opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100',
          )}
        >
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
            aria-label={editLabel}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className='size-3.5' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-7 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            aria-label={deleteLabel}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className='size-3.5' />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CategorySidebar({
  categories,
  loading,
  error,
  selectedCategoryId,
  isSuperAdmin,
  collapsed,
  onToggleCollapsed,
  onSelectAll,
  onSelectCategory,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onRetry,
}: CategorySidebarProps) {
  const { t } = useModuleTranslation('app-builder');
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const allActive = selectedCategoryId === null;
  const showCategoryList = collapsed || categoriesOpen;
  const categoryCount = categories.length;

  return (
    <aside
      className='flex h-full w-full flex-col gap-1'
      aria-label={t('categories.heading')}
    >
      <div
        className={cn(
          'mb-1 flex items-center gap-2',
          collapsed ? 'flex-col gap-2' : 'justify-between px-0.5',
        )}
      >
        {!collapsed ? (
          <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
            {t('categories.sidebarLabel')}
          </p>
        ) : null}
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className={cn(
            'hidden shrink-0 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground lg:inline-flex',
            collapsed ? 'size-9' : 'size-7',
          )}
          aria-label={
            collapsed ? t('categories.expandSidebar') : t('categories.collapseSidebar')
          }
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <ChevronRight className='size-4' aria-hidden />
          ) : (
            <ChevronLeft className='size-4' aria-hidden />
          )}
        </Button>
      </div>

      <AllAppsItem
        active={allActive}
        onClick={onSelectAll}
        label={t('categories.allApps')}
        compact={collapsed}
      />

      <div
        className={cn('my-2 h-px shrink-0 bg-border/70', collapsed ? 'mx-2' : 'mx-1')}
        role='separator'
      />

      {!collapsed ? (
        <div className='mb-1.5 flex items-center gap-1 px-0.5'>
          <button
            type='button'
            onClick={() => setCategoriesOpen((open) => !open)}
            aria-expanded={categoriesOpen}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pl-1 pr-1.5 text-left',
              'text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
              'transition-colors hover:bg-muted/45 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
            )}
          >
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 transition-transform duration-200',
                !categoriesOpen && '-rotate-90',
              )}
              aria-hidden
            />
            <span className='truncate'>{t('categories.heading')}</span>
            {!loading && !error && categoryCount > 0 ? (
              <span className='ml-auto shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'>
                {categoryCount}
              </span>
            ) : null}
          </button>
          {isSuperAdmin ? (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-7 shrink-0 rounded-lg border border-transparent text-muted-foreground hover:border-border/70 hover:bg-background hover:text-foreground'
              aria-label={t('categories.add')}
              onClick={onAddCategory}
            >
              <Plus className='size-3.5' />
            </Button>
          ) : null}
        </div>
      ) : null}

      {showCategoryList ? (
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:thin]'>
          {loading ? (
            <div className={cn('space-y-1.5', collapsed ? 'px-0' : 'px-0.5')}>
              {Array.from({ length: collapsed ? 4 : 5 }, (_, i) => (
                <Skeleton
                  key={i}
                  className={cn('w-full rounded-xl', collapsed ? 'mx-auto size-9' : 'h-11')}
                />
              ))}
            </div>
          ) : error ? (
            <div className='space-y-2 px-1 py-2 text-sm text-muted-foreground'>
              {!collapsed ? <p>{t('categories.error')}</p> : null}
              <Button
                type='button'
                variant='ghost'
                size={collapsed ? 'icon' : 'sm'}
                className='rounded-md'
                aria-label={t('page.retry')}
                onClick={onRetry}
              >
                {collapsed ? <RefreshCw className='size-4' /> : t('page.retry')}
              </Button>
            </div>
          ) : categories.length === 0 ? (
            !collapsed ? (
              <p className='px-1 py-2 text-sm leading-relaxed text-muted-foreground'>
                {t('categories.empty')}
              </p>
            ) : null
          ) : (
            <nav
              className={cn('flex flex-col gap-1 pb-1', collapsed ? 'items-center px-0' : 'px-0')}
              aria-label={t('categories.heading')}
            >
              {categories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  active={category.id === selectedCategoryId}
                  compact={collapsed}
                  isSuperAdmin={isSuperAdmin}
                  onSelect={() => onSelectCategory(category.id)}
                  onEdit={() => onEditCategory(category)}
                  onDelete={() => onDeleteCategory(category)}
                  editLabel={t('categories.edit')}
                  deleteLabel={t('categories.delete')}
                />
              ))}
            </nav>
          )}
        </div>
      ) : null}
    </aside>
  );
}
