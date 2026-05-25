import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe2, Loader2, Plus, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

import { useWorkspaceStore } from '../store';
import type { ClassifierRuleScope } from '../types';
import { RuleRow } from './RuleRow';

const MAX_RULE_LENGTH = 1000;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  globalOnly?: boolean;
};

export function RulesDialog({ open, onOpenChange, globalOnly = false }: Props) {
  const workspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const workspaceName = useWorkspaceStore((s) => s.selectedWorkspace?.name);
  const globalRules = useWorkspaceStore((s) => s.globalRules);
  const localRules = useWorkspaceStore((s) => s.localRules);
  const localRulesLoadedFor = useWorkspaceStore((s) => s.localRulesLoadedFor);
  const isLoadingRules = useWorkspaceStore((s) => s.isLoadingRules);
  const isSavingRule = useWorkspaceStore((s) => s.isSavingRule);
  const fetchRules = useWorkspaceStore((s) => s.fetchRules);
  const createRule = useWorkspaceStore((s) => s.createRule);
  const updateRule = useWorkspaceStore((s) => s.updateRule);
  const deleteRule = useWorkspaceStore((s) => s.deleteRule);

  const [scope, setScope] = useState<ClassifierRuleScope>('global');
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setComposerOpen(false);
      setDraft('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (globalOnly && scope !== 'global') {
      setScope('global');
    }
  }, [open, globalOnly, scope]);

  useEffect(() => {
    if (!open) return;
    if (scope === 'global') {
      void fetchRules('global');
    } else if (workspaceId && workspaceId !== localRulesLoadedFor) {
      void fetchRules('local');
    }
  }, [open, scope, workspaceId, localRulesLoadedFor, fetchRules]);

  const visibleRules = useMemo(
    () => (scope === 'global' ? globalRules : localRules),
    [scope, globalRules, localRules],
  );

  const handleCreate = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    const created = await createRule({ scope, text, enabled: true });
    if (created) {
      setDraft('');
      setComposerOpen(false);
    }
  }, [createRule, draft, scope]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary'>
              <Shield className='h-5 w-5' />
            </div>
            <div>
              <DialogTitle>Règles de classification</DialogTitle>
              <DialogDescription>
                Définissez des consignes en langage naturel que le playbook prend en compte lors de la classification.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {globalOnly ? (
          <ScopeHelp scope='global' />
        ) : (
          <Tabs value={scope} onValueChange={(v) => setScope(v as ClassifierRuleScope)} className='w-full'>
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='global'>
                <Globe2 className='h-3.5 w-3.5' />
                Global
              </TabsTrigger>
              <TabsTrigger value='local' disabled={!workspaceId}>
                <Shield className='h-3.5 w-3.5' />
                Local{workspaceName ? ` — ${workspaceName}` : ''}
              </TabsTrigger>
            </TabsList>

            <TabsContent value='global' className='mt-3'>
              <ScopeHelp scope='global' />
            </TabsContent>
            <TabsContent value='local' className='mt-3'>
              <ScopeHelp scope='local' />
            </TabsContent>
          </Tabs>
        )}

        <div className='flex items-center justify-between'>
          <p className='text-xs text-muted-foreground'>
            {visibleRules.length} règle{visibleRules.length > 1 ? 's' : ''}
            {' · '}
            {visibleRules.filter((r) => r.enabled).length} active{visibleRules.filter((r) => r.enabled).length > 1 ? 's' : ''}
          </p>
          {!composerOpen && (
            <Button size='sm' variant='outline' onClick={() => setComposerOpen(true)} className='gap-1.5'>
              <Plus className='h-4 w-4' />
              Nouvelle règle
            </Button>
          )}
        </div>

        {composerOpen && (
          <div className='space-y-2 rounded-md border bg-muted/30 p-3'>
            <Textarea
              autoFocus
              rows={3}
              value={draft}
              maxLength={MAX_RULE_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                scope === 'global'
                  ? 'Ex: Ignore les fichiers de type .tmp'
                  : 'Ex: Ne déplace jamais les fichiers du dossier Contrats'
              }
            />
            <div className='flex items-center justify-between gap-2'>
              <span className='text-[11px] text-muted-foreground tabular-nums'>
                {draft.length}/{MAX_RULE_LENGTH}
              </span>
              <div className='flex items-center gap-2'>
                <Button variant='ghost' size='sm' onClick={() => { setComposerOpen(false); setDraft(''); }} disabled={isSavingRule}>
                  Annuler
                </Button>
                <Button size='sm' onClick={handleCreate} disabled={!draft.trim() || isSavingRule} className='gap-1.5'>
                  {isSavingRule ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />}
                  Ajouter
                </Button>
              </div>
            </div>
          </div>
        )}

        <ScrollArea className='max-h-[320px]'>
          {isLoadingRules && visibleRules.length === 0 ? (
            <div className='flex items-center justify-center py-12 text-sm text-muted-foreground'>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              Chargement…
            </div>
          ) : visibleRules.length === 0 ? (
            <EmptyState scope={scope} canCreate={scope === 'global' || !!workspaceId} />
          ) : (
            <div className='space-y-2'>
              {visibleRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onToggle={(enabled) => updateRule(rule.id, { enabled })}
                  onDelete={() => deleteRule(rule.id)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeHelp({ scope }: { scope: ClassifierRuleScope }) {
  return (
    <p className='text-xs text-muted-foreground leading-relaxed'>
      {scope === 'global'
        ? 'Les règles globales s’appliquent à tous vos workspaces lors de la classification.'
        : 'Les règles locales ne s’appliquent qu’au workspace sélectionné. Les règles globales actives sont également prises en compte.'}
    </p>
  );
}

function EmptyState({ scope, canCreate }: { scope: ClassifierRuleScope; canCreate: boolean }) {
  if (scope === 'local' && !canCreate) {
    return (
      <div className='flex flex-col items-center justify-center py-12 text-center'>
        <Shield className='h-8 w-8 text-muted-foreground' />
        <p className='mt-2 text-sm font-medium'>Aucun workspace sélectionné</p>
        <p className='mt-1 text-xs text-muted-foreground'>Sélectionnez un workspace pour gérer ses règles locales.</p>
      </div>
    );
  }
  return (
    <div className='flex flex-col items-center justify-center py-12 text-center'>
      <Shield className='h-8 w-8 text-muted-foreground' />
      <p className='mt-2 text-sm font-medium'>Aucune règle {scope === 'global' ? 'globale' : 'locale'}</p>
      <p className='mt-1 max-w-xs text-xs text-muted-foreground'>
        Ajoutez une consigne en langage naturel pour orienter le classement automatique du playbook.
      </p>
    </div>
  );
}
