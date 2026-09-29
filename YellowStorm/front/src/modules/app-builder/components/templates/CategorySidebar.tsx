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
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      aria-label={compact ? label : undefined}
      title={label}
      className={cn(
        'flex w-full min-w-0 items-center rounded-xl text-left text-sm transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        compact ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2.5',
        active
          ? 'bg-primary/[0.08] font-medium text-foreground'
          : 'text-foreground/85 hover:bg-muted/50 hover:text-foreground',
        className,
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg transition-colors',
          compact ? 'size-9' : 'size-8',
          active ? 'bg-primary/10 text-primary' : 'bg-muted/40 text-muted-foreground',
        )}
        aria-hidden
      >
        {icon}
      </span>
      {!compact ? (
        <>
          <span className='min-w-0 flex-1 break-words leading-snug [overflow-wrap:anywhere]'>
            {label}
          </span>
          {count !== undefined ? (
            <span
              className={cn(
                'shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground',
                active && 'bg-muted/60',
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
  const totalTemplates = categories.reduce((sum, c) => sum + c.templateCount, 0);
  const showCategoryList = collapsed || categoriesOpen;

  return (
    <aside
      className='flex h-full w-full flex-col lg:p-1'
      aria-label={t('categories.heading')}
    >
      <div
        className={cn(
          'mb-3 flex items-center gap-2',
          collapsed ? 'flex-col' : 'justify-between px-1',
        )}
      >
        {!collapsed ? (
          <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>
            {t('categories.sidebarLabel')}
          </p>
        ) : null}
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className={cn(
            'hidden shrink-0 rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:inline-flex',
            collapsed ? 'size-9' : 'size-8',
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
        count={totalTemplates}
        compact={collapsed}
        icon={<Store className='size-4' />}
      />

      <div className={cn('my-3', collapsed ? 'mx-1 h-px bg-muted/50' : 'mx-1 h-px bg-muted/40')} />

      {!collapsed ? (
        <div className='mb-2 flex items-center gap-1 px-0.5'>
          <button
            type='button'
            onClick={() => setCategoriesOpen((open) => !open)}
            aria-expanded={categoriesOpen}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1.5 pl-1 pr-2 text-left',
              'text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground',
              'transition-colors hover:bg-muted/40 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
            )}
          >
            <ChevronDown
              className={cn(
                'size-4 shrink-0 transition-transform duration-200',
                !categoriesOpen && '-rotate-90',
              )}
              aria-hidden
            />
            <span className='truncate'>{t('categories.heading')}</span>
          </button>
          {isSuperAdmin ? (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              aria-label={t('categories.add')}
              onClick={onAddCategory}
            >
              <Plus className='size-4' />
            </Button>
          ) : null}
        </div>
      ) : null}

      {showCategoryList ? (
        <div className='min-h-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:thin]'>
          {loading ? (
            <div className={cn('space-y-2', collapsed ? 'px-0' : 'px-0.5')}>
              {Array.from({ length: collapsed ? 4 : 5 }, (_, i) => (
                <Skeleton
                  key={i}
                  className={cn('w-full rounded-xl', collapsed ? 'mx-auto size-9' : 'h-11')}
                />
              ))}
            </div>
          ) : error ? (
            <div className='px-1 py-2 text-sm text-muted-foreground'>
              {!collapsed ? <p>{t('categories.error')}</p> : null}
              <Button
                type='button'
                variant='ghost'
                size={collapsed ? 'icon' : 'sm'}
                className={cn('rounded-lg', !collapsed && 'mt-3')}
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
            <nav className={cn('flex flex-col gap-1 pb-1', collapsed ? 'px-0' : 'px-0.5')}>
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
                          className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')}
                        />
                      }
                      className={!collapsed && isSuperAdmin ? 'pr-16' : undefined}
                    />
                    {!collapsed && isSuperAdmin ? (
                      <div className='absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-8 rounded-lg text-muted-foreground hover:text-foreground'
                          aria-label={t('categories.edit')}
                          onClick={() => onEditCategory(category)}
                        >
                          <Pencil className='size-3.5' />
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-8 rounded-lg text-muted-foreground hover:text-fail'
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
