import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationAssistantBubble } from './ConversationAssistantBubble';

const mocks = vi.hoisted(() => ({
  getArtifactDownloadUrl: vi.fn(),
  fetchToolResult: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn(async (_key, _fileName, _mimeType, load) => load()),
  showError: vi.fn(),
  writeClipboard: vi.fn(),
  redactSensitiveText: true,
}));

vi.mock('../../api', () => ({ getArtifactDownloadUrl: mocks.getArtifactDownloadUrl, fetchToolResult: mocks.fetchToolResult }));
vi.mock('@/modules/file-viewer', () => ({ openFileViewerFromUrlLoader: mocks.openFileViewerFromUrlLoader }));
vi.mock('@/lib/notifications', () => ({ showError: mocks.showError }));
vi.mock('../../hooks/useConversationSettings', () => ({
  useConversationSettings: () => ({ redactSensitiveText: mocks.redactSensitiveText }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ language: 'en', t: (key: string, options?: { description?: string; tool?: string; status?: string; current?: number; total?: number }) => ({
    'stream.activity.agent': 'Activity',
    'stream.activity.agentRowAria': `${options?.description || ''}, ${options?.status || ''}. Show full reasoning`,
    'stream.activity.agentPlanning': 'Preparing your request',
    'stream.activity.assistant': 'Assistant',
    'stream.activity.usingTools': 'Using tools',
    'stream.activity.tool.runCode': 'Run code',
    'stream.activity.tool.search': 'Search',
    'stream.activity.request': 'Request',
    'stream.activity.response': 'Response',
    'stream.activity.description': 'Description',
    'stream.activity.timestamp': 'Timestamp',
    'stream.activity.timestampUnavailable': 'Timestamp unavailable',
    'stream.activity.copyToolDetails': 'Copy tool details',
    'stream.activity.toolName': 'Tool',
    'stream.activity.responseTitle': `Tool response: ${options?.tool || ''}`,
    'stream.activity.toolRowAria': `${options?.description || ''}, Tool response: ${options?.tool || ''} (${options?.status || ''})`,
    'stream.activity.toolRowAriaFallback': `Tool response: ${options?.tool || ''} (${options?.status || ''})`,
    'stream.activity.toolStatus.running': 'Running',
    'stream.activity.toolStatus.completed': 'Completed',
    'stream.activity.toolStatus.failed': 'Failed',
    'stream.activity.toolStatus.stopped': 'Stopped',
    'stream.activity.requestUnavailable': 'No request data was recorded.',
    'stream.activity.responsePending': 'Waiting for the tool response.',
    'stream.activity.responseUnavailable': 'No response data was recorded.',
    'stream.activity.viewResponse': 'View response',
    'stream.activity.responseError': 'The response could not be loaded.',
    'stream.activity.paneCollapse': 'Collapse activity',
    'stream.activity.paneExpand': 'Expand activity',
    'stream.activity.retry': 'Retry response',
    'stream.activity.stepProgress': `${options?.current} of ${options?.total} steps`,
    'stream.activity.mobileDetailsAria': `Show all activity steps (${options?.status || ''})`,
    'stream.activity.resizePaneAria': 'Resize tool activity pane',
    'stream.activity.viewArtifact': 'View',
    'stream.activity.downloadArtifact': 'Download',
    'stream.activity.artifactError': 'Artifact error',
    'stream.activity.generated': 'Generated',
    'stream.activity.tool.runCommand': 'Run command',
  }[key] || key) }),
}));

