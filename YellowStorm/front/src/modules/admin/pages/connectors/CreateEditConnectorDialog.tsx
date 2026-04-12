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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ConnectorResponse, ConnectorActionResponse } from '../../types';
import type { ConnectorFormValues } from './connector-form-schema';
import { defaultConnectorFormValues } from './connector-form-schema';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
  const [form, setForm] = useState<ConnectorFormValues>({ ...defaultConnectorFormValues });

  useEffect(() => {
    if (open) {
      if (connector) {
        setForm({
          slug: connector.slug,
          name: connector.name,
          description: connector.description,
          icon: connector.icon || '',
          color: connector.color || '',
          authType: connector.authType || 'none',
          mcpTransportType: connector.mcpTransportType || 'streamable_http',
          mcpServerUrl: connector.mcpServerUrl || '',
          mcpServerConfig: connector.mcpServerConfig ? JSON.stringify(connector.mcpServerConfig, null, 2) : '',
          actionsJson: connector.actions ? JSON.stringify(connector.actions, null, 2) : '',
          referencedSkillIds: (connector.referencedSkillIds || []).join(', '),
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

    onSave({
      ...form,
      actions: form.actionsJson ? JSON.parse(form.actionsJson) : undefined,
      mcpServerConfig: form.mcpServerConfig ? JSON.parse(form.mcpServerConfig) : undefined,
    } as ConnectorFormValues);
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
              <Input placeholder='sharepoint' value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} disabled={!!connector} />
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
            <Label>Referenced Skill IDs (comma-separated)</Label>
            <Input placeholder='skill-id-1, skill-id-2' value={form.referencedSkillIds} onChange={(e) => setForm({ ...form, referencedSkillIds: e.target.value })} />
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
