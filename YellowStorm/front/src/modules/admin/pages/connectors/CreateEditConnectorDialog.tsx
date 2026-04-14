import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ConnectorResponse, ConnectorActionResponse, SkillResponse } from '../../types';
import type { ConnectorFormValues } from './connector-form-schema';
import { defaultConnectorFormValues } from './connector-form-schema';
import { Loader2, TestTube2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSkills, inspectMcp } from '../../api';
import { useModuleTranslation } from '@/modules/localization';

const AUTH_SOURCE_TYPES = [
  { value: 'credential', label: 'Credential' },
  { value: 'connected_app', label: 'Connected App' },
  { value: 'none', label: 'None' },
];

const TRANSPORT_TYPES = [
  { value: 'streamable_http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE (Server-Sent Events)' },
  { value: 'stdio', label: 'Stdio (local command)' },
];

export function CreateEditConnectorDialog({
  open,
  onOpenChange,
  connector,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector: ConnectorResponse | null;
  onSave: (data: ConnectorFormValues) => void;
}) {
  const { t } = useModuleTranslation('admin');
  const [form, setForm] = useState<ConnectorFormValues>({ ...defaultConnectorFormValues });
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectTools, setInspectTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillResponse[]>([]);

  useEffect(() => {
    if (open) {
      setInspectError(null);
      setInspectTools([]);
      getSkills({ isActive: true, limit: 1000 })
        .then((result) => setAvailableSkills(result.data || []))
        .catch(() => setAvailableSkills([]));
      if (connector) {
        setForm({
          slug: connector.slug,
          name: connector.name,
          description: connector.description,
          icon: connector.icon || '',
          color: connector.color || '',
          authType: connector.authType || 'none',
          authSourceType: connector.authSourceType || 'credential',
          connectedAppKey: connector.connectedAppKey || '',
          runtimeAuthConfig: connector.runtimeAuthConfig
            ? JSON.stringify(connector.runtimeAuthConfig, null, 2)
            : '',
          mcpTransportType: connector.mcpTransportType || 'streamable_http',
          mcpServerUrl: connector.mcpServerUrl || '',
          mcpServerConfig: connector.mcpServerConfig ? JSON.stringify(connector.mcpServerConfig, null, 2) : '',
          actionsJson: connector.actions ? JSON.stringify(connector.actions, null, 2) : '',
          referencedSkillIds: connector.referencedSkillIds || [],
          isActive: connector.isActive,
        });
      } else {
        setForm({ ...defaultConnectorFormValues });
      }
    }
  }, [open, connector]);

  const handleSubmit = () => {
    if (!form.slug.trim() || !form.name.trim()) {
      toast.error('Slug and name are required');
      return;
    }

    if (!form.mcpServerUrl.trim()) {
      toast.error('MCP Server URL or command is required');
      return;
    }

    let actions: ConnectorActionResponse[] | undefined;
    if (form.actionsJson.trim()) {
      try {
        actions = JSON.parse(form.actionsJson);
        if (!Array.isArray(actions)) throw new Error('Must be an array');
      } catch {
        toast.error('Invalid actions JSON');
        return;
      }
    }

    let mcpServerConfig: Record<string, unknown> | undefined;
    if (form.mcpServerConfig.trim()) {
      try {
        mcpServerConfig = JSON.parse(form.mcpServerConfig);
      } catch {
        toast.error('Invalid MCP server config JSON');
        return;
      }
    }

    let runtimeAuthConfig: Record<string, unknown> | undefined;
    if (form.runtimeAuthConfig.trim()) {
      try {
        runtimeAuthConfig = JSON.parse(form.runtimeAuthConfig);
      } catch {
        toast.error('Invalid runtime auth config JSON');
        return;
      }
    }

    onSave({
      ...form,
    });
  };

  const handleInspect = async () => {
    if (!form.mcpServerUrl.trim()) {
      toast.error('MCP Server URL or command is required');
      return;
    }

    let mcpServerConfig: Record<string, unknown> | undefined;
    if (form.mcpServerConfig.trim()) {
      try {
        mcpServerConfig = JSON.parse(form.mcpServerConfig);
      } catch {
        toast.error('Invalid MCP server config JSON');
        return;
      }
    }

    setInspecting(true);
    setInspectError(null);
    setInspectTools([]);
    try {
      const result = await inspectMcp(form.mcpTransportType, form.mcpServerUrl, mcpServerConfig);
      if (result.error) {
        setInspectError(result.error);
        return;
      }
      setInspectTools(result.tools ?? []);
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : 'Inspection failed');
    } finally {
      setInspecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{connector ? 'Edit Connector' : 'Add Connector'}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label>Slug</Label>
              <Input placeholder='sharepoint' value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </div>
            <div>
              <Label>Name</Label>
              <Input placeholder='SharePoint' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea placeholder='Microsoft SharePoint Online connector' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>

          <div className='grid grid-cols-3 gap-4'>
            <div>
              <Label>Icon</Label>
              <Input placeholder='Cable' value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
            </div>
            <div>
              <Label>Color</Label>
              <Input placeholder='#0078d4' value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            <div>
              <Label>Auth Type</Label>
              <Input value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value })} />
            </div>
          </div>

          <div className='grid grid-cols-3 gap-4'>
            <div>
              <Label>Auth Source Type</Label>
              <Select value={form.authSourceType} onValueChange={(value) => setForm({ ...form, authSourceType: value })}>
                <SelectTrigger>
                  <SelectValue placeholder='Select auth source' />
                </SelectTrigger>
                <SelectContent>
                  {AUTH_SOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Connected App Key</Label>
              <Input
                placeholder='microsoft'
                value={form.connectedAppKey}
                onChange={(e) => setForm({ ...form, connectedAppKey: e.target.value })}
                disabled={form.authSourceType !== 'connected_app'}
              />
            </div>
            <div>
              <Label>Runtime Auth Config (JSON)</Label>
              <Textarea
                placeholder='{"strategy": "http_header_bearer"}'
                value={form.runtimeAuthConfig}
                onChange={(e) => setForm({ ...form, runtimeAuthConfig: e.target.value })}
                disabled={form.authSourceType === 'none'}
                rows={3}
                className='font-mono text-xs'
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label>Transport Type</Label>
              <Select value={form.mcpTransportType} onValueChange={(value) => setForm({ ...form, mcpTransportType: value })}>
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
              <Label>{form.mcpTransportType === 'stdio' ? 'Command' : 'MCP Server URL'}</Label>
              <Input
                placeholder={
                  form.mcpTransportType === 'stdio'
                    ? 'npx @anthropic/mcp-server-sharepoint'
                    : 'https://mcp.example.com/mcp'
                }
                value={form.mcpServerUrl}
                onChange={(e) => setForm({ ...form, mcpServerUrl: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label>MCP Server Config (JSON)</Label>
            <Textarea placeholder='{"commandArgs": ["--stdio"]}' value={form.mcpServerConfig} onChange={(e) => setForm({ ...form, mcpServerConfig: e.target.value })} rows={3} className='font-mono text-xs' />
          </div>

          <div className='flex items-center justify-between gap-3'>
            <div className='text-sm text-muted-foreground'>Inspect the configured MCP server and preview the available tools.</div>
            <Button type='button' variant='outline' onClick={handleInspect} disabled={inspecting}>
              {inspecting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <TestTube2 className='mr-2 h-4 w-4' />}
              Test MCP
            </Button>
          </div>

          {(inspectError || inspectTools.length > 0) && (
            <div className='rounded-md border p-3 space-y-2'>
              {inspectError ? (
                <p className='text-sm text-destructive'>{inspectError}</p>
              ) : (
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>Available tools</p>
                  <div className='space-y-1'>
                    {inspectTools.map((tool) => (
                      <div key={tool.name} className='rounded border px-2 py-1 text-xs'>
                        <div className='font-medium'>{tool.name}</div>
                        {tool.description ? <div className='text-muted-foreground'>{tool.description}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Actions (JSON array)</Label>
            <Textarea
              placeholder='[{"key": "list_files", "label": "List Files", "safety": "read"}]'
              value={form.actionsJson}
              onChange={(e) => setForm({ ...form, actionsJson: e.target.value })}
              rows={6}
              className='font-mono text-xs'
            />
          </div>

          <div>
            <Label>{t('connectors.form.referencedSkills.label')}</Label>
            <MultiSelect
              options={availableSkills.map((skill) => ({
                value: skill.id,
                label: skill.name,
                description: skill.description,
              }))}
              value={form.referencedSkillIds}
              onValueChange={(value) => setForm({ ...form, referencedSkillIds: value })}
              placeholder={t('connectors.form.referencedSkills.selectPlaceholder')}
              searchPlaceholder={t('connectors.form.referencedSkills.searchPlaceholder')}
              emptyText={t('connectors.form.referencedSkills.emptyText')}
            />
          </div>

          <div className='flex items-center gap-2'>
            <Switch checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>{connector ? 'Update' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
