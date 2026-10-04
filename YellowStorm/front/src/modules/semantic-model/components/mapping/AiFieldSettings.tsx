import { useEffect, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, ExternalLink, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAgents, useAgentStore } from '@/modules/agent';
import { useModuleTranslation } from '@/modules/localization';
import type { AttributeDefinition, SemanticNodeType, SourceFieldMapping } from '../../types';
import { useSemanticModelEditorStore } from '../../store';
import { withSearchIndex } from '../../searchSettings';
import { FieldSearchIndexPane } from '../settings/FieldSearchIndexPane';
import { INPUT_COMPACT, TEXTAREA } from '../form/FormParts';
import { RuleSection, useOpenSections } from './RuleControls';

export const MAX_DEFINITION = 2000;
const DEFAULT_AGENT = '__default__';

/** The AI settings a field keeps only while the AI reads it. */
export function withoutAiSettings(mapping: SourceFieldMapping): SourceFieldMapping {
  const { semanticDefinition: _definition, agentId: _agent, ...rest } = mapping;
  return rest;
}

/** Loads the agents the user can see once, for the agent picker. */
function useAgentChoices() {
  const agents = useAgents();
  useEffect(() => {
    const store = useAgentStore.getState();
    if (!store.isInitialized && !store.isLoading) void store.fetchAgents();
  }, []);
  return agents;
}

/**
 * How the AI reads one field: what the value means (sent to the AI with the field), and which agent
 * reads it. Folded by default, its header sums both up.
 */
export function AiFieldSettings({ fieldLabel, mapping, attributeDescription, onChange, conceptId }: Readonly<{
  fieldLabel: string;
  mapping: SourceFieldMapping;
  /** The concept attribute's description, used when the field has no definition of its own. */
  attributeDescription?: string;
  onChange: (patch: Pick<SourceFieldMapping, 'semanticDefinition' | 'agentId'>) => void;
  /** The concept being mapped: its text field's search index settings are shown under the AI pane. */
  conceptId?: string;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState(false);
  const agents = useAgentChoices();
  const sections = useOpenSections([]);
  const id = `ai-${fieldLabel.replaceAll(/\W+/g, '-')}`;
  const section = (key: string) => ({ id: `${id}-${key}`, open: sections.isOpen(key), onToggle: () => sections.toggle(key) });
  const definition = mapping.semanticDefinition ?? '';
  const fallback = attributeDescription?.trim();
  const agent = mapping.agentId ? agents.find((item) => item.id === mapping.agentId) : undefined;
  const agentName = mapping.agentId ? agent?.name ?? t('mapping.aiField.unknownAgent') : t('mapping.aiField.defaultAgent');
  const definitionSummary = definition.trim() || (fallback ? t('mapping.aiField.fromDescription', { text: fallback }) : t('mapping.aiField.noDefinition'));
  const summary = `${definitionSummary} · ${agentName}`;

  const pane = <div className='rounded-lg border border-dashed'>
    <button type='button' className='flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/50'
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown className='h-3.5 w-3.5 shrink-0' /> : <ChevronRight className='h-3.5 w-3.5 shrink-0' />}
      <span className='shrink-0 font-medium text-foreground'>{t('mapping.aiField.title')}</span>
      <span className='min-w-0 truncate'>{summary}</span>
    </button>
    {open && <div id={id} className='border-t'>
      <RuleSection {...section('definition')} title={t('mapping.aiField.definition')} icon={<MessageSquare className='h-3.5 w-3.5' />}
        summary={definitionSummary} help={t('mapping.aiField.definitionHelp', { field: fieldLabel })}>
        <Textarea className={TEXTAREA} value={definition} maxLength={MAX_DEFINITION} aria-label={t('mapping.aiField.definitionFor', { field: fieldLabel })}
          placeholder={fallback || t('mapping.aiField.definitionPlaceholder', { field: fieldLabel })}
          onChange={(event) => onChange({ semanticDefinition: event.target.value || undefined, agentId: mapping.agentId })} />
      </RuleSection>
      <RuleSection {...section('agent')} title={t('mapping.aiField.agent')} icon={<Bot className='h-3.5 w-3.5' />}
        summary={agentName} help={t('mapping.aiField.agentHelp')}>
        <div className='flex items-center gap-1.5'>
          <Select value={mapping.agentId ?? DEFAULT_AGENT}
            onValueChange={(value) => onChange({ semanticDefinition: mapping.semanticDefinition, agentId: value === DEFAULT_AGENT ? undefined : value })}>
            <SelectTrigger className={cn(INPUT_COMPACT, 'min-w-0 flex-1 text-xs')} aria-label={t('mapping.aiField.agentFor', { field: fieldLabel })}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_AGENT}>{t('mapping.aiField.defaultAgent')}</SelectItem>
              {mapping.agentId && !agent && <SelectItem value={mapping.agentId}>{t('mapping.aiField.unknownAgent')}</SelectItem>}
              {agents.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {agent && <Button asChild type='button' size='sm' variant='ghost' className='h-8 px-2 text-xs'>
            <Link to={`/agents?edit=${encodeURIComponent(agent.id)}`} target='_blank' rel='noreferrer'>
              <ExternalLink className='mr-1 h-3 w-3' />{t('mapping.aiField.openAgent')}
            </Link>
          </Button>}
        </div>
        {mapping.agentId && <p className='text-[11px] text-muted-foreground'>{t('mapping.aiField.agentNotice')}</p>}
      </RuleSection>
    </div>}
  </div>;
  if (!conceptId) return pane;
  return <div className='space-y-2'>
    {pane}
    <ConceptFieldSearchIndex conceptId={conceptId} attributeKey={mapping.targetAttribute} fieldLabel={fieldLabel} />
  </div>;
}

/** The concept field's search index settings, edited in the model like the concept inspector does. */
function ConceptFieldSearchIndex({ conceptId, attributeKey, fieldLabel }: Readonly<{ conceptId: string; attributeKey: string; fieldLabel: string }>) {
  const node = useSemanticModelEditorStore((state) => state.graph?.nodes.find((candidate) => candidate.id === conceptId));
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const attribute = node?.attributes.find((candidate) => candidate.key === attributeKey);
  if (!node || attribute?.type !== 'text') return null;
  const change = (searchIndex: AttributeDefinition['searchIndex']) => {
    const attributes = node.attributes.map((candidate) => candidate.key === attributeKey ? withSearchIndex(candidate, searchIndex) : candidate);
    const changes: Pick<SemanticNodeType, 'attributes'> = { attributes };
    commit({ type: 'node_type.update', id: conceptId, changes }, (current) => ({ ...current, nodes: current.nodes.map((candidate) => candidate.id === conceptId ? { ...candidate, ...changes } : candidate) }));
  };
  return <FieldSearchIndexPane value={attribute.searchIndex} fieldLabel={fieldLabel} onChange={change} />;
}