describe('ConversationAssistantBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redactSensitiveText = true;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.writeClipboard } });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
  });

  it('shows the working fallback on mobile before the first component arrives', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming
      showWorking
      components={[]}
    />);

    expect(container.querySelector('[data-mobile-working]')).toHaveClass('md:hidden');
    expect(screen.getAllByText('Using tools')).toHaveLength(2);
  });

  it('renders activity in arrival order and keeps the answer outside the activity pane', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: 'Preparing workspace analysis', status: 'completed', startedAt: '2026-08-27T10:00:00Z' } },
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Compare selected files', renderKind: 'run_code', status: 'completed', startedAt: '2026-08-27T10:01:00Z', completedAt: '2026-08-27T10:02:00Z', durationMs: 1400 } },
        { id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-1', filename: 'revenue-variance.xlsx', producerToolId: 'tool-1', availability: 'ready' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', summary: 'Verify the late event', renderKind: 'search', status: 'completed', startedAt: '2026-08-27T09:00:00Z', completedAt: '2026-08-27T09:01:00Z' } },
        { id: 'text-1', type: 'text', data: { content: 'Revenue is below forecast.' } },
      ]}
    />);

    const bubble = screen.getByTestId('conversation-assistant-bubble');
    const desktop = bubble.querySelector('[data-desktop-activity]') as HTMLElement;
    const nodes = [
      within(desktop).getByText(/Preparing workspace analysis/),
      within(desktop).getByText(/Compare selected files/),
      within(desktop).getByText('revenue-variance.xlsx'),
      within(desktop).getByText(/Verify the late event/),
      screen.getByText(/Revenue is below forecast/),
    ];
    nodes.forEach((node) => expect(bubble).toContainElement(node));
    for (let index = 1; index < nodes.length; index += 1) {
      expect(nodes[index - 1].compareDocumentPosition(nodes[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(bubble.textContent).not.toContain('storagePath');
    expect(desktop.querySelector('[data-tool-sequence]')).not.toBeInTheDocument();
    expect(bubble.querySelector('[data-activity-pane]')).toHaveStyle({ minHeight: '80px', maxHeight: '320px' });
    expect(bubble.querySelector('[data-activity-pane]')).toHaveAttribute('data-auto-sized', 'true');
    expect(bubble.querySelector('[data-activity-pane]')).toHaveClass('overflow-y-auto');
    expect(bubble.querySelector('[data-activity-pane]')).not.toHaveClass('overscroll-contain');
    expect(within(desktop).getByRole('button', { name: /Compare selected files/ })).toHaveClass('min-h-7');
    expect(desktop).not.toHaveClass('space-y-1');
    expect(bubble.querySelector('[data-activity-pane]')).not.toContainElement(nodes.at(-1) as HTMLElement);
  });

  it('opens the mobile activity timeline with a pointer click', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'Find revenue', status: 'completed', renderKind: 'search' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', summary: 'Verify totals', status: 'completed', renderKind: 'search' } },
      ]}
    />);
    const trigger = screen.getByRole('button', { name: 'Show all activity steps (Completed)' });
    const contentId = trigger.getAttribute('aria-controls') as string;
    const content = document.getElementById(contentId) as HTMLElement;

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(content).toHaveAttribute('hidden');
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(content).not.toHaveAttribute('hidden');
    expect(content).toHaveTextContent('Find revenue');
  });

  it('autoscrolls the activity pane when a row arrives', async () => {
    const { container, rerender } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming
      components={[{ id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'First step', status: 'completed', renderKind: 'search' } }]}
    />);
    const pane = container.querySelector('[data-activity-pane]') as HTMLElement;
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 480 });
    pane.scrollTop = 0;

    rerender(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming
      components={[
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'First step', status: 'completed', renderKind: 'search' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', summary: 'Second step', status: 'running', renderKind: 'search' } },
      ]}
    />);

    await waitFor(() => expect(pane.scrollTop).toBe(480));
    expect(container.querySelector('[data-tool-sequence]')).not.toBeInTheDocument();
  });

  it('keeps an earlier activity row visible when detailed reasoning arrives', () => {
    const { container, rerender } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming
      components={[{ id: 'activity-1', type: 'agentActivity', data: { summary: '', status: 'running' } }]}
    />);

    expect(container.querySelectorAll('[data-agent-summary]')).toHaveLength(1);
    expect(container.querySelector('[data-agent-summary]')).toHaveTextContent('Preparing your request');

    rerender(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: '', status: 'completed' } },
        { id: 'activity-2', type: 'agentActivity', data: { summary: 'Inspect the financial report', status: 'running' } },
      ]}
    />);

    const summaries = container.querySelectorAll('[data-agent-summary]');
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toHaveTextContent('Preparing your request');
    expect(summaries[1]).toHaveTextContent('Inspect the financial report');
    expect(container.querySelector('[data-desktop-activity]')).not.toHaveTextContent('Activity');
  });

  it('distinguishes repeated tool rows by their activity descriptions', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'Search the annual report', status: 'completed', renderKind: 'search' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', summary: 'Verify the balance sheet', status: 'completed', renderKind: 'search' } },
      ]}
    />);

    expect(screen.getByRole('button', { name: 'Search the annual report, Tool response: Search (Completed)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify the balance sheet, Tool response: Search (Completed)' })).toBeInTheDocument();
  });

  it('expands an activity row to show complete multiline reasoning', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'activity-1',
        type: 'agentActivity',
        data: {
          summary: 'Inspect the reports',
          detail: 'First inspect the complete 2023 report.\nThen compare every 2025 ratio without truncation.',
          status: 'completed',
        },
      }]}
    />);

    const trigger = screen.getByRole('button', { name: 'Inspect the reports, Completed. Show full reasoning' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Then compare every 2025 ratio/)).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/First inspect the complete 2023 report.*Then compare every 2025 ratio/s)).toHaveClass('whitespace-pre-wrap');
  });

  it('redacts sensitive expanded reasoning details', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'activity-1',
        type: 'agentActivity',
        data: {
          summary: 'Inspect the private report safely',
          detail: 'Read /workspace/private/report.pdf with authorization=Bearer-private-token',
          status: 'completed',
        },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Inspect the private report safely, Completed. Show full reasoning' }));

    const details = screen.getByText('[REDACTED]');
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveTextContent('/workspace/private');
    expect(details).not.toHaveTextContent('Bearer-private-token');
  });

  it('keeps desktop activity visible and supports keyboard resizing', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'Find revenue', status: 'completed', renderKind: 'search' } }]}
    />);
    const pane = container.querySelector('[data-activity-pane]');
    const separator = screen.getByRole('separator', { name: 'Resize tool activity pane' });
    expect(pane).toHaveStyle({ minHeight: '80px', maxHeight: '320px' });
    expect(separator).toHaveAttribute('aria-valuenow', '80');
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(pane).toHaveStyle({ height: '96px' });
    expect(pane).not.toHaveAttribute('data-auto-sized');
    expect(separator).toHaveAttribute('aria-valuenow', '96');
    fireEvent.pointerDown(separator, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientY: 200, pointerId: 2 });
    expect(pane).toHaveStyle({ height: '96px' });
    fireEvent.pointerMove(separator, { clientY: 140, pointerId: 1 });
    expect(pane).toHaveStyle({ height: '136px' });
    fireEvent.pointerUp(separator, { pointerId: 1 });
    fireEvent.keyDown(separator, { key: 'Home' });
    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(pane).toHaveStyle({ height: '80px' });
    fireEvent.keyDown(separator, { key: 'End' });
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(pane).toHaveStyle({ height: '480px' });
    fireEvent.pointerDown(separator, { button: 0, clientY: 100, pointerId: 3 });
    fireEvent.lostPointerCapture(separator, { pointerId: 3 });
    fireEvent.pointerMove(separator, { clientY: 50, pointerId: 3 });
    expect(pane).toHaveStyle({ height: '480px' });
    expect(screen.getAllByText(/Find revenue/)).not.toHaveLength(0);
  });

  it('uses detailed reasoning instead of a one-word activity summary and omits its text replay', () => {
    const detail = 'I am checking the official revenue statement before preparing the answer.';
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: 'statement', detail, status: 'completed' } },
        { id: 'reasoning-replay', type: 'text', data: { content: detail } },
        { id: 'answer', type: 'text', data: { content: 'Revenue was 33.9 million euros.' } },
      ]}
    />);

    expect(screen.getByRole('button', { name: `${detail}, Completed. Show full reasoning` })).toHaveTextContent('I am checking the official revenue statement');
    expect(container.querySelector('[data-answer-content]')).toHaveTextContent('Revenue was 33.9 million euros.');
    expect(container.querySelector('[data-answer-content]')).not.toHaveTextContent(detail);
  });

  it('filters standalone one-word activity fragments while preserving planning, tools, and the answer', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'initial', type: 'agentActivity', data: { summary: '', status: 'completed' } },
        { id: 'activity-start', type: 'agentActivity', data: { summary: 'start', detail: ' start', status: 'completed' } },
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'activate_skill', summary: '', status: 'completed', renderKind: 'generic' } },
        { id: 'activity-contracts', type: 'agentActivity', data: { summary: 'contracts', detail: ' contracts', status: 'completed' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', summary: 'Find the SFR contract', status: 'completed', renderKind: 'search' } },
        { id: 'activity-parallel', type: 'agentActivity', data: { summary: 'parallel', detail: ' parallel', status: 'completed' } },
        { id: 'activity-call', type: 'agentActivity', data: { summary: 'call', detail: ' call', status: 'completed' } },
        { id: 'activity-now', type: 'agentActivity', data: { summary: 'now', detail: ' now', status: 'completed' } },
        { id: 'answer', type: 'text', data: { content: 'Revenue was 33.9 million euros.' } },
      ]}
    />);

    expect(container.querySelectorAll('[data-agent-summary]')).toHaveLength(1);
    expect(container.querySelector('[data-agent-summary]')).toHaveTextContent('Preparing your request');
    expect(container.querySelector('[data-desktop-activity]')).not.toHaveTextContent(/start|contracts|parallel|call|now/);
    expect(container.querySelector('[data-desktop-activity]')).not.toHaveTextContent('Activity');
    expect(screen.getAllByText(/Activate Skill/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Find the SFR contract/)).not.toHaveLength(0);
    expect(screen.getByText('Revenue was 33.9 million euros.')).toBeInTheDocument();
  });

  it('filters persisted short thought fragments around tools', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'get_document_strategy', summary: 'Get the document strategy', status: 'completed', resultJson: JSON.stringify({ files: [{}, {}, {}, {}] }) } },
        { id: 'activity-echo', type: 'agentActivity', data: { summary: '4 Files', detail: '4 Files', status: 'completed' } },
        { id: 'activity-fragment', type: 'agentActivity', data: { summary: 'sections now', detail: 'sections now', status: 'completed' } },
        { id: 'activity-uncased-script', type: 'agentActivity', data: { summary: '检查合同', detail: '检查合同', status: 'completed' } },
        { id: 'activity-four-words', type: 'agentActivity', data: { summary: 'search,read,compare,respond', detail: 'search,read,compare,respond', status: 'completed' } },
        { id: 'activity-reasoning', type: 'agentActivity', data: { summary: 'Analyze retrieved files', detail: 'Analyze retrieved files', status: 'completed' } },
      ]}
    />);

    expect(screen.queryByText('4 Files')).not.toBeInTheDocument();
    expect(screen.queryByText('sections now')).not.toBeInTheDocument();
    expect(screen.getAllByText('检查合同')).not.toHaveLength(0);
    expect(screen.getAllByText('search,read,compare,respond')).not.toHaveLength(0);
    expect(screen.getAllByText('Analyze retrieved files')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Get the document strategy, Tool response: Get Document Strategy (Completed)' })).toBeInTheDocument();
  });

  it('removes concatenated summary-only reasoning from persisted answer components', () => {
    const firstSummary = 'I am checking the official revenue statement before preparing the answer.';
    const secondSummary = 'I am comparing the confirmed figures with the prior reporting period.';
    const activity = [
      { id: 'activity-1', type: 'agentActivity' as const, data: { summary: firstSummary, status: 'completed' as const } },
      { id: 'activity-2', type: 'agentActivity' as const, data: { summary: secondSummary, status: 'completed' as const } },
    ];
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={activity}
      answerComponents={[{ id: 'answer', type: 'text', data: { content: `${firstSummary}${secondSummary}\n\n## Revenue\nRevenue was 33.9 million euros.` } }]}
    />);

    const answer = container.querySelector('[data-answer-content]');
    expect(answer).toHaveTextContent('Revenue was 33.9 million euros.');
    expect(answer).not.toHaveTextContent(firstSummary);
    expect(answer).not.toHaveTextContent(secondSummary);
  });

  it('removes replayed reasoning when persisted activity previews are truncated', () => {
    const firstPreview = 'I am inspecting the complete financial report and comparing every relevant ratio before preparing the final response for the user...';
    const secondPreview = 'I am validating the supporting citations and checking every reported figure before I provide the final documented conclusion...';
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: firstPreview, detail: firstPreview, status: 'completed' } },
        { id: 'activity-2', type: 'agentActivity', data: { summary: secondPreview, detail: secondPreview, status: 'completed' } },
        { id: 'answer', type: 'text', data: { content: `${firstPreview.slice(0, -3)} with additional details.${secondPreview.slice(0, -3)} with the final checks.# Confirmed answer\nRevenue was 33.9 million euros.` } },
      ]}
    />);

    expect(screen.getByRole('heading', { name: 'Confirmed answer' })).toBeInTheDocument();
    expect(screen.getByText('Revenue was 33.9 million euros.')).toBeInTheDocument();
    expect(screen.queryByText(/additional details/)).not.toBeInTheDocument();
    expect(screen.queryByText(/final checks/)).not.toBeInTheDocument();
  });

  it('preserves a legitimate answer that begins with a truncated activity preview', () => {
    const preview = 'I am summarizing the verified financial evidence and its implications before presenting the complete documented answer to the user...';
    const introduction = `${preview.slice(0, -3)} with important context that belongs in the answer.`;
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: preview, detail: preview, status: 'completed' } },
        { id: 'answer', type: 'text', data: { content: `${introduction}\n## Results\nRevenue was 33.9 million euros.` } },
      ]}
    />);

    expect(screen.getByText(new RegExp(introduction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
  });

  it('preserves an ambiguous truncated replay followed by a plain-text answer', () => {
    const preview = 'I am reviewing the evidence carefully before writing a concise response based only on the supplied and verified financial documents...';
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: preview, detail: preview, status: 'completed' } },
        { id: 'answer', type: 'text', data: { content: `${preview.slice(0, -3)} with more reasoning.The final answer is 42.` } },
      ]}
    />);

    expect(screen.getByText(/with more reasoning\.The final answer is 42\./)).toBeInTheDocument();
  });

  it('keeps a short final answer that matches a short activity detail', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: 'Done', detail: 'Yes', status: 'completed' } },
        { id: 'answer', type: 'text', data: { content: 'Yes' } },
      ]}
    />);

    expect(container.querySelector('[data-answer-content]')).toHaveTextContent('Yes');
  });

  it('keeps every generated historical activity row', () => {
    const repeatedDetail = 'Inspect the 2023 report. Inspect the revenue table.';
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'initial', type: 'agentActivity', data: { summary: '', status: 'completed' } },
        { id: 'activity-1', type: 'agentActivity', data: { summary: '', detail: repeatedDetail + repeatedDetail, status: 'completed', actorId: 'agent-1' } },
        { id: 'narration', type: 'text', data: { content: 'I will inspect the report.' } },
        { id: 'activity-2', type: 'agentActivity', data: { summary: '', detail: repeatedDetail, status: 'completed', actorId: 'agent-1' } },
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'Search report', status: 'completed', renderKind: 'search' } },
        { id: 'activity-3', type: 'agentActivity', data: { summary: '', detail: repeatedDetail, status: 'completed', actorId: 'agent-1' } },
        { id: 'answer', type: 'text', data: { content: 'Revenue was found.' } },
      ]}
    />);

    expect(screen.getByRole('button', { name: 'Preparing your request, Completed. Show full reasoning' })).toBeInTheDocument();
    const activityRows = screen.getAllByRole('button', { name: `${repeatedDetail}, Completed. Show full reasoning` });
    expect(activityRows).toHaveLength(3);
    fireEvent.click(activityRows[0]);
    expect(screen.getByText(repeatedDetail, { selector: '[data-agent-detail-card] p' })).toBeInTheDocument();
    expect(screen.queryByText(repeatedDetail + repeatedDetail)).not.toBeInTheDocument();
    expect(screen.getByText('Revenue was found.')).toBeInTheDocument();
  });

  it('uses authoritative duration formatting and renders stopped state without a success label', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'tool-1', type: 'toolActivity', data: { toolName: 'custom', fallbackDisplayName: 'Custom tool', summary: 'Check data', renderKind: 'generic', status: 'stopped', durationMs: 67_000 } }]}
    />);

    expect(screen.getByText(/1m 07s/)).toBeInTheDocument();
    expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();
  });

  it('renders safe planning and descriptive tools instead of a generic tool row', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: '   ', status: 'completed' } },
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'perform_standard_search', summary: 'quarterly revenue', renderKind: 'search', status: 'completed' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'run_code', summary: 'Calculate the totals', renderKind: 'run_code', status: 'completed' } },
      ]}
    />);

    expect(screen.getByText(/Preparing your request/)).toBeInTheDocument();
    expect(screen.getByText(/quarterly revenue/)).toBeInTheDocument();
    expect(screen.getAllByText(/Calculate the totals/)).not.toHaveLength(0);
    expect(screen.queryByText('stream.activity.toolFallback')).not.toBeInTheDocument();
    expect(screen.queryByText(/private code/)).not.toBeInTheDocument();
  });

  it('keeps the reasoning summary visible while moving the full tool name into compact details', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-map',
        type: 'toolActivity',
        data: {
          toolName: 'smart_navigation_search_paddle_read_document_map',
          summary: 'Getting the page count and structure of the 2025 annual financial report.',
          status: 'completed',
          renderKind: 'document',
          paramsJson: JSON.stringify({ document: 'annual-report.pdf' }),
          resultJson: JSON.stringify({ pages: 82 }),
        },
      }]}
    />);

    const trigger = screen.getByRole('button', { name: 'Getting the page count and structure of the 2025 annual financial report., Tool response: Read document map (Completed)' });
    const toolName = trigger.querySelector('[data-tool-name]') as HTMLElement;
    const toolSummary = trigger.querySelector('[data-tool-summary]') as HTMLElement;
    expect(toolName).toHaveTextContent('Read document map');
    expect(toolSummary).toHaveTextContent('Getting the page count and structure');
    expect(toolSummary.compareDocumentPosition(toolName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-tool-full-name]')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(container.querySelector('[data-tool-detail-card]')).toBeInTheDocument();
    expect(container.querySelector('[data-tool-full-name]')).toHaveTextContent('Smart Navigation Search Paddle Read Document Map');
    expect(container.querySelector('[data-tool-full-description]')).toHaveTextContent('Getting the page count and structure');
    expect(container.querySelector('[data-tool-payload-group]')).toContainElement(screen.getByRole('button', { name: 'Request' }));
    const actions = container.querySelector('[data-tool-detail-actions]') as HTMLElement;
    const payloadGroup = container.querySelector('[data-tool-payload-group]') as HTMLElement;
    expect(actions.compareDocumentPosition(payloadGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'View response' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the agent name and activity animation while the tool is running', () => {
    const { container, rerender } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming
      components={[
        { id: 'activity-1', type: 'agentActivity', data: { summary: '', status: 'running' } },
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Read the research explanation', renderKind: 'run_code', status: 'running', actorName: 'smart_agent', actorId: 'private-agent-id', paramsJson: '{"path":"/tmp/private.txt"}' } },
      ]}
    />);

    expect(screen.getAllByText('Smart Agent')).not.toHaveLength(0);
    expect(screen.getByText(/Read the research explanation/)).toBeInTheDocument();
    expect(container.querySelector('[data-agent-activity]')).toHaveAttribute('data-active', 'true');
    expect(container.querySelector('[data-agent-spinner]')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-scan]')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-activity-spinner]')).toBeInTheDocument();
    expect(container.querySelector('[data-tool-spinner]')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-spinner]')).not.toHaveClass('motion-reduce:animate-none');
    expect(container.querySelector('[data-agent-scan]')).not.toHaveClass('motion-reduce:animate-none');
    expect(container.querySelector('[data-agent-activity-spinner]')).not.toHaveClass('motion-reduce:animate-none');
    expect(container.querySelector('[data-tool-spinner]')).not.toHaveClass('motion-reduce:animate-none');
    expect(container).not.toHaveTextContent('private-agent-id');
    expect(container).not.toHaveTextContent('/tmp/private.txt');

    rerender(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Read the research explanation', renderKind: 'run_code', status: 'running', actorName: 'smart_agent' } }]}
    />);

    expect(container.querySelector('[data-agent-activity]')).not.toHaveAttribute('data-active');
    expect(container.querySelector('[data-agent-spinner]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-agent-scan]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-agent-activity-spinner]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tool-spinner]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read the research explanation, Tool response: Run code (Running)' })).toBeInTheDocument();
  });

  it('opens a sanitized tool response modal without exposing private payload fields', async () => {
    mocks.fetchToolResult.mockResolvedValue({ resultJson: JSON.stringify({ message: 'Execution stopped', password: 'private', path: '/tmp/private.py', recordId: '507f1f77bcf86cd799439011', code: 'print("private")' }) });
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-1',
        type: 'toolActivity',
        data: {
          toolName: 'run_code',
          displayKey: 'runCode',
          summary: 'Wait safely',
          status: 'failed',
          renderKind: 'run_code',
          primaryInput: 'const result = await normalize(input);',
          primaryInputLanguage: 'typescript',
          resultJson: JSON.stringify({ message: 'Execution stopped', password: 'private', path: '/tmp/private.py', recordId: '507f1f77bcf86cd799439011', code: 'print("private")' }),
        },
      }]}
    />);

    const trigger = screen.getByRole('button', { name: 'Wait safely, Tool response: Run code (Failed)' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Execution stopped/)).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText(/Execution stopped/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText(/Execution stopped/)).toBeInTheDocument();
    expect(screen.queryByText(/private\.py|507f1f77bcf86cd799439011|print\(|"private"/)).not.toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
  });

  it('drills into code-interpreter commands and output while redacting private values', async () => {
    mocks.fetchToolResult.mockResolvedValue({ resultJson: JSON.stringify({ stdout: 'Created output.pdf', exit_code: 0, workspace_path: '/workspace/private/output.pdf' }) });
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-shell',
        type: 'toolActivity',
        data: {
          toolName: 'code_interpreter_shell_exec',
          displayKey: 'runCommand',
          summary: 'Convert the document to PDF',
          status: 'completed',
          renderKind: 'run_code',
          paramsJson: JSON.stringify({ command: 'pandoc source.md -o output.pdf', authorization: 'Bearer private' }),
          resultJson: JSON.stringify({ stdout: 'Created output.pdf', exit_code: 0, workspace_path: '/workspace/private/output.pdf' }),
        },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Convert the document to PDF, Tool response: Run command (Completed)' }));
    expect(screen.queryByText(/pandoc source\.md -o output\.pdf/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));

    expect(screen.getByText(/pandoc source\.md -o output\.pdf/)).toBeInTheDocument();
    expect(await screen.findByText(/Created output\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/"exit_code": 0/)).toBeInTheDocument();
    expect(screen.queryByText(/Bearer private|\/workspace\/private/)).not.toBeInTheDocument();
  });

  it('expands request and opens response details for a generic tool', async () => {
    mocks.fetchToolResult.mockResolvedValue({ resultJson: JSON.stringify({ matches: 4 }) });
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-search',
        type: 'toolActivity',
        data: {
          toolName: 'perform_standard_search', summary: 'Find revenue', status: 'completed', renderKind: 'search',
          paramsJson: JSON.stringify({ query: 'annual revenue' }), resultJson: JSON.stringify({ matches: 4 }),
        },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Find revenue, Tool response: Search (Completed)' }));

    expect(screen.queryByText(/annual revenue/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"matches": 4/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));
    expect(screen.getByText(/annual revenue/)).toBeInTheDocument();
    expect(await screen.findByText(/"matches": 4/)).toBeInTheDocument();
  });

  it('bounds a large raw tool response in the modal', async () => {
    mocks.fetchToolResult.mockResolvedValue({ resultJson: JSON.stringify({ rows: Array.from({ length: 100 }, (_, index) => ({ index, values: Array.from({ length: 30 }, (_, value) => value) })) }) });
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-search',
        type: 'toolActivity',
        data: {
          toolName: 'perform_standard_search', summary: 'Read matching files', status: 'completed', renderKind: 'search',
          resultJson: JSON.stringify({ rows: Array.from({ length: 100 }, (_, index) => ({ index, values: Array.from({ length: 30 }, (_, value) => value) })) }),
        },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Read matching files, Tool response: Search (Completed)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));

    const payload = await screen.findByText(/\[truncated\]/);
    expect(payload).toHaveTextContent('[truncated]');
    expect(payload.textContent?.length).toBeLessThan(12_100);
  });

  it('loads a streamed tool response from persistence on demand', async () => {
    mocks.fetchToolResult.mockResolvedValue({ resultJson: JSON.stringify({ matches: 4 }) });
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-search',
        type: 'toolActivity',
        data: {
          toolName: 'perform_standard_search', summary: 'Find revenue', status: 'completed', renderKind: 'search',
          resultJson: JSON.stringify({ matches: 4 }),
        },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Find revenue, Tool response: Search (Completed)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));

    expect(await screen.findByText(/"matches": 4/)).toBeInTheDocument();
    expect(mocks.fetchToolResult).toHaveBeenCalledWith('conversation-1', 'message-1', 'tool-search');
  });

  it('pulls the tool response on demand when the payload was not streamed', async () => {
    mocks.fetchToolResult.mockResolvedValue({ resultJson: JSON.stringify({ matches: 7 }) });
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-search',
        type: 'toolActivity',
        data: { toolName: 'perform_standard_search', summary: 'Find revenue', status: 'completed', renderKind: 'search' },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Find revenue, Tool response: Search (Completed)' }));
    expect(screen.queryByText(/"matches": 7/)).not.toBeInTheDocument();
    expect(mocks.fetchToolResult).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));

    await waitFor(() => expect(screen.getByText(/"matches": 7/)).toBeInTheDocument());
    expect(mocks.fetchToolResult).toHaveBeenCalledWith('conversation-1', 'message-1', 'tool-search');
  });

  it('reports when an on-demand tool response has no recorded payload', async () => {
    mocks.fetchToolResult.mockResolvedValue({ resultJson: null });
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-search',
        type: 'toolActivity',
        data: { toolName: 'perform_standard_search', summary: 'Find revenue', status: 'completed', renderKind: 'search' },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Find revenue, Tool response: Search (Completed)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));

    await waitFor(() => expect(screen.getByText('No response data was recorded.')).toBeInTheDocument());
    expect(container.querySelector('[data-tool-payload="response"]')).not.toBeInTheDocument();
  });

  it('surfaces a load failure for an on-demand tool response', async () => {
    mocks.fetchToolResult.mockRejectedValue(new Error('network down'));
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-search',
        type: 'toolActivity',
        data: { toolName: 'perform_standard_search', summary: 'Find revenue', status: 'completed', renderKind: 'search' },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Find revenue, Tool response: Search (Completed)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View response' }));

    await waitFor(() => expect(screen.getByText('The response could not be loaded.')).toBeInTheDocument());
  });

  it('renders the activity pane collapsed for completed messages until expanded', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'First step', status: 'completed', renderKind: 'search' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', summary: 'Second step', status: 'completed', renderKind: 'search' } },
      ]}
    />);

    const shell = container.querySelector('[data-activity-pane-shell]') as HTMLElement;
    expect(shell).toHaveAttribute('data-collapsed');
    const toggle = screen.getByRole('button', { name: 'Expand activity' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(shell).not.toHaveAttribute('data-collapsed');
    expect(screen.getByRole('button', { name: 'Collapse activity' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the pane open while streaming and collapses it after the answer completes', () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<ConversationAssistantBubble
        conversationId='conversation-1'
        messageId='message-1'
        isStreaming
        components={[{ id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'First step', status: 'completed', renderKind: 'search' } }]}
      />);
      expect(container.querySelector('[data-activity-pane-shell]')).not.toHaveAttribute('data-collapsed');

      rerender(<ConversationAssistantBubble
        conversationId='conversation-1'
        messageId='message-1'
        isStreaming={false}
        justCompleted
        components={[{ id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'First step', status: 'completed', renderKind: 'search' } }]}
      />);
      expect(container.querySelector('[data-activity-pane-shell]')).not.toHaveAttribute('data-collapsed');

      act(() => { vi.advanceTimersByTime(1_000); });
      expect(container.querySelector('[data-activity-pane-shell]')).toHaveAttribute('data-collapsed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks completed tools with a green check icon', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'First step', status: 'completed', renderKind: 'search' } }]}
    />);

    const status = container.querySelector('[data-tool-status="completed"]');
    expect(status?.querySelector('svg')).toHaveClass('text-green-500');
  });

  it('shows full tool metadata without repeating response totals on tool rows', async () => {
    const summary = 'Locate every citation for the financial comparison across both annual reports, verify each source passage, and preserve the complete description so the final clause remains visible after expansion.';
    const completedAt = '2026-08-27T10:02:00Z';
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        {
          id: 'tool-search',
          type: 'toolActivity',
          data: {
            toolName: 'perform_standard_search', summary, status: 'completed', renderKind: 'search', completedAt,
            paramsJson: JSON.stringify({ query: 'annual revenue' }), resultJson: JSON.stringify({ matches: 4 }),
          },
        },
        {
          id: 'tool-code',
          type: 'toolActivity',
          data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Calculate totals', status: 'completed', renderKind: 'run_code' },
        },
      ]}
    />);

    const trigger = screen.getByRole('button', { name: /^Locate every citation.*Tool response: Search \(Completed\)$/ });
    expect(trigger).not.toHaveTextContent('final clause remains visible after expansion');
    fireEvent.click(trigger);

    expect(container.querySelector('[data-tool-full-description]')).toHaveTextContent(summary);
    expect(screen.queryByText('Description')).not.toBeInTheDocument();
    const timestamp = container.querySelector('[data-tool-timestamp]') as HTMLElement;
    const copyButton = screen.getByRole('button', { name: 'Copy tool details' });
    const fullTimestamp = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(completedAt));
    expect(timestamp).toHaveTextContent(new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(completedAt)));
    expect(timestamp).toHaveAttribute('title', fullTimestamp);
    expect(timestamp).toHaveAccessibleName(fullTimestamp);
    expect(timestamp).not.toHaveTextContent('Timestamp');
    expect(timestamp.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate totals, Tool response: Run code (Completed)' }));
    expect(container.querySelector('[data-tool-token-usage]')).not.toBeInTheDocument();

    fireEvent.click(copyButton);
    await waitFor(() => expect(mocks.writeClipboard).toHaveBeenCalledWith(expect.stringContaining(summary)));
    expect(mocks.writeClipboard).toHaveBeenCalledWith(expect.stringContaining('annual revenue'));
    expect(mocks.writeClipboard).not.toHaveBeenCalledWith(expect.stringContaining('Response tokens'));
  });

  it('falls back to the valid start timestamp when completion time is invalid', () => {
    const startedAt = '2026-08-27T09:58:00Z';
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-search',
        type: 'toolActivity',
        data: { toolName: 'perform_standard_search', summary: 'Find revenue', status: 'completed', renderKind: 'search', completedAt: 'invalid', startedAt },
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Find revenue, Tool response: Search (Completed)' }));

    const timestamp = container.querySelector('[data-tool-timestamp]') as HTMLElement;
    const fullTimestamp = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(startedAt));
    expect(timestamp).toHaveTextContent(new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(startedAt)));
    expect(timestamp).toHaveAttribute('title', fullTimestamp);
  });

  it('keeps visible text and renders punctuation-only activity components with the planning fallback', () => {
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'punctuation-1', type: 'agentActivity', data: { summary: '.', detail: '.', status: 'completed' } },
        { id: 'answer', type: 'text', data: { content: 'Your AI summary is ready.' } },
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', summary: 'Generate the PDF', status: 'completed', renderKind: 'run_code' } },
        { id: 'artifact-1', type: 'artifact', data: { artifactId: 'artifact-1', filename: 'AI_Summary.pdf', availability: 'ready' } },
        { id: 'punctuation-2', type: 'agentActivity', data: { summary: '.', detail: '.', status: 'completed' } },
      ]}
    />);

    expect(screen.getByText('Your AI summary is ready.')).toBeInTheDocument();
    expect(screen.getAllByText('AI_Summary.pdf')).not.toHaveLength(0);
    expect(container.querySelectorAll('[data-agent-summary]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-agent-summary]')[0]).toHaveTextContent('Preparing your request');
  });

  it('shows tool states, mobile progress, and retry for a failed response', () => {
    const retry = vi.fn();
    const { container } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      onRetry={retry}
      components={[
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'First step', status: 'completed', renderKind: 'search' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', summary: 'Second step', status: 'stopped', renderKind: 'search' } },
        { id: 'tool-3', type: 'toolActivity', data: { toolName: 'search', summary: 'Final step', status: 'failed', renderKind: 'search' } },
      ]}
    />);

    expect(container.querySelector('[data-tool-status="completed"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tool-status="stopped"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tool-status="failed"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tool-spinner]')).not.toBeInTheDocument();
    expect(screen.getByText('3 of 3 steps')).toBeInTheDocument();
    expect(container.querySelector('[data-activity-pane]')).toHaveStyle({ minHeight: '80px', maxHeight: '320px' });
    expect(container.querySelector('[data-activity-pane]')).toHaveClass('overflow-y-auto');
    expect(container.querySelector('[data-tool-sequence]')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-tool-spinner]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Final step, Tool response: Search (Failed)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry response' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('provides independent view and download actions for generated artifacts', async () => {
    mocks.getArtifactDownloadUrl.mockResolvedValue({
      viewUrl: 'https://storage.example/view',
      downloadUrl: 'https://storage.example/download',
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-1', filename: 'report.pdf', mimeType: 'application/pdf', availability: 'ready' } }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(mocks.openFileViewerFromUrlLoader).toHaveBeenCalledWith(
      JSON.stringify(['conversation-1', 'message-1', 'opaque-1']),
      'report.pdf',
      'application/pdf',
      expect.any(Function),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    expect(mocks.getArtifactDownloadUrl).toHaveBeenCalledTimes(2);
    anchorClick.mockRestore();
  });

  it('does not render attachment sentinels or internal workspace paths from answer text', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'text-1', type: 'text', data: { content: '{"content":"YELLOWSTORM_ATTACHMENT_SENTINEL_123\\n"} Read /workspace/sources/id/private.pdf' } }]}
    />);

    expect(screen.queryByText(/YELLOWSTORM_ATTACHMENT_SENTINEL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/workspace/)).not.toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
  });

  it('renders internal paths when sensitive text redaction is disabled', () => {
    mocks.redactSensitiveText = false;
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'text-1', type: 'text', data: { content: 'Read /workspace/sources/id/private.pdf' } }]}
    />);

    expect(screen.getByText(/\/workspace\/sources\/id\/private.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/\[REDACTED\]/)).not.toBeInTheDocument();
  });

  it('renders unsafe activity with a safe fallback and reduces file paths to a filename', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'activity-unsafe', type: 'agentActivity', data: { summary: 'Review_record_507f1f77bcf86cd799439011', status: 'completed' } },
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', summary: 'const secret = token;', renderKind: 'run_code', status: 'completed' } },
        { id: 'tool-2', type: 'toolActivity', data: { toolName: 'read_file', summary: 'customer.csv', renderKind: 'read', status: 'completed' } },
        { id: 'tool-3', type: 'toolActivity', data: { toolName: 'custom_tool', summary: 'users/12345678/runs/run-1/private.json', renderKind: 'generic', status: 'completed' } },
        { id: 'tool-4', type: 'toolActivity', data: { toolName: 'custom_tool', summary: 'YELLOWSTORM_ATTACHMENT_SENTINEL_42', renderKind: 'generic', status: 'completed' } },
        { id: 'tool-5', type: 'toolActivity', data: { toolName: 'custom_tool', summary: 'file=/tmp/private/customer.csv', renderKind: 'generic', status: 'completed' } },
        { id: 'tool-6', type: 'toolActivity', data: { toolName: 'custom_tool', summary: 'path=C:\\private\\customer.csv', renderKind: 'generic', status: 'completed' } },
        { id: 'tool-7', type: 'toolActivity', data: { toolName: 'custom_tool', summary: 'uri=s3://private-bucket/customer.csv', renderKind: 'generic', status: 'completed' } },
        { id: 'tool-8', type: 'toolActivity', data: { toolName: 'custom_tool', summary: '', renderKind: 'generic', status: 'completed', actorName: 'Research_507f1f77bcf86cd799439011' } },
        { id: 'tool-9', type: 'toolActivity', data: { toolName: 'custom_507f1f77bcf86cd799439011', summary: '', renderKind: 'generic', status: 'completed' } },
        { id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-artifact', filename: '/tmp/private/report.csv', availability: 'ready' } },
      ]}
    />);

    expect(screen.getByText(/customer.csv/)).toBeInTheDocument();
    expect(screen.queryByText(/const secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/tmp\/private/)).not.toBeInTheDocument();
    expect(screen.queryByText(/12345678\/runs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/YELLOWSTORM_ATTACHMENT_SENTINEL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/file=\/tmp/)).not.toBeInTheDocument();
    expect(screen.queryByText(/path=C:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/s3:\/\//)).not.toBeInTheDocument();
    expect(screen.queryByText(/507f1f77bcf86cd799439011/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Assistant')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Preparing your request, Completed. Show full reasoning' })).toBeInTheDocument();
    expect(document.querySelector('[data-desktop-activity]')).not.toHaveTextContent('Activity');
    expect(screen.getAllByText('report.csv')).not.toHaveLength(0);
    expect(screen.queryByText(/\/tmp\/private\/report/)).not.toBeInTheDocument();
    expect(document.querySelector('[id*="opaque-artifact"]')).not.toBeInTheDocument();
  });
});
