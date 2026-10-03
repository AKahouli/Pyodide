/**
 * DefaultAgentsPage - Default agent management for admin
 */

import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, AlertCircle, RefreshCw, Plus, Pencil, Trash2, Search, Eye } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { showSuccess, showError } from '@/lib/notifications';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getAdminAgents, createAdminAgent, deleteAdminAgent } from '../api';
import { updateDefaultAgent } from '@/modules/agent/api';
import type { AgentResponse, AgentListResponse } from '../types';
import { CreateEditAgentDialog } from '@/modules/agent/components/CreateEditAgentDialog';
import type { UserAgentFormValues } from '@/modules/agent/components/AgentFormSchema';
import { usePermissions } from '../hooks/usePermissions';

export function DefaultAgentsPage() {
  const { t } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const { hasPermission } = usePermissions();
  const canManageDefaultAgents = hasPermission('agents.update');
  const canCreateDefaultAgents = hasPermission('agents.create');
  const canDeleteDefaultAgents = hasPermission('agents.delete');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const [showCreateEditDialog, setShowCreateEditDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentResponse | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<AgentResponse | null>(null);

  const fetchAgents = useCallback(
    async (searchValue?: string, pageValue?: number) => {
      setLoading(true);
      setError(null);

      try {
        const data: AgentListResponse = await getAdminAgents({
          page: pageValue ?? page,
          limit: 10,
          search: searchValue ?? search,
        });
        setAgents(data.data);
        setTotal(data.meta.total);
        setTotalPages(data.meta.totalPages);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('defaultAgents.errors.load'));
      } finally {
        setLoading(false);
      }
    },
    [page, search],
  );

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchAgents(search, 1);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSave = async (data: UserAgentFormValues) => {
    setSaving(true);
    try {
      if (editingAgent) {
        await updateDefaultAgent(editingAgent.id, {
          name: data.name,
          slug: data.slug,
          agentType: data.agentType,
          role: data.role,
          description: data.description,
          temperature: data.temperature,
          model: data.model,
          instruction: data.instruction,
          ignorePrePrompt: data.ignorePrePrompt,
          knowledgeBases: data.knowledgeBases,
          tools: data.tools,
          skills: data.skills,
          disabledSkills: data.disabledSkills,
          connectors: data.connectors,
          connectorActionSelections: data.connectorActionSelections,
          isActive: data.isActive,
          guardrails: data.guardrails,
          deploymentSettings: data.deploymentSettings,
          enable_temporary_child_agents: data.enable_temporary_child_agents,
          max_temporary_child_agents: data.max_temporary_child_agents,
          rootExecutionPolicy: data.rootExecutionPolicy,
          delegateAgentIds: data.delegateAgentIds,
          delegateTeamIds: data.delegateTeamIds,
        });
        showSuccess(t('defaultAgents.toasts.updated.title'), {
          description: t('defaultAgents.toasts.updated.description', { name: data.name }),
        });
      } else {
        await createAdminAgent({
          name: data.name,
          slug: data.slug,
          agentType: data.agentType,
          role: data.role,
          description: data.description,
          temperature: data.temperature,
          model: data.model || undefined,
          instruction: data.instruction,
          ignorePrePrompt: data.ignorePrePrompt,
          knowledgeBases: data.knowledgeBases,
          tools: data.tools,
          skills: data.skills,
          disabledSkills: data.disabledSkills,
          connectors: data.connectors,
          connectorActionSelections: data.connectorActionSelections,
          isActive: data.isActive,
          guardrails: data.guardrails,
          deploymentSettings: data.deploymentSettings,
          enable_temporary_child_agents: data.enable_temporary_child_agents,
          max_temporary_child_agents: data.max_temporary_child_agents,
          rootExecutionPolicy: data.rootExecutionPolicy,
          delegateAgentIds: data.delegateAgentIds,
          delegateTeamIds: data.delegateTeamIds,
        });
        showSuccess(t('defaultAgents.toasts.created.title'), {
          description: t('defaultAgents.toasts.created.description', { name: data.name }),
        });
      }
      setShowCreateEditDialog(false);
      setEditingAgent(null);
      fetchAgents();
    } catch (err) {
      showError(editingAgent ? t('defaultAgents.toasts.errors.update') : t('defaultAgents.toasts.errors.create'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (agent: AgentResponse) => {
    try {
      const updated = await updateDefaultAgent(agent.id, { isActive: !agent.isActive });
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      showSuccess(updated.isActive ? t('defaultAgents.toasts.statusActivated.title') : t('defaultAgents.toasts.statusDeactivated.title'), {
        description: t(updated.isActive ? 'defaultAgents.toasts.statusActivated.description' : 'defaultAgents.toasts.statusDeactivated.description', { name: updated.name }),
      });
    } catch (err) {
      showError(t('defaultAgents.toasts.errors.status'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingAgent) return;
    try {
      await deleteAdminAgent(deletingAgent.id);
      showSuccess(t('defaultAgents.toasts.deleted.title'), {
        description: t('defaultAgents.toasts.deleted.description', { name: deletingAgent.name }),
      });
      setDeletingAgent(null);
      fetchAgents();
    } catch (err) {
      showError(t('defaultAgents.toasts.errors.delete'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const openCreate = () => {
    setEditingAgent(null);
    setShowCreateEditDialog(true);
  };

  const openEdit = (agent: AgentResponse) => {
    setEditingAgent(agent);
    setShowCreateEditDialog(true);
  };

  if (loading && agents.length === 0) {
    return (
      <div className='flex items-center justify-center h-96'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (error && agents.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center h-96 gap-4'>
        <AlertCircle className='h-12 w-12 text-destructive' />
        <p className='text-muted-foreground'>{error}</p>
        <Button onClick={() => fetchAgents()} variant='outline'>
          <RefreshCw className='mr-2 h-4 w-4' />
          {tCommon('actionRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t('defaultAgents.title')}</h1>
          <p className='text-muted-foreground'>{t('defaultAgents.description')}</p>
        </div>
        <div className='flex gap-2'>
          <Button onClick={() => fetchAgents()} variant='outline' size='icon'>
            <RefreshCw className='h-4 w-4' />
          </Button>
          {canCreateDefaultAgents && (
            <Button onClick={openCreate}>
              <Plus className='mr-2 h-4 w-4' />
              {t('defaultAgents.actions.add')}
            </Button>
          )}
        </div>
      </div>

      <div className='relative max-w-sm'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
        <Input placeholder={t('defaultAgents.search.placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} className='pl-9' />
      </div>

      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
              <Bot className='h-5 w-5' />
            </div>
            <div>
              <CardTitle>{t('defaultAgents.card.title')}</CardTitle>
              <CardDescription>{t('defaultAgents.card.description', { count: total })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('defaultAgents.table.columns.name')}</TableHead>
                  <TableHead className='hidden sm:table-cell'>{t('defaultAgents.table.columns.type')}</TableHead>
                  <TableHead className='hidden md:table-cell'>{t('defaultAgents.table.columns.role')}</TableHead>
                  <TableHead className='hidden lg:table-cell'>{t('defaultAgents.table.columns.creativity')}</TableHead>
                  <TableHead className='hidden lg:table-cell'>{t('defaultAgents.table.columns.model')}</TableHead>
                  <TableHead>{t('defaultAgents.table.columns.active')}</TableHead>
                  <TableHead className='text-right'>{t('defaultAgents.table.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className='h-24 text-center'>
                      {search ? t('defaultAgents.table.empty.search') : t('defaultAgents.table.empty.default')}
                    </TableCell>
                  </TableRow>
                ) : (
                  agents.map((agent) => (
                    <TableRow key={agent.id} className={!agent.isActive ? 'opacity-50' : undefined}>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <span className='font-medium'>{agent.name}</span>
                          {agent.isDefaultForType && (
                            <Badge variant='outline' className='text-[10px] px-1 py-0'>
                              {t('defaultAgents.badges.typeDefault')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className='hidden sm:table-cell'>
                        <Badge variant='secondary' className='text-xs'>
                          {agent.agentType?.name || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell className='hidden md:table-cell max-w-[200px] truncate'>{agent.role || <span className='text-muted-foreground'>-</span>}</TableCell>
                      <TableCell className='hidden lg:table-cell'>{agent.temperature.toFixed(1)}</TableCell>
                      <TableCell className='hidden lg:table-cell'>{agent.model || <span className='text-muted-foreground text-sm'>{t('defaultAgents.table.modelFallback')}</span>}</TableCell>
                      <TableCell>
                        <Switch checked={agent.isActive} disabled={!canManageDefaultAgents} onCheckedChange={() => handleToggleActive(agent)} />
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex justify-end gap-1'>
                          <Button variant='ghost' size='icon' onClick={() => openEdit(agent)}>
                            {canManageDefaultAgents ? <Pencil className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                          </Button>
                          {canDeleteDefaultAgents && (
                            <Button variant='ghost' size='icon' onClick={() => setDeletingAgent(agent)}>
                              <Trash2 className='h-4 w-4 text-destructive' />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className='flex items-center justify-between pt-4'>
              <p className='text-sm text-muted-foreground'>{t('defaultAgents.pagination.summary', { page, totalPages })}</p>
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  {t('defaultAgents.pagination.previous')}
                </Button>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  {t('defaultAgents.pagination.next')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateEditAgentDialog
        open={showCreateEditDialog}
        onOpenChange={(open) => {
          setShowCreateEditDialog(open);
          if (!open) setEditingAgent(null);
        }}
        agent={editingAgent}
        onSave={handleSave}
        saving={saving}
        readOnly={!canManageDefaultAgents}
      />

      <AlertDialog
        open={!!deletingAgent}
        onOpenChange={(open) => {
          if (!open) setDeletingAgent(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('defaultAgents.dialog.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('defaultAgents.dialog.delete.description', { name: deletingAgent?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
              {t('defaultAgents.dialog.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
