import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { useModelsStore, type Model } from '@/modules/models';
import { PromptBar } from './PromptBar';

const STREAM_ID = 'stream-1';
const sendCalls: Array<{ content: string; managerModelId?: string; workerModelId?: string }> = [];

vi.mock('../query/hooks', () => ({
  useSendMessage: () => ({
    mutate: (
      input: { content: string; managerModelId?: string; workerModelId?: string },
    ) => {
      sendCalls.push(input);
    },
    isPending: false,
  }),
}));

vi.mock('../store', () => ({
  useWorkyStreaming: () => false,
}));

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'm-default',
    name: 'GPT 4o Mini',
    chef: 'OpenAI',
    chefSlug: 'openai',
    litellmModel: 'openai/gpt-4o-mini',
    providers: ['openai'],
    isActive: true,
    isDefault: true,
    ...overrides,
  };
}

function TestProviders({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <LocalizationProvider>{children}</LocalizationProvider>
    </QueryClientProvider>
  );
}

function seedModelsStore(model: Model | null) {
  useModelsStore.setState({
    models: model ? [model] : [],
    total: model ? 1 : 0,
    isLoading: false,
    isInitialized: !!model,
    error: null,
    lastFetchedAt: model ? new Date() : null,
  });
}

describe('PromptBar model selection (cold load + Default stickiness)', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    seedModelsStore(makeModel());
  });

  // The i18n instance is uninitialized in the test environment, so the
  // selector `label` resolves to its untranslated key. That key is what
  // the `data-testid` is built from.
  const managerTestId = 'worky-model-selector-promptbar.modelselector.manager';
  const workerTestId = 'worky-model-selector-promptbar.modelselector.workers';
  const defaultTestId = 'worky-model-default-promptbar.modelselector.manager';

  it('hydrates per-turn selection from the persistent stream model on mount', () => {
    // Persistent model is *different* from the admin default (GPT 4o Mini).
    // This proves the prompt bar uses the persistent value, not the admin
    // default, even though both could resolve the same way.
    render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId='openai/glm-5.1'
          workerModelId={null}
        />
      </TestProviders>,
    );

    const managerTrigger = screen.getByTestId(managerTestId);
    expect(managerTrigger).toHaveTextContent('glm-5.1');
  });

  it('shows the admin default (GPT 4o Mini) when stream data has not loaded', () => {
    // The trigger label is the per-turn `managerModel` state, which is
    // `null` while stream data is still loading. The WorkyModelSelector
    // falls back to the "Default" pseudo-option label in that case.
    render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId={undefined}
          workerModelId={undefined}
        />
      </TestProviders>,
    );

    // The trigger should display the "Default" pseudo-option label, NOT
    // the admin default. The admin default is the backend's job to
    // resolve, not the prompt bar's.
    const managerTrigger = screen.getByTestId(managerTestId);
    const ariaLabel = managerTrigger.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toMatch(/default$/i);
    expect(managerTrigger).not.toHaveTextContent('GPT 4o Mini');
  });

  it('keeps the stream persistent model on mount when data loads after first render', async () => {
    // First render: stream data is still loading (managerModelId undefined).
    const { rerender } = render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId={undefined}
          workerModelId={undefined}
        />
      </TestProviders>,
    );

    // Stream data arrives with a persistent model that differs from the
    // admin default — the trigger must adopt the persistent value.
    rerender(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId='openai/glm-5.1'
          workerModelId={null}
        />
      </TestProviders>,
    );

    await waitFor(() => {
      const managerTrigger = screen.getByTestId(managerTestId);
      expect(managerTrigger).toHaveTextContent('glm-5.1');
    });
  });

  it('shows the short litellm id when the persistent model is not in the catalog yet', () => {
    render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId='openai/glm-5.1'
          workerModelId={null}
        />
      </TestProviders>,
    );

    // Catalog only contains GPT 4o Mini, so the trigger should display the
    // short litellm id as a fallback rather than "Default".
    const managerTrigger = screen.getByTestId(managerTestId);
    expect(managerTrigger).toHaveTextContent('glm-5.1');
  });

  it('sticks at "Default" when the user clicks the Default pseudo-option', async () => {
    // Persistent model set. After clicking Default in the popover, the pill
    // should switch to Default and stay there even though the stream still
    // has a persistent model.
    render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId='openai/gpt-4o-mini'
          workerModelId={null}
        />
      </TestProviders>,
    );

    const managerTrigger = screen.getByTestId(managerTestId);
    expect(managerTrigger).toHaveTextContent('GPT 4o Mini');

    fireEvent.click(managerTrigger);

    const defaultOption = await screen.findByTestId(defaultTestId);
    fireEvent.click(defaultOption);

    await waitFor(() => {
      // The trigger text should be the "Default" pseudo-option label.
      const ariaLabel = managerTrigger.getAttribute('aria-label') ?? '';
      expect(ariaLabel).toMatch(/default$/i);
    });

    // Clicking Default in the prompt bar must NOT issue any PATCH — it is
    // a per-turn override. The persistent stream field is untouched.
    expect(sendCalls).toHaveLength(0);
  });

  it('omits managerModelId from the wire payload when per-turn matches persistent', () => {
    render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId='openai/gpt-4o-mini'
          workerModelId={null}
        />
      </TestProviders>,
    );

    const textarea = screen.getByTestId('worky-prompt-content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toEqual({ content: 'hello' });
    expect(sendCalls[0].managerModelId).toBeUndefined();
    expect(sendCalls[0].workerModelId).toBeUndefined();
  });

  it('sends managerModelId as override when per-turn differs from persistent', () => {
    render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          managerModelId={null}
          workerModelId={null}
        />
      </TestProviders>,
    );

    const managerTrigger = screen.getByTestId(managerTestId);
    fireEvent.click(managerTrigger);
    // The admin default is the only model — pick it as the per-turn override.
    const defaultOption = screen.getByTestId(defaultTestId);
    fireEvent.click(defaultOption);

    // Now switch to a real model via the popover.
    fireEvent.click(managerTrigger);
    const option = screen.getByTestId('worky-model-option-openai/gpt-4o-mini');
    fireEvent.click(option);

    const textarea = screen.getByTestId('worky-prompt-content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'ping' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].content).toBe('ping');
    expect(sendCalls[0].managerModelId).toBe('openai/gpt-4o-mini');
  });
});
