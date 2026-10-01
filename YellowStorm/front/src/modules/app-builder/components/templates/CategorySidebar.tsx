import { useState, type ReactNode } from 'react';
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

function NavItem({
  active,
  onClick,
  icon,
  label,
  count,
  compact,
  className,
  emphasize,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  /** Template count for a category; omit for filters without a meaningful total. */
  count?: number;
  compact?: boolean;
  className?: string;
  /** Stronger visual weight for primary filters (e.g. All applications). */
  emphasize?: boolean;
}) {
  const showCount = typeof count === 'number' && count > 0;

  return (
    <button
      type='button'
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      aria-label={compact ? label : undefined}
      title={label}
      className={cn(
        'group/nav relative flex w-full min-w-0 items-center rounded-lg text-left text-sm transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        compact ? 'justify-center px-1.5 py-2' : 'gap-2.5 px-2.5 py-2',
        active
          ? 'bg-primary/[0.09] font-medium text-foreground shadow-[inset_3px_0_0_0_hsl(var(--primary))]'
          : 'text-foreground/80 hover:bg-muted/55 hover:text-foreground',
        emphasize && !active && 'font-medium text-foreground/90',
        className,
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md transition-colors',
          compact ? 'size-9' : 'size-7',
          active
            ? 'bg-primary/12 text-primary'
            : 'bg-muted/50 text-muted-foreground group-hover/nav:bg-muted group-hover/nav:text-foreground',
        )}
        aria-hidden
      >
        {icon}
      </span>
      {!compact ? (
        <>
          <span className='min-w-0 flex-1 truncate leading-snug'>{label}</span>
          {showCount ? (
            <span
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted/70 text-muted-foreground',
              )}
            >
              {count}
            </span>
          ) : null}
        </>
      ) : null}
    </button>
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

      <NavItem
        active={allActive}
        onClick={onSelectAll}
        label={t('categories.allApps')}
        compact={collapsed}
        emphasize
        icon={<Store className='size-3.5' />}
      />

      <div
        className={cn('my-2 h-px shrink-0 bg-border/70', collapsed ? 'mx-2' : 'mx-1')}
        role='separator'
      />

      {!collapsed ? (
        <div className='mb-1 flex items-center gap-1 px-0.5'>
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
              <span className='ml-auto shrink-0 rounded-md bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'>
                {categoryCount}
              </span>
            ) : null}
          </button>
          {isSuperAdmin ? (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground'
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
                  className={cn('w-full rounded-lg', collapsed ? 'mx-auto size-9' : 'h-9')}
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
              className={cn('flex flex-col gap-0.5 pb-1', collapsed ? 'px-0' : 'px-0.5')}
              aria-label={t('categories.heading')}
            >
              {categories.map((category) => {
                const active = category.id === selectedCategoryId;
                return (
                  <div key={category.id} className='group relative'>
                    <NavItem
                      active={active}
                      onClick={() => onSelectCategory(category.id)}
                      label={category.name}
                      count={category.templateCount}
                      compact={collapsed}
                      icon={
                        <CategoryIcon
                          name={category.icon}
                          className={cn(
                            'size-3.5',
                            active ? 'text-primary' : 'text-muted-foreground',
                          )}
                        />
                      }
                      className={!collapsed && isSuperAdmin ? 'pr-14' : undefined}
                    />
                    {!collapsed && isSuperAdmin ? (
                      <div className='absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-7 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                          aria-label={t('categories.edit')}
                          onClick={() => onEditCategory(category)}
                        >
                          <Pencil className='size-3.5' />
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-7 rounded-md text-muted-foreground hover:bg-fail/10 hover:text-fail'
                          aria-label={t('categories.delete')}
                          onClick={() => onDeleteCategory(category)}
                        >
                          <Trash2 className='size-3.5' />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </nav>
          )}
        </div>
      ) : null}
    </aside>
  );
}
