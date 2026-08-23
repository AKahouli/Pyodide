import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreateEditAgentDialog } from './CreateEditAgentDialog';

const fetchAgentTypesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fetchModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getActiveToolsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getWorkspacesMock = vi.hoisted(() => vi.fn().mockResolvedValue({ workspaces: [] }));
const getActiveSkillsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getActiveConnectorsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

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

vi.mock('@/modules/models/store', () => ({
  useModels: () => [{ id: 'model-1', name: 'Model One' }],
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
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
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
  SearchableSelect: ({ value }: { value: string }) => <div>searchable-{value}</div>,
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

  it('renders edit mode content with agent data', async () => {
    render(
      <CreateEditAgentDialog
        open
        onOpenChange={vi.fn()}
        agent={{
          id: 'a1',
          name: 'Agent',
          slug: 'agent',
          agentType: { id: 'type-1', name: 'Manager' },
          role: 'role',
          description: '',
          temperature: 0.5,
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
        onSave={vi.fn()}
        saving={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('createEdit.titleEdit')).toBeInTheDocument();
    });

    expect(screen.getByTestId('telegram-section')).toHaveTextContent('telegram-section-a1');
  });
});
