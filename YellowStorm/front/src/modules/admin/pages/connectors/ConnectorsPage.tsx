import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Cable, FolderTree, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getConnectors, createConnector, updateConnector, deleteConnector, inspectMcp, importFromMcp, getConnectorCategories } from '../../api';
import type { ConnectorResponse, ConnectorCategoryResponse, McpToolDefinition, McpInspectResult, ConnectorActionResponse } from '../../types';
import { CreateEditConnectorDialog } from './CreateEditConnectorDialog';
import { ManageCategoriesDialog } from './ManageCategoriesDialog';
import { IconDisplay } from './IconDisplay';
import type { ConnectorFormValues } from './connector-form-schema';

const TRANSPORT_TYPES = [
  { value: 'streamable_http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE (Server-Sent Events)' },
  { value: 'stdio', label: 'Stdio (local command)' },
];

const CARDS_PER_CATEGORY = 6;
const UNCATEGORIZED_KEY = '__uncategorized__';

export function ConnectorsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<ConnectorResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<ConnectorCategoryResponse[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingConnector, setEditingConnector] = useState<ConnectorResponse | null>(null);
  const [deletingConnector, setDeletingConnector] = useState<ConnectorResponse | null>(null);

  const [showMcpDialog, setShowMcpDialog] = useState(false);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);
  const [mcpTransportType, setMcpTransportType] = useState('streamable_http');
  const [mcpServerUrl, setMcpServerUrl] = useState('');
  const [mcpInspecting, setMcpInspecting] = useState(false);
  const [mcpTools, setMcpTools] = useState<McpToolDefinition[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpImporting, setMcpImporting] = useState(false);

  const fetchConnectors = useCallback(async (searchValue?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getConnectors({ page: 1, limit: 1000, search: searchValue ?? search });
      setConnectors(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connectors.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await getConnectorCategories();
      setCategories(data);
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    void fetchConnectors();
    void fetchCategories();
  }, [fetchConnectors, fetchCategories]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchConnectors(search); }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchConnectors]);

  const toggleCategoryExpanded = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groupedConnectors = (() => {
    const byCategory = new Map<string, ConnectorResponse[]>();
    for (const conn of connectors) {
      const key = conn.categoryId || UNCATEGORIZED_KEY;
      const list = byCategory.get(key) ?? [];
      list.push(conn);
      byCategory.set(key, list);
    }

    const groups: Array<{ key: string; name: string; description: string; items: ConnectorResponse[] }> = [];
    for (const cat of categories) {
      const items = byCategory.get(cat.id);
      if (items && items.length > 0) {
        groups.push({ key: cat.id, name: cat.name, description: cat.description, items });
      }
    }
    const uncategorized = byCategory.get(UNCATEGORIZED_KEY);
    if (uncategorized && uncategorized.length > 0) {
      groups.push({ key: UNCATEGORIZED_KEY, name: 'Uncategorized', description: '', items: uncategorized });
    }
    return groups;
  })();

  const handleSave = async (data: ConnectorFormValues) => {
    try {
      let parsedActions: ConnectorActionResponse[] | undefined;
      if (data.actions && data.actions.length > 0) {
        parsedActions = data.actions;
      } else if (data.actionsJson.trim()) {
        parsedActions = JSON.parse(data.actionsJson);
      }
      const payload = {
        slug: data.slug,
        name: data.name,
        description: data.description,
        icon: data.icon || undefined,
        color: data.color || undefined,
        iconColor: data.iconColor || undefined,
        categoryId: data.categoryId ? data.categoryId : null,
        authType: data.authSourceType === 'connected_app' ? 'oauth2' : data.authSourceType === 'credential' ? 'token' : 'none',
        authSourceType: data.authSourceType || undefined,
        connectedAppKey: data.authSourceType === 'connected_app' ? (data.connectedAppKey || undefined) : undefined,
        runtimeAuthConfig: typeof data.runtimeAuthConfig === 'string' ? (data.runtimeAuthConfig.trim() ? JSON.parse(data.runtimeAuthConfig) : undefined) : undefined,
        mcpTransportType: data.mcpTransportType || undefined,
        mcpServerUrl: data.mcpServerUrl || undefined,
        mcpServerConfig: typeof data.mcpServerConfig === 'string' ? (data.mcpServerConfig.trim() ? JSON.parse(data.mcpServerConfig) : undefined) : (data.mcpServerConfig || undefined),
        dynamicHeaders: data.dynamicHeaders
          .map((row) => ({
            headerName: row.headerName.trim(),
            source: row.source,
            enabled: row.enabled,
          }))
          .filter((row) => row.headerName.length > 0),
        actions: parsedActions,
        referencedSkillIds: data.referencedSkillIds.length > 0 ? data.referencedSkillIds : undefined,
        isActive: data.isActive,
      };
      if (editingConnector) {
        await updateConnector(editingConnector.id, payload);
        toast.success('Connector updated', { description: `${data.name} was updated.` });
      } else {
        await createConnector(payload);
        toast.success('Connector created', { description: `${data.name} was created.` });
      }
      setShowDialog(false);
      setEditingConnector(null);
      fetchConnectors();
    } catch (err) {
      toast.error(editingConnector ? 'Failed to update connector' : 'Failed to create connector', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingConnector) return;
    try {
      await deleteConnector(deletingConnector.id);
      toast.success('Connector deleted', { description: `${deletingConnector.name} was deleted.` });
      setDeletingConnector(null);
      fetchConnectors();
    } catch (err) {
      toast.error('Failed to delete connector', { description: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  const handleInspectMcp = async () => {
    if (!mcpServerUrl.trim()) return;
    setMcpInspecting(true);
    setMcpError(null);
    setMcpTools([]);
    try {
      const result = await inspectMcp(mcpTransportType, mcpServerUrl);
      if (result.error) {
        setMcpError(result.error);
      } else {
        setMcpTools(result.tools);
      }
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : 'Inspection failed');
    } finally {
      setMcpInspecting(false);
    }
  };

  const handleImportMcp = async () => {
    if (!mcpServerUrl.trim()) return;
    setMcpImporting(true);
    try {
      const result = await importFromMcp(mcpTransportType, mcpServerUrl);
      if (result.error) {
        toast.error('Import failed', { description: result.error });
      } else {
        toast.success('Connector imported', { description: `${result.tools.length} tools discovered from ${mcpServerUrl}.` });
        setShowMcpDialog(false);
        setMcpTools([]);
        setMcpServerUrl('');
        fetchConnectors();
      }
    } catch (err) {
      toast.error('Import failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setMcpImporting(false);
    }
  };

  if (loading && connectors.length === 0) {
    return <div className='flex items-center justify-center h-96'><Loader2 className='h-8 w-8 animate-spin text-muted-foreground' /></div>;
  }
  if (error && connectors.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center h-96 gap-4'>
        <AlertCircle className='h-12 w-12 text-destructive' />
        <p className='text-muted-foreground'>{error}</p>
        <Button onClick={() => fetchConnectors()} variant='outline'><RefreshCw className='mr-2 h-4 w-4' />Retry</Button>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Connectors</h1>
          <p className='text-muted-foreground'>Manage MCP connector catalog and inspect tool definitions.</p>
        </div>
        <div className='flex gap-2'>
          <Button onClick={() => fetchConnectors()} variant='outline' size='icon'><RefreshCw className='h-4 w-4' /></Button>
          <Button variant='outline' onClick={() => setShowCategoriesDialog(true)}><FolderTree className='mr-2 h-4 w-4' />Manage Categories</Button>
          <Button variant='outline' onClick={() => { setMcpTransportType('streamable_http'); setMcpServerUrl(''); setMcpTools([]); setMcpError(null); setShowMcpDialog(true); }}><Zap className='mr-2 h-4 w-4' />Inspect MCP</Button>
          <Button onClick={() => { setEditingConnector(null); setShowDialog(true); }}><Plus className='mr-2 h-4 w-4' />Add Connector</Button>
        </div>
      </div>

      <div className='relative max-w-sm'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
        <Input placeholder='Search connectors' value={search} onChange={(e) => setSearch(e.target.value)} className='pl-9' />
      </div>

      <div className='flex items-center gap-3'>
        <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'><Cable className='h-5 w-5' /></div>
        <div>
          <h2 className='font-semibold'>Connector Catalog</h2>
          <p className='text-sm text-muted-foreground'>{total} connectors available</p>
        </div>
      </div>

      {connectors.length === 0 ? (
        <div className='flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground'>
          {search ? 'No connectors match your search.' : 'No connectors yet.'}
        </div>
      ) : (
        <div className='space-y-8'>
          {groupedConnectors.map((group) => {
            const isExpanded = expandedCategories.has(group.key);
            const visible = isExpanded ? group.items : group.items.slice(0, CARDS_PER_CATEGORY);
            const hasMore = group.items.length > CARDS_PER_CATEGORY;
            return (
              <section key={group.key} className='space-y-3'>
                <div>
                  <h3 className='text-lg font-semibold'>{group.name}</h3>
                  {group.description && (
                    <p className='text-sm text-muted-foreground'>{group.description}</p>
                  )}
                </div>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
                  {visible.map((conn) => {
                    const iconTextColor = conn.iconColor === 'dark' ? 'text-black' : 'text-white';
                    const initial = conn.name?.trim().charAt(0).toUpperCase() || '?';
                    return (
                      <div
                        key={conn.id}
                        role='button'
                        tabIndex={0}
                        onClick={() => { setEditingConnector(conn); setShowDialog(true); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditingConnector(conn);
                            setShowDialog(true);
                          }
                        }}
                        className={`group relative rounded-lg border bg-card p-4 cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring ${!conn.isActive ? 'opacity-60' : ''}`}
                      >
                        <button
                          type='button'
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const updated = await updateConnector(conn.id, { isActive: !conn.isActive });
                              setConnectors((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
                            } catch (err) {
                              toast.error('Failed to update connector status', { description: err instanceof Error ? err.message : 'Unknown error' });
                            }
                          }}
                          className='absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          aria-label={conn.isActive ? 'Deactivate connector' : 'Activate connector'}
                          aria-pressed={conn.isActive}
                          title={conn.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                        >
                          <span className={`h-2.5 w-2.5 rounded-full transition-colors ${conn.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                        </button>

                        <div className='absolute top-2 right-9 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-7 w-7'
                            onClick={(e) => { e.stopPropagation(); setEditingConnector(conn); setShowDialog(true); }}
                            aria-label='Edit connector'
                          >
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-7 w-7 text-destructive'
                            onClick={(e) => { e.stopPropagation(); setDeletingConnector(conn); }}
                            aria-label='Delete connector'
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </Button>
                        </div>

                        <div className='flex items-start gap-3 pr-12'>
                          <div
                            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-md'
                            style={{ backgroundColor: conn.color || 'transparent' }}
                          >
                            {conn.icon ? (
                              <IconDisplay icon={conn.icon} size={22} iconColor={conn.iconColor} />
                            ) : (
                              <span className={`text-sm font-bold ${iconTextColor}`}>{initial}</span>
                            )}
                          </div>
                          <div className='min-w-0 flex-1'>
                            <div className='font-semibold truncate'>{conn.name}</div>
                            <p className='text-sm text-muted-foreground line-clamp-2'>{conn.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasMore && (
                  <div className='flex justify-end'>
                    <Button variant='outline' size='sm' onClick={() => toggleCategoryExpanded(group.key)}>
                      {isExpanded ? 'Show less' : `View all (${group.items.length})`}
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <CreateEditConnectorDialog open={showDialog} onOpenChange={setShowDialog} connector={editingConnector} onSave={handleSave} />

      <ManageCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        onCategoriesChanged={() => { void fetchCategories(); void fetchConnectors(); }}
      />

      <AlertDialog open={!!deletingConnector} onOpenChange={() => setDeletingConnector(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete connector</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete <strong>{deletingConnector?.name}</strong>? This will not affect existing playbook bindings.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-destructive text-destructive-foreground'>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showMcpDialog} onOpenChange={setShowMcpDialog}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader><DialogTitle>Inspect MCP Server</DialogTitle></DialogHeader>
          <div className='space-y-4'>
            <div>
              <Label>Transport Type</Label>
              <Select value={mcpTransportType} onValueChange={setMcpTransportType}>
                <SelectTrigger>
                  <SelectValue placeholder='Select transport type' />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{mcpTransportType === 'stdio' ? 'Command' : 'Server URL'}</Label>
              <Input
                placeholder={
                  mcpTransportType === 'stdio'
                    ? 'npx @anthropic/mcp-server-sharepoint'
                    : 'https://mcp.example.com/mcp'
                }
                value={mcpServerUrl}
                onChange={(e) => setMcpServerUrl(e.target.value)}
              />
              <p className='text-xs text-muted-foreground mt-1'>
                {mcpTransportType === 'stdio'
                  ? 'Enter the command to spawn the MCP server process'
                  : 'Enter the HTTP/SSE URL of the MCP server'}
              </p>
            </div>
            <div className='flex gap-2'>
              <Button onClick={handleInspectMcp} disabled={!mcpServerUrl.trim() || mcpInspecting}>
                {mcpInspecting ? <Loader2 className='h-4 w-4 animate-spin mr-2' /> : <Zap className='h-4 w-4 mr-2' />}
                Inspect
              </Button>
              <Button onClick={handleImportMcp} disabled={mcpTools.length === 0 || mcpImporting}>
                {mcpImporting ? <Loader2 className='h-4 w-4 animate-spin mr-2' /> : null}
                Import {mcpTools.length > 0 ? `(${mcpTools.length} tools)` : ''}
              </Button>
            </div>

            {mcpError && (
              <div className='rounded-md border border-destructive bg-destructive/10 p-3'>
                <p className='text-sm text-destructive'>{mcpError}</p>
              </div>
            )}

            {mcpTools.length > 0 && (
              <div className='rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tool Name</TableHead>
                      <TableHead className='hidden sm:table-cell'>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mcpTools.map((tool, idx) => (
                      <TableRow key={idx}>
                        <TableCell className='font-mono text-sm'>{tool.name}</TableCell>
                        <TableCell className='hidden sm:table-cell max-w-[400px] truncate text-sm text-muted-foreground'>{tool.description || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
