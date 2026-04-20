import { ChevronRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

interface FolderNavigationProps {
  breadcrumbs: BreadcrumbItem[];
  onNavigate: (folderId: string | null) => void;
}

export function FolderNavigation({ breadcrumbs, onNavigate }: FolderNavigationProps) {
  const { t } = useModuleTranslation('workspace');

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b bg-muted/30">
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-7 gap-1', breadcrumbs.length === 0 && 'bg-accent')}
        onClick={() => onNavigate(null)}
      >
        <Home className="h-3.5 w-3.5" />
        <span className="text-sm">{t('folder.root')}</span>
      </Button>

      {breadcrumbs.map((item, index) => (
        <div key={item.id} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1', index === breadcrumbs.length - 1 && 'bg-accent')}
            onClick={() => onNavigate(item.id)}
          >
            <span className="text-sm truncate max-w-32">{item.name}</span>
          </Button>
        </div>
      ))}
    </div>
  );
}

export interface BreadcrumbItem {
  id: string;
  name: string;
}
