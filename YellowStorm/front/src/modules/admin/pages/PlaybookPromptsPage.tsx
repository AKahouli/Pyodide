import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, FileText, BadgeInfo } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getPlaybookPrompts, updatePlaybookPrompt } from '../api';
import type { PlaybookPromptResponse } from '../types';

const EMPTY_PROMPT: PlaybookPromptResponse = {
  id: '',
  key: '',
  title: '',
  category: 'task',
  description: '',
  systemTemplate: '',
  userTemplate: '',
  enabled: true,
  version: 1,
  isBuiltIn: false,
  createdAt: '',
  updatedAt: '',
};

export function PlaybookPromptsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<PlaybookPromptResponse[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [draft, setDraft] = useState<PlaybookPromptResponse>(EMPTY_PROMPT);

  const selected = useMemo(() => items.find((item) => item.key === selectedKey) || null, [items, selectedKey]);

  const syncDraft = (item: PlaybookPromptResponse | null) => {
    if (!item) {
      setDraft(EMPTY_PROMPT);
      return;
    }
    setDraft(item);
  };

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const data = await getPlaybookPrompts();
      const nextItems = data.items || [];
      setItems(nextItems);
      const first = nextItems[0] || null;
      setSelectedKey((current) => current && nextItems.some((item) => item.key === current) ? current : (first?.key || ''));
      syncDraft(selectedKey && nextItems.some((item) => item.key === selectedKey) ? nextItems.find((item) => item.key === selectedKey) || null : first);
    } catch (err) {
      toast.error('Failed to load playbook prompts', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncDraft(selected);
  }, [selected]);

  const handleSave = async () => {
    if (!draft.key) return;
    setSaving(true);
    try {
      const updated = await updatePlaybookPrompt(draft.key, {
        title: draft.title,
        category: draft.category,
        description: draft.description,
        systemTemplate: draft.systemTemplate,
        userTemplate: draft.userTemplate,
        enabled: draft.enabled,
      });
      setItems((current) => current.map((item) => (item.key === updated.key ? updated : item)));
      setDraft(updated);
      toast.success('Prompt saved and published');
    } catch (err) {
      toast.error('Failed to save prompt', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Playbook Prompts</h1>
          <p className="text-muted-foreground">Edit the prompts used by playbook execution and publish updates immediately.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void fetchPrompts()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => void handleSave()} disabled={!draft.key || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save & Publish
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Prompt Registry</CardTitle>
            <CardDescription>{items.length} prompt slots</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[760px]">
              <div className="p-3 space-y-2">
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedKey(item.key)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                      selectedKey === item.key && 'border-primary bg-primary/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{item.title}</div>
                      <Badge variant={item.enabled ? 'default' : 'secondary'}>{item.category}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground break-all">{item.key}</div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <BadgeInfo className="h-3.5 w-3.5" />
                      v{item.version}{item.isBuiltIn ? ' • built-in' : ''}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{draft.title || 'Select a prompt'}</CardTitle>
                <CardDescription className="break-all">{draft.key || 'No prompt selected'}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={draft.enabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))} />
                <span className="text-sm text-muted-foreground">Enabled</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <Input value={draft.title} onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Input value={draft.category} onChange={(e) => setDraft((current) => ({ ...current, category: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input value={draft.description || ''} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} />
            </div>

            <Separator />

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">System Template</label>
                <Textarea
                  value={draft.systemTemplate}
                  onChange={(e) => setDraft((current) => ({ ...current, systemTemplate: e.target.value }))}
                  className="min-h-[320px] font-mono text-sm"
                  placeholder="System prompt text"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">User Template</label>
                <Textarea
                  value={draft.userTemplate}
                  onChange={(e) => setDraft((current) => ({ ...current, userTemplate: e.target.value }))}
                  className="min-h-[320px] font-mono text-sm"
                  placeholder="User prompt text"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
