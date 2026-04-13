import { useState, useEffect, useMemo, useCallback, type KeyboardEvent } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { Loader2, X, Plus, Trash2 } from 'lucide-react';
import { useAgents, useAgentStore } from '@/modules/agent/store';
import { useAuth } from '@/modules/auth';
import { usePlaybookStore } from '../store';
import type { PlaybookTask, ValidatedTaskReplay, TaskInputPort, TaskOutputPort, ArtifactKind } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { PORT_COLORS } from '../utils/port-colors';
import { getPortColor } from '../utils/port-colors';

interface Props {
  playbookId: string | null;
  task: PlaybookTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (taskId: string, data: Partial<PlaybookTask>) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PlaybookNodeEditor({ playbookId, task, open, onOpenChange, onSave }: Props) {
  const agents = useAgents();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const activateTaskReplay = usePlaybookStore((s) => s.activateTaskReplay);
  const updateTaskReplayFormatGuide = usePlaybookStore((s) => s.updateTaskReplayFormatGuide);
  const { user } = useAuth();
  const { t } = useModuleTranslation('playbook');

  useEffect(() => {
    if (open) fetchAgents();
  }, [open, fetchAgents]);

  const agentOptions = useMemo<SearchableSelectOption[]>(
    () => agents.map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(null);
  const [interruptBefore, setInterruptBefore] = useState(false);
  const [interruptAfter, setInterruptAfter] = useState(false);
  const [allowClarification, setAllowClarification] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [notifyOnComplete, setNotifyOnComplete] = useState(false);
  const [notifyEmails, setNotifyEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');
  const [replays, setReplays] = useState<ValidatedTaskReplay[]>([]);
  const [replaysLoading, setReplaysLoading] = useState(false);
  const [activatingReplayId, setActivatingReplayId] = useState<string | null>(null);
  const [editingReplay, setEditingReplay] = useState<ValidatedTaskReplay | null>(null);
  const [formatGuideDraft, setFormatGuideDraft] = useState('');
  const [preserveFormatDraft, setPreserveFormatDraft] = useState(false);
  const [savingFormatGuide, setSavingFormatGuide] = useState(false);
  const [hasInitializedDraft, setHasInitializedDraft] = useState(false);
  const [inputPorts, setInputPorts] = useState<TaskInputPort[]>([]);
  const [outputPorts, setOutputPorts] = useState<TaskOutputPort[]>([]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setAssignedAgentId(task.assignedAgentId);
      setInterruptBefore(task.interruptBefore);
      setInterruptAfter(task.interruptAfter);
      setAllowClarification(task.allowClarification);
      setEnabled(task.enabled !== false);
      setNotifyOnComplete(task.notifyOnComplete ?? false);
      setNotifyEmails(task.notifyEmails ?? []);
      setEmailInput('');
      setEmailError('');
      setHasInitializedDraft(false);
      setInputPorts(task.inputPorts?.map((p) => ({ ...p })) ?? [{ id: 'default', name: 'Input', artifactKind: 'text' as ArtifactKind, required: false }]);
      setOutputPorts(task.outputPorts?.map((p) => ({ ...p })) ?? [{ id: 'default', name: 'Output', artifactKind: 'text' as ArtifactKind }]);
    }
  }, [task]);

  useEffect(() => {
    if (!open || !task || !hasInitializedDraft) return;
    const timeoutId = window.setTimeout(() => {
      onSave(task.id, {
        title,
        description,
        assignedAgentId,
        interruptBefore,
        interruptAfter,
        allowClarification,
        enabled,
        notifyOnComplete,
        notifyEmails: notifyOnComplete ? notifyEmails : [],
        inputPorts: [...inputPorts],
        outputPorts: [...outputPorts],
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [
    allowClarification,
    assignedAgentId,
    description,
    enabled,
    hasInitializedDraft,
    inputPorts,
    interruptAfter,
    interruptBefore,
    notifyEmails,
    notifyOnComplete,
    onSave,
    open,
    outputPorts,
    task,
    title,
  ]);

  useEffect(() => {
    if (!open || !task) return;
    const timeoutId = window.setTimeout(() => {
      setHasInitializedDraft(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [open, task]);

  useEffect(() => {
    let cancelled = false;

    const loadReplays = async () => {
      if (!open || !task || !playbookId) return;
      setReplaysLoading(true);
      try {
        const result = await fetchTaskReplays(playbookId, task.id);
        if (!cancelled) setReplays(result);
      } finally {
        if (!cancelled) setReplaysLoading(false);
      }
    };

    loadReplays().catch(() => {
      if (!cancelled) setReplaysLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, task, playbookId, fetchTaskReplays]);

  useEffect(() => {
    if (!open || !task || !playbookId || !task.activeReplayId) return;
    void fetchTaskReplays(playbookId, task.id).then(setReplays).catch(() => undefined);
  }, [
    open,
    playbookId,
    task,
    fetchTaskReplays,
    task?.activeReplayId,
    task?.activeReplayVersion,
    task?.activeReplayFormatGuideStatus,
    task?.activeReplayFormatGuideError,
  ]);

  useEffect(() => {
    if (!open || !task || !playbookId) return;
    if (!replays.some((replay) => replay.preserveOutputFormat && replay.formatGuideStatus === 'pending')) return;

    const intervalId = window.setInterval(() => {
      void fetchTaskReplays(playbookId, task.id).then(setReplays).catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [open, playbookId, task, replays, fetchTaskReplays]);

  const handleNotifyToggle = useCallback((checked: boolean) => {
    setNotifyOnComplete(checked);
    if (checked && notifyEmails.length === 0 && user?.email) {
      setNotifyEmails([user.email]);
    }
  }, [notifyEmails.length, user?.email]);

  const addEmail = useCallback((raw: string) => {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_REGEX.test(email)) {
      setEmailError(t('nodeEditor.invalidEmail'));
      return;
    }
    if (notifyEmails.includes(email)) {
      setEmailError(t('nodeEditor.duplicateEmail'));
      return;
    }
    setNotifyEmails((prev) => [...prev, email]);
    setEmailInput('');
    setEmailError('');
  }, [notifyEmails, t]);

  const removeEmail = useCallback((email: string) => {
    setNotifyEmails((prev) => prev.filter((e) => e !== email));
  }, []);

  const handleEmailKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addEmail(emailInput);
    } else if (e.key === 'Backspace' && !emailInput && notifyEmails.length > 0) {
      setNotifyEmails((prev) => prev.slice(0, -1));
    }
    if (emailError) setEmailError('');
  }, [emailInput, notifyEmails.length, addEmail, emailError]);

  const handleEmailBlur = useCallback(() => {
    if (emailInput.trim()) addEmail(emailInput);
  }, [emailInput, addEmail]);

  if (!task) return null;

  const handleActivateReplay = async (replayId: string) => {
    if (!playbookId || !task) return;
    setActivatingReplayId(replayId);
    try {
      const replay = await activateTaskReplay(playbookId, task.id, replayId);
      setReplays((prev) =>
        prev.map((item) => ({
          ...item,
          status: item.id === replay.id ? 'active' : item.status === 'archived' ? 'archived' : 'inactive',
        })),
      );
    } finally {
      setActivatingReplayId(null);
    }
  };

  const openFormatGuideEditor = (replay: ValidatedTaskReplay) => {
    setEditingReplay(replay);
    setPreserveFormatDraft(Boolean(replay.preserveOutputFormat));
    setFormatGuideDraft(replay.outputFormatGuide || '');
  };

  const handleSaveFormatGuide = async () => {
    if (!playbookId || !task || !editingReplay) return;
    setSavingFormatGuide(true);
    try {
      const updatedReplay = await updateTaskReplayFormatGuide(playbookId, task.id, editingReplay.id, {
        preserveOutputFormat: preserveFormatDraft,
        outputFormatGuide: formatGuideDraft,
      });
      setReplays((prev) => prev.map((item) => (item.id === updatedReplay.id ? updatedReplay : item)));
      setEditingReplay(updatedReplay);
    } finally {
      setSavingFormatGuide(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>{t('nodeEditor.title')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('nodeEditor.stepTitle')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('nodeEditor.stepTitlePlaceholder')}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('nodeEditor.description')}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('nodeEditor.descriptionPlaceholder')}
              rows={10}
              maxLength={20000}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <Label>Step enabled</Label>
              <div className="text-xs text-muted-foreground">
                Disabled steps stay in the playbook but are skipped during execution.
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">{t('ports.inputPorts')}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const id = `in-${crypto.randomUUID().slice(0, 8)}`;
                  setInputPorts((prev) => [...prev, { id, name: 'Input', artifactKind: 'text', required: false }]);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('ports.addInput')}
              </Button>
            </div>
            {inputPorts.length === 0 && (
              <p className="text-xs text-muted-foreground">No input ports defined.</p>
            )}
            {inputPorts.map((port, idx) => (
              <div key={port.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className={`w-3 h-3 rounded-full shrink-0 ${getPortColor(port.artifactKind)}`} />
                <input
                  type="text"
                  value={port.name}
                  onChange={(e) => {
                    const updated = [...inputPorts];
                    updated[idx] = { ...updated[idx], name: e.target.value };
                    setInputPorts(updated);
                  }}
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-primary"
                  placeholder={t('ports.portName')}
                />
                <select
                  value={port.artifactKind}
                  onChange={(e) => {
                    const updated = [...inputPorts];
                    updated[idx] = { ...updated[idx], artifactKind: e.target.value as ArtifactKind };
                    setInputPorts(updated);
                  }}
                  className="h-7 text-xs rounded border bg-background px-1"
                >
                  {(['text', 'document', 'code', 'image', 'data', 'dashboard'] as const).map((kind) => (
                    <option key={kind} value={kind}>{t(`artifactKind.${kind}`)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const updated = [...inputPorts];
                    updated[idx] = { ...updated[idx], required: !updated[idx].required };
                    setInputPorts(updated);
                  }}
                  className={`text-xs px-1.5 py-0.5 rounded border ${port.required ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground border-muted'}`}
                  title={port.required ? t('ports.required') : t('ports.optional')}
                >
                  {port.required ? t('ports.required') : t('ports.optional')}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setInputPorts((prev) => prev.filter((_, i) => i !== idx))}
                  title={t('ports.removePort')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">{t('ports.outputPorts')}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const id = `out-${crypto.randomUUID().slice(0, 8)}`;
                  setOutputPorts((prev) => [...prev, { id, name: 'Output', artifactKind: 'text' }]);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('ports.addOutput')}
              </Button>
            </div>
            {outputPorts.length === 0 && (
              <p className="text-xs text-muted-foreground">No output ports defined.</p>
            )}
            {outputPorts.map((port, idx) => (
              <div key={port.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className={`w-3 h-3 rounded-full shrink-0 ${getPortColor(port.artifactKind)}`} />
                <input
                  type="text"
                  value={port.name}
                  onChange={(e) => {
                    const updated = [...outputPorts];
                    updated[idx] = { ...updated[idx], name: e.target.value };
                    setOutputPorts(updated);
                  }}
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-primary"
                  placeholder={t('ports.portName')}
                />
                <select
                  value={port.artifactKind}
                  onChange={(e) => {
                    const updated = [...outputPorts];
                    updated[idx] = { ...updated[idx], artifactKind: e.target.value as ArtifactKind };
                    setOutputPorts(updated);
                  }}
                  className="h-7 text-xs rounded border bg-background px-1"
                >
                  {(['text', 'document', 'code', 'image', 'data', 'dashboard'] as const).map((kind) => (
                    <option key={kind} value={kind}>{t(`artifactKind.${kind}`)}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setOutputPorts((prev) => prev.filter((_, i) => i !== idx))}
                  title={t('ports.removePort')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>{t('nodeEditor.agent')}</Label>
            <SearchableSelect
              options={agentOptions}
              value={assignedAgentId || ''}
              onValueChange={(v) => setAssignedAgentId(v)}
              placeholder={t('nodeEditor.selectAgent')}
              searchPlaceholder={t('nodeEditor.searchAgent')}
              emptyText={t('nodeEditor.noAgentFound')}
            />
            {!assignedAgentId && (
              <p className="text-xs text-destructive">{t('nodeEditor.agentRequired')}</p>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Replay baselines</h4>
              <div className="flex items-center gap-2">
                {task.hasValidatedReplay && (
                  <Badge variant="outline" className="text-amber-700 border-amber-600/30">
                    Active v{task.activeReplayVersion || 1}
                  </Badge>
                )}
                {task.activeReplayPreserveOutputFormat && (
                  <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                    Format preserved
                  </Badge>
                )}
                {task.activeReplayPreserveOutputFormat && task.activeReplayFormatGuideStatus === 'pending' && (
                  <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                    Guide pending
                  </Badge>
                )}
                {task.activeReplayPreserveOutputFormat && task.activeReplayFormatGuideStatus === 'failed' && (
                  <Badge variant="outline" className="text-red-700 border-red-600/30">
                    Guide failed
                  </Badge>
                )}
                {task.activeReplayIsStale && (
                  <Badge variant="outline" className="text-orange-700 border-orange-600/30">
                    Stale replay
                  </Badge>
                )}
              </div>
            </div>
            {(task.hasOutputFormatTemplate || task.activeOutputFormatStatus) && (
              <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-800">
                <div className="flex flex-wrap items-center gap-2">
                  {task.hasOutputFormatTemplate && (
                    <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                      Format template v{task.activeOutputFormatTemplateVersion || 1}
                    </Badge>
                  )}
                  {task.activeOutputFormatStatus === 'pending' && (
                    <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                      Template pending
                    </Badge>
                  )}
                  {task.activeOutputFormatStatus === 'failed' && (
                    <Badge variant="outline" className="text-red-700 border-red-600/30">
                      Template failed
                    </Badge>
                  )}
                </div>
                {task.activeOutputFormatError && (
                  <div className="mt-2 text-xs text-red-700">{task.activeOutputFormatError}</div>
                )}
                <div className="mt-2 text-xs text-muted-foreground">
                  Output format templates are captured independently from replay baselines.
                </div>
              </div>
            )}
            {task.activeReplayIsStale && task.activeReplayStaleReasons && task.activeReplayStaleReasons.length > 0 && (
              <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-800">
                <div className="font-medium">Replay baseline warning</div>
                <div className="mt-1">{task.activeReplayStaleReasons.join(' • ')}</div>
              </div>
            )}
            {replaysLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading replay baselines
              </div>
            ) : replays.length > 0 ? (
              <div className="space-y-2">
                {replays.map((replay) => (
                  <div key={replay.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Version {replay.validationVersion}</div>
                        <div className="text-xs text-muted-foreground">
                          Execution #{replay.referenceExecutionNumber} • {new Date(replay.createdAt).toLocaleString()}
                        </div>
                      </div>
                      {replay.status === 'active' ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={activatingReplayId === replay.id}
                          onClick={() => handleActivateReplay(replay.id)}
                        >
                          {activatingReplayId === replay.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Activate'}
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {replay.toolCalls.length} tool call{replay.toolCalls.length === 1 ? '' : 's'}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {replay.preserveOutputFormat && (
                        <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                          Format preserved
                        </Badge>
                      )}
                      {replay.preserveOutputFormat && replay.formatGuideStatus === 'pending' && (
                        <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                          Guide pending
                        </Badge>
                      )}
                      {replay.preserveOutputFormat && replay.formatGuideStatus === 'failed' && (
                        <Badge variant="outline" className="text-red-700 border-red-600/30">
                          Guide failed
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => openFormatGuideEditor(replay)}
                      >
                        Edit format guide
                      </Button>
                    </div>
                    {replay.isStale && replay.staleReasons && replay.staleReasons.length > 0 && (
                      <div className="mt-2 rounded border border-orange-500/30 bg-orange-500/5 p-2 text-xs text-orange-800">
                        {replay.staleReasons.join(' • ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No replay baseline yet. Save one from a successful execution step.
              </div>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium">{t('nodeEditor.interruptSettings')}</h4>

            <div className="flex items-center justify-between">
              <Label htmlFor="interrupt-before" className="text-sm font-normal">
                {t('nodeEditor.interruptBefore')}
              </Label>
              <Switch
                id="interrupt-before"
                checked={interruptBefore}
                onCheckedChange={setInterruptBefore}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="interrupt-after" className="text-sm font-normal">
                {t('nodeEditor.interruptAfter')}
              </Label>
              <Switch
                id="interrupt-after"
                checked={interruptAfter}
                onCheckedChange={setInterruptAfter}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="allow-clarification" className="text-sm font-normal">
                {t('nodeEditor.allowClarification')}
              </Label>
              <Switch
                id="allow-clarification"
                checked={allowClarification}
                onCheckedChange={setAllowClarification}
              />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium">{t('nodeEditor.notificationSettings')}</h4>

            <div className="flex items-center justify-between">
              <Label htmlFor="notify-on-complete" className="text-sm font-normal">
                {t('nodeEditor.notifyOnComplete')}
              </Label>
              <Switch
                id="notify-on-complete"
                checked={notifyOnComplete}
                onCheckedChange={handleNotifyToggle}
              />
            </div>

            {notifyOnComplete && (
              <div className="space-y-2">
                <Label className="text-sm font-normal">{t('nodeEditor.notifyEmails')}</Label>
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 min-h-[38px]">
                  {notifyEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeEmail(email)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => {
                      setEmailInput(e.target.value);
                      if (emailError) setEmailError('');
                    }}
                    onKeyDown={handleEmailKeyDown}
                    onBlur={handleEmailBlur}
                    placeholder={notifyEmails.length === 0 ? t('nodeEditor.notifyEmailPlaceholder') : ''}
                    className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                {emailError && (
                  <p className="text-xs text-destructive">{emailError}</p>
                )}
                <p className="text-xs text-muted-foreground">{t('nodeEditor.notifyEmailHint')}</p>
              </div>
            )}
          </div>
        </div>

      </SheetContent>

      <Dialog open={!!editingReplay} onOpenChange={(open) => {
        if (!open) {
          setEditingReplay(null);
          setFormatGuideDraft('');
          setPreserveFormatDraft(false);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit format guide</DialogTitle>
            <DialogDescription>
              Adjust the replay output-format guide used by Replay (Flex) and Replay (Adaptive).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Preserve output format</div>
                <div className="text-xs text-muted-foreground">
                  When enabled, replay synthesis will follow this guide.
                </div>
              </div>
              <Switch checked={preserveFormatDraft} onCheckedChange={setPreserveFormatDraft} />
            </div>
            <div className="space-y-2">
              <Label>Format guide</Label>
              {editingReplay?.preserveOutputFormat && editingReplay.formatGuideStatus === 'pending' && (
                <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-800">
                  Format guide generation is pending. You can wait for the generated guide or replace it manually here.
                </div>
              )}
              {editingReplay?.formatGuideStatus === 'failed' && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-800">
                  Format guide generation failed{editingReplay.formatGuideError ? `: ${editingReplay.formatGuideError}` : '.'}
                </div>
              )}
              <Textarea
                value={formatGuideDraft}
                onChange={(e) => setFormatGuideDraft(e.target.value)}
                rows={10}
                placeholder="Describe the output structure to preserve during replay synthesis."
              />
            </div>
            {editingReplay?.referenceOutput && (
              <div className="space-y-2">
                <Label>Validated output reference</Label>
                <div className="max-h-52 overflow-auto rounded-md border bg-muted/20 p-3 text-xs whitespace-pre-wrap">
                  {editingReplay.referenceOutput}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingReplay(null);
                setFormatGuideDraft('');
                setPreserveFormatDraft(false);
              }}
              disabled={savingFormatGuide}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleSaveFormatGuide()} disabled={savingFormatGuide}>
              {savingFormatGuide ? 'Saving...' : 'Save format guide'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
