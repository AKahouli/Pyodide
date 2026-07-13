import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { WidgetSuggestion } from '../../types';

interface WidgetSuggestionEditorProps {
  suggestions: WidgetSuggestion[];
  labels: {
    title: string;
    add: string;
    remove: string;
    enabled: string;
    label: string;
    prompt: string;
    limit: string;
  };
  onChange: (suggestions: WidgetSuggestion[]) => void;
}

export function WidgetSuggestionEditor({ suggestions, labels, onChange }: WidgetSuggestionEditorProps) {
  const updateSuggestion = (index: number, patch: Partial<WidgetSuggestion>) => {
    onChange(suggestions.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const addSuggestion = () => {
    if (suggestions.length >= 6) return;
    onChange([
      ...suggestions,
      { id: `suggestion-${Date.now()}`, label: '', prompt: '', enabled: true, sortOrder: (suggestions.length + 1) * 10 },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>{labels.title}</Label>
        <Button type="button" variant="outline" size="sm" onClick={addSuggestion} disabled={suggestions.length >= 6}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {labels.add}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{labels.limit}</p>
      <div className="grid gap-3">
        {suggestions.map((suggestion, index) => (
          <div key={suggestion.id || index} className="rounded-md border p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={suggestion.enabled} onCheckedChange={(enabled) => updateSuggestion(index, { enabled })} aria-label={labels.enabled} />
                <span className="text-xs text-muted-foreground">{labels.enabled}</span>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={labels.remove} onClick={() => onChange(suggestions.filter((_, itemIndex) => itemIndex !== index))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-2">
              <Input value={suggestion.label} maxLength={60} placeholder={labels.label} onChange={(event) => updateSuggestion(index, { label: event.target.value })} />
              <Textarea value={suggestion.prompt} maxLength={5000} placeholder={labels.prompt} rows={2} onChange={(event) => updateSuggestion(index, { prompt: event.target.value })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
