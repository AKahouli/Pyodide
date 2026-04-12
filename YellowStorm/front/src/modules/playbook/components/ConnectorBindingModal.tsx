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
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Cable, Plug, Loader2 } from 'lucide-react';
import type { ConnectorResponse, ConnectorActionResponse } from '@/modules/admin/types';
import type { ToolBinding, ToolBindingAction } from '../types';
import apiClient from '@/lib/api/client';

interface ConnectorBindingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  connectorId: string;
  connectorName: string;
  existingBinding: ToolBinding | null;
  onSave: (taskId: string, binding: ToolBinding) => void;
}

export function ConnectorBindingModal({
  open,
  onOpenChange,
  taskId,
  connectorId,
  connectorName,
  existingBinding,
  onSave,
}: ConnectorBindingModalProps) {
  const [connector, setConnector] = useState<ConnectorResponse | null>(null);
  const [credentials, setCredentials] = useState<Array<{ id: string; displayName: string; status: string }>>([]);
  const [loading, setLoading] = useState(false);

  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
  const [fixedParams, setFixedParams] = useState('');
  const [disableAutoSkills, setDisableAutoSkills] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    if (existingBinding) {
      setSelectedCredentialId(existingBinding.credentialId ?? null);
      setSelectedActions(new Set(existingBinding.actions?.filter((a) => a.isEnabled !== false).map((a) => a.actionKey) ?? []));
      setFixedParams(existingBinding.fixedParams ? JSON.stringify(existingBinding.fixedParams, null, 2) : '');
      setDisableAutoSkills(existingBinding.disableAutoSkills ?? false);
    } else {
      setSelectedCredentialId(null);
      setSelectedActions(new Set());
      setFixedParams('');
      setDisableAutoSkills(false);
    }
    setInitialized(true);
  }, [open, existingBinding]);

  useEffect(() => {
    if (!open || !connectorId) return;
    let cancelled = false;
    setLoading(true);
    async function fetchData() {
      try {
        const [connRes, credRes] = await Promise.all([
          apiClient.get(`/connectors/${connectorId}`),
          apiClient.get(`/connectors/${connectorId}/credentials`),
        ]);
        if (!cancelled) {
          const conn = connRes.data?.data ?? null;
          setConnector(conn);
          setCredentials(Array.isArray(credRes.data?.data) ? credRes.data.data : []);
          if (!existingBinding && conn?.actions?.length) {
            const enabledKeys = conn.actions
              .filter((a: any) => a.isEnabled !== false)
              .map((a: any) => a.key);
            setSelectedActions(new Set(enabledKeys));
          }
        }
      } catch (err) {
        console.error('Failed to fetch connector data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [open, connectorId, existingBinding]);

  const toggleAction = (key: string) => {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = () => {
    const bindingId = existingBinding?.id ?? `tb_${Date.now()}`;
    const actions: ToolBindingAction[] = connector?.actions
      .filter((a) => selectedActions.has(a.key))
      .map((a) => ({ actionKey: a.key, isEnabled: true })) ?? [];

    let parsedFixedParams: Record<string, unknown> = {};
    if (fixedParams.trim()) {
      try {
        parsedFixedParams = JSON.parse(fixedParams);
      } catch {
        return;
      }
    }

    const binding: ToolBinding = {
      id: bindingId,
      connectorId,
      connectorName: connectorName || existingBinding?.connectorName,
      actions,
      credentialId: selectedCredentialId,
      fixedParams: parsedFixedParams,
      disableAutoSkills,
      isEnabled: true,
    };

    onSave(taskId, binding);
    onOpenChange(false);
  };

  const enabledActions = connector?.actions.filter((a) => a.isEnabled) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Cable className='h-5 w-5' />
            Configure {connector?.name ?? 'Connector'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
          </div>
        ) : connector ? (
          <div className='space-y-4'>
            <div>
              <Label className='text-sm font-medium'>Credential</Label>
              <div className='mt-1.5 space-y-1.5'>
                <label className='flex items-center gap-2 text-sm'>
                  <input
                    type='radio'
                    name='credential'
                    checked={selectedCredentialId === null || selectedCredentialId === ''}
                    onChange={() => setSelectedCredentialId(null)}
                  />
                  <span>None (use server defaults)</span>
                </label>
                {(Array.isArray(credentials) ? credentials : []).map((cred) => (
                  <label key={cred.id} className='flex items-center gap-2 text-sm'>
                    <input
                      type='radio'
                      name='credential'
                      checked={selectedCredentialId === cred.id}
                      onChange={() => setSelectedCredentialId(cred.id)}
                    />
                    <span>{cred.displayName}</span>
                    <Badge variant='outline' className='text-[10px]'>{cred.status}</Badge>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className='text-sm font-medium'>Actions</Label>
              <div className='mt-1.5 space-y-1'>
                {enabledActions.length === 0 ? (
                  <p className='text-xs text-muted-foreground'>No enabled actions for this connector</p>
                ) : (
                  enabledActions.map((action) => (
                    <label key={action.key} className='flex items-center gap-2 text-sm'>
                      <input
                        type='checkbox'
                        checked={selectedActions.has(action.key)}
                        onChange={() => toggleAction(action.key)}
                      />
                      <span>{action.label}</span>
                      <Badge variant='outline' className='text-[10px]'>{action.safety}</Badge>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <Label className='text-sm font-medium'>Fixed Parameters (JSON)</Label>
              <p className='text-xs text-muted-foreground'>Parameters the AI cannot override at runtime</p>
              <textarea
                className='mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y'
                rows={3}
                placeholder='{"folder": "/contracts", "file_filter": ".docx"}'
                value={fixedParams}
                onChange={(e) => setFixedParams(e.target.value)}
              />
            </div>

            <div className='flex items-center gap-2'>
              <Switch checked={disableAutoSkills} onCheckedChange={setDisableAutoSkills} />
              <Label className='text-sm'>Disable auto-attached skills</Label>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={selectedActions.size === 0}>Save Binding</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
