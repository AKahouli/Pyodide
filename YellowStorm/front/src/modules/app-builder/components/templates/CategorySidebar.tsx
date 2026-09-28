import { Pencil, Plus, Store, Trash2 } from 'lucide-react';
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
  onSelectAll: () => void;
  onSelectCategory: (id: string) => void;
  onAddCategory: () => void;
  onEditCategory: (category: TemplateCategory) => void;
  onDeleteCategory: (category: TemplateCategory) => void;
  onRetry: () => void;
}

export function CategorySidebar({
  categories,
  loading,
  error,
  selectedCategoryId,
  isSuperAdmin,
  onSelectAll,
  onSelectCategory,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onRetry,
}: CategorySidebarProps) {
  const { t } = useModuleTranslation('app-builder');

  return (
    <aside className='flex w-full shrink-0 flex-col gap-1 border-border/60 lg:w-64 lg:border-r'>
      <div className='px-1 pb-2 pt-1'>
        <Button
          type='button'
          variant={selectedCategoryId === null ? 'secondary' : 'ghost'}
          className={cn(
            'w-full justify-start gap-2',
            selectedCategoryId === null && 'bg-primary/10 text-primary hover:bg-primary/15',
          )}
          onClick={onSelectAll}
          aria-pressed={selectedCategoryId === null}
        >
          <Store className='size-4' aria-hidden />
          {t('categories.allApps')}
        </Button>
      </div>

      <div className='flex items-center justify-between px-3 pb-1 pt-3'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
          {t('categories.heading')}
        </p>
        {isSuperAdmin ? (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-6 text-muted-foreground hover:text-foreground'
            aria-label={t('categories.add')}
            onClick={onAddCategory}
          >
            <Plus className='size-4' />
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className='space-y-1.5 px-1 py-1'>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className='h-9 w-full rounded-lg' />
          ))}
        </div>
      ) : error ? (
        <div className='px-3 py-2 text-sm text-muted-foreground'>
          <p>{t('categories.error')}</p>
          <Button type='button' variant='outline' size='sm' className='mt-2' onClick={onRetry}>
            {t('page.retry')}
          </Button>
        </div>
      ) : categories.length === 0 ? (
        <p className='px-3 py-2 text-sm text-muted-foreground'>{t('categories.empty')}</p>
      ) : (
        <nav className='flex flex-col gap-0.5 px-1'>
          {categories.map((category) => {
            const active = category.id === selectedCategoryId;
            return (
              <div
                key={category.id}
                className={cn(
                  'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                  active ? 'bg-primary/10' : 'hover:bg-accent/50',
                )}
              >
                <button
                  type='button'
                  onClick={() => onSelectCategory(category.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                    active ? 'font-medium text-primary' : 'text-foreground/90',
                  )}
                >
                  <span className='flex size-5 shrink-0 items-center justify-center text-muted-foreground'>
                    <CategoryIcon name={category.icon} className='size-4' />
                  </span>
                  <span className='min-w-0 flex-1 truncate'>{category.name}</span>
                  <span className='shrink-0 text-[11px] tabular-nums text-muted-foreground'>
                    {category.templateCount}
                  </span>
                </button>
                {isSuperAdmin ? (
                  <div className='flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7 text-muted-foreground hover:text-foreground'
                      aria-label={t('categories.edit')}
                      onClick={() => onEditCategory(category)}
                    >
                      <Pencil className='size-3.5' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7 text-muted-foreground hover:text-fail'
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
    </aside>
  );
}
