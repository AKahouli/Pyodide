'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Cable, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { getConnectorRepositories, type ConnectorRepository } from '@/modules/connector';

interface Repo {
  id: string;
  name: string;
  description?: string;
  url?: string;
  isSelected?: boolean;
}

interface ConnectorReposDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector: { id: string; name: string; description?: string } | null;
  onRepositorySelect?: (repo: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string }) => void;
}

export function ConnectorReposDialog({ open, onOpenChange, connector, onRepositorySelect }: ConnectorReposDialogProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useModuleTranslation('common');

  useEffect(() => {
    if (!open || !connector) {
      setRepos([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Map connector name to appKey (e.g., "GitHub" -> "github")
    const appKey = connector.name.toLowerCase();

    getConnectorRepositories({ appKey, page: 1, limit: 100 })
      .then((data) => {
        setRepos(
          data.repositories.map((repo: ConnectorRepository) => ({
            id: repo.id,
            name: repo.name,
            description: repo.description || '',
            url: repo.url,
            isSelected: false,
          }))
        );
      })
      .catch((err) => {
        console.error('Failed to fetch repositories:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch repositories');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, connector]);

  const handleToggleRepo = (repoId: string) => {
    // Single selection: deselect all and select only the clicked one
    setRepos((prev) =>
      prev.map((repo) => ({ ...repo, isSelected: repo.id === repoId ? !repo.isSelected : false }))
    );
  };

  const handleConfirm = () => {
    const selectedRepos = repos.filter((r) => r.isSelected);
    if (selectedRepos.length > 0 && connector && onRepositorySelect) {
      const repo = selectedRepos[0];
      onRepositorySelect({
        connectorId: connector.id,
        connectorName: connector.name,
        repoId: repo.id,
        repoName: repo.name,
        repoUrl: repo.url,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="h-5 w-5" />
            {connector?.name} {t('connectors.repos') || 'Repositories'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-destructive text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => window.location.reload()}>
                {t('common.retry') || 'Retry'}
              </Button>
            </div>
          ) : repos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{t('connectors.noRepos') || 'No repositories found'}</div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-2">
                {repos.map((repo) => (
                  <div
                    key={repo.id}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer hover:bg-accent',
                      repo.isSelected && 'bg-accent border-primary'
                    )}
                    onClick={() => handleToggleRepo(repo.id)}
                  >
                    <div
                      className={cn(
                        'mt-0.5 h-4 w-4 rounded border flex items-center justify-center',
                        repo.isSelected ? 'bg-primary border-primary' : 'border-muted-foreground'
                      )}
                    >
                      {repo.isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{repo.name}</div>
                      {repo.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{repo.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button onClick={handleConfirm} disabled={repos.filter((r) => r.isSelected).length === 0}>
            {t('common.confirm') || 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
