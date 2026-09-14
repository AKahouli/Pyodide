import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreateEditAgentDialog } from './CreateEditAgentDialog';

const fetchAgentTypesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fetchModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getActiveToolsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getWorkspacesMock = vi.hoisted(() => vi.fn().mockResolvedValue({ workspaces: [] }));
const getActiveSkillsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getActiveConnectorsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const modelsStateMock = vi.hoisted(() => ({
  models: [
    {
      id: 'model-1', name: 'Model One', supportsReasoning: true,
      reasoning: { defaultEffort: 'medium', efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] },
    },
    { id: 'model-2', name: 'Model Two', supportsReasoning: false, reasoning: { efforts: [] } },
  ],
}));

vi.mock('../store', () => ({
  useAgentTypes: () => [{ id: 'type-1', name: 'Manager' }],
  useEvaluationDatasets: () => [],
  useEvaluations: () => [],
  useEvaluationScenarios: () => [],
  useEvaluationLoading: () => false,
  useAgentStore: {
    getState: () => ({ fetchAgentTypes: fetchAgentTypesMock }),
  },
}));

vi.mock('@/modules/models', () => ({
  useModels: () => modelsStateMock.models,
  useModelsStore: {
    getState: () => ({ fetchModels: fetchModelsMock }),
  },
  // Re-exported for conversation-v2 store listeners pulled in via AppSidebar.
  CONVERSATION_V2_DEFAULT_MODEL_CHANGED_EVENT: 'conversation-v2:default-model-changed',
}));

vi.mock('../api', () => ({
  getActiveTools: getActiveToolsMock,
  getActiveSkills: getActiveSkillsMock,
  getActiveConnectors: getActiveConnectorsMock,
}));

vi.mock('@/modules/workspace', () => ({
  getWorkspaces: getWorkspacesMock,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input ref={ref} {...props} />),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => <textarea ref={ref} {...props} />),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: { children: ReactNode }) => <button {...rest}>{children}</button>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (val: boolean) => void }) => (
    <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange?.(e.target.checked)} />
  ),
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, id }: { checked?: boolean; onCheckedChange?: (val: boolean) => void; id?: string }) => (
    <input type="checkbox" id={id} checked={checked} onChange={(e) => onCheckedChange?.(e.target.checked)} />
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <div>{placeholder}</div>,
}));

vi.mock('@/components/ui/slider', () => ({
  Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (vals: number[]) => void }) => (
    <input type="range" value={value[0]} onChange={(e) => onValueChange([Number(e.target.value)])} />
  ),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/multi-select', () => ({
  MultiSelect: ({ value }: { value: string[] }) => <div>multiselect-{value.length}</div>,
}));

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({ value, options, onValueChange }: { value: string; options: Array<{ value: string; label: string }>; onValueChange: (value: string) => void }) => (
    <select aria-label="model-select" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('./AgentReasoningEffortField', () => ({
  AgentReasoningEffortField: ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => (
    <select aria-label="reasoning-effort" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Unavailable</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
    </select>
  ),
}));

vi.mock('./EvaluationTab', () => ({
  EvaluationTab: () => <div>evaluation-tab</div>,
}));

vi.mock('./AgentTelegramIntegrationSection', () => ({
  AgentTelegramIntegrationSection: ({ agentId }: { agentId: string | null }) => (
    <div data-testid="telegram-section">telegram-section-{String(agentId)}</div>
  ),
}));

vi.mock('./AgentWhatsAppIntegrationSection', () => ({
  AgentWhatsAppIntegrationSection: ({ agentId }: { agentId: string | null }) => (
    <div data-testid="whatsapp-section">whatsapp-section-{String(agentId)}</div>
  ),
}));

vi.mock('@/lib/form-utils', () => ({
  scrollToFirstError: vi.fn(),
}));

describe('CreateEditAgentDialog', () => {
  it('renders create mode content', async () => {
    render(
      <CreateEditAgentDialog
        open
        onOpenChange={vi.fn()}
        agent={null}
        onSave={vi.fn()}
        saving={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('createEdit.titleCreate')).toBeInTheDocument();
    });
  });

  it('generates a slug from the name in create mode', async () => {
    const user = userEvent.setup();
    render(
      <CreateEditAgentDialog
        open
        onOpenChange={vi.fn()}
        agent={null}
        onSave={vi.fn()}
        saving={false}
      />,
    );

    await user.type(await screen.findByLabelText('createEdit.fields.name'), 'New Agent');

    await waitFor(() => {
      expect(screen.getByLabelText('createEdit.fields.slug')).toHaveValue('new-agent');
    });
  });

  it('preserves the loaded slug when editing an agent', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CreateEditAgentDialog
        open
        onOpenChange={vi.fn()}
        agent={{
          id: 'a1',
          name: 'Yellowmind',
          slug: 'platform-copilot',
          agentType: { id: 'type-1', name: 'Manager' },
          role: 'role',
          description: '',
          temperature: 0.5,
          model: 'model-1',
          reasoning_effort: 'high',
          instruction: '',
          ignorePrePrompt: false,
          knowledgeBases: [],
          tools: [],
          isDefault: false,
          isDefaultForType: false,
          isActive: true,
          createdBy: '',
          createdAt: '',
          updatedAt: '',
        }}
        onSave={onSave}
        saving={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('createEdit.fields.slug')).toHaveValue('platform-copilot');
      expect(screen.getByLabelText('reasoning-effort')).toHaveValue('high');
    });

    await user.click(screen.getByRole('button', { name: 'createEdit.actions.saveChanges' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'platform-copilot', reasoningEffort: 'high' }),
      expect.anything(),
    ));
    expect(screen.getByTestId('telegram-section')).toHaveTextContent('telegram-section-a1');
  });

  it('clears reasoning effort when the selected model does not support it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CreateEditAgentDialog
        open
        onOpenChange={vi.fn()}
        agent={null}
        onSave={onSave}
        saving={false}
      />,
    );

    await user.selectOptions(await screen.findByLabelText('model-select'), 'model-1');
    await waitFor(() => expect(screen.getByLabelText('reasoning-effort')).toHaveValue('medium'));
    await user.selectOptions(screen.getByLabelText('model-select'), '__none__');
    await waitFor(() => expect(screen.getByLabelText('reasoning-effort')).toHaveValue(''));
    await user.selectOptions(screen.getByLabelText('model-select'), 'model-1');
    await waitFor(() => expect(screen.getByLabelText('reasoning-effort')).toHaveValue('medium'));
    await user.selectOptions(screen.getByLabelText('model-select'), 'model-2');
    await waitFor(() => expect(screen.getByLabelText('reasoning-effort')).toHaveValue(''));
  });
});
