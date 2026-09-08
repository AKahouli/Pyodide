import { Archive } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { AdminModelResponse, CompactionSettings } from '../types';

// Sentinel: empty summarizerModel means "reuse the chat model" (Radix Select
// items can't have an empty-string value).
const CHAT_MODEL_DEFAULT = 'chat-default';

// ponytail: admin-only card, English strings inline instead of i18n keys across
// every locale file. Move to t('...') if this panel gets localized.
interface CompactionSettingsCardProps {
  value: CompactionSettings;
  onChange: (next: CompactionSettings) => void;
  models: AdminModelResponse[];
  disabled?: boolean;
}

export function CompactionSettingsCard({ value, onChange, models, disabled }: CompactionSettingsCardProps) {
  const setNum = (key: keyof CompactionSettings, raw: string) =>
    onChange({ ...value, [key]: Number(raw) });

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
            <Archive className='h-5 w-5' />
          </div>
          <div>
            <CardTitle>Context compaction</CardTitle>
            <CardDescription>
              Summarize older conversation turns to cut latency and cost. Sent to the engine on every
              chat request; the token threshold is derived from the model&apos;s context window.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center justify-between gap-6 rounded-lg border p-4'>
          <div className='space-y-1'>
            <Label htmlFor='compaction-enabled'>Enable compaction</Label>
            <p className='text-xs text-muted-foreground'>When off, the full history is sent every turn.</p>
          </div>
          <Switch
            id='compaction-enabled'
            checked={value.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          />
        </div>

        {value.enabled && (
          <div className='grid gap-6 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='compaction-interval'>Sliding window: interval (turns)</Label>
              <Input
                id='compaction-interval' type='number' min={0} max={1000} disabled={disabled}
                value={value.compactionInterval}
                onChange={(e) => setNum('compactionInterval', e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>New invocations between compactions. 0 = sliding window off.</p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='compaction-overlap'>Sliding window: overlap</Label>
              <Input
                id='compaction-overlap' type='number' min={0} max={100} disabled={disabled}
                value={value.overlapSize}
                onChange={(e) => setNum('overlapSize', e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>Prior invocations re-summarized for continuity.</p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='compaction-fraction'>Token trigger: fraction of context</Label>
              <Input
                id='compaction-fraction' type='number' min={0} max={1} step={0.05} disabled={disabled}
                value={value.tokenFraction}
                onChange={(e) => setNum('tokenFraction', e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>Threshold = fraction × model context window (0..1). 0 = token trigger off.</p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='compaction-retention'>Token trigger: retained raw events</Label>
              <Input
                id='compaction-retention' type='number' min={0} max={1000} disabled={disabled}
                value={value.eventRetentionSize}
                onChange={(e) => setNum('eventRetentionSize', e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>Recent raw events kept un-compacted.</p>
            </div>

            <div className='space-y-2 md:col-span-2'>
              <Label htmlFor='compaction-summarizer'>Summarizer model</Label>
              <Select
                value={value.summarizerModel || CHAT_MODEL_DEFAULT}
                disabled={disabled}
                onValueChange={(v) => onChange({ ...value, summarizerModel: v === CHAT_MODEL_DEFAULT ? '' : v })}
              >
                <SelectTrigger id='compaction-summarizer' aria-describedby='compaction-summarizer-help'><SelectValue /></SelectTrigger>
                <SelectContent className='max-h-[40vh]'>
                  <SelectItem value={CHAT_MODEL_DEFAULT}>Use the chat model</SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.name}{model.chef ? ` - ${model.chef}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id='compaction-summarizer-help' className='text-xs text-muted-foreground'>Model used to summarize; a small fast model lowers the token-trigger latency.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
