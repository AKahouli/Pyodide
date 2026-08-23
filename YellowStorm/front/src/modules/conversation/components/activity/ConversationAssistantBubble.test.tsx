import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationAssistantBubble } from './ConversationAssistantBubble';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, options?: { tool?: string }) => ({
    'stream.activity.thought': 'Reflection',
    'stream.activity.reasoningPlanning': 'Planning how to complete your request',
    'stream.activity.assistant': 'Assistant',
    'stream.activity.tool.runCode': 'Run code',
    'stream.activity.tool.search': 'Search',
    'stream.activity.output': 'Output',
    'stream.activity.responseTitle': `Tool response: ${options?.tool || ''}`,
    'stream.activity.openArtifact': 'Open',
    'stream.activity.generated': 'Generated',
  }[key] || key) }),
}));

describe('ConversationAssistantBubble', () => {
  it('renders activity, artifact, and answer in exact order inside one bubble', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'reasoning-1', type: 'reasoning', data: { summary: 'Preparing workspace analysis', status: 'completed' } },
        { id: 'tool-1', type: 'toolInfo', data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Compare selected files', renderKind: 'run_code', status: 'completed', durationMs: 1400 } },
        { id: 'artifact-1', type: 'artifact', data: { artifactId: 'opaque-1', filename: 'revenue-variance.xlsx', producerToolId: 'tool-1', availability: 'ready' } },
        { id: 'text-1', type: 'text', data: { content: 'Revenue is below forecast.' } },
      ]}
    />);

    const bubble = screen.getByTestId('conversation-assistant-bubble');
    const nodes = [
      screen.getByText(/Preparing workspace analysis/),
      screen.getByText(/Compare selected files/),
      screen.getByText('revenue-variance.xlsx'),
      screen.getByText(/Revenue is below forecast/),
    ];
    nodes.forEach((node) => expect(bubble).toContainElement(node));
    for (let index = 1; index < nodes.length; index += 1) {
      expect(nodes[index - 1].compareDocumentPosition(nodes[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(bubble.textContent).not.toContain('storagePath');
  });

  it('uses authoritative duration formatting and renders stopped state without a success label', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'tool-1', type: 'toolInfo', data: { toolName: 'custom', fallbackDisplayName: 'Custom tool', summary: 'Check data', renderKind: 'generic', status: 'stopped', durationMs: 67_000 } }]}
    />);

    expect(screen.getByText(/1m 07s/)).toBeInTheDocument();
    expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();
  });

  it('renders safe planning and descriptive legacy tools instead of a generic tool row', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'reasoning-1', type: 'reasoning', data: { summary: '   ', status: 'completed' } },
        { id: 'tool-1', type: 'toolInfo', data: { title: 'perform_standard_search', status: 'completed', params: '{"query":"quarterly revenue"}' } },
        { id: 'tool-2', type: 'toolInfo', data: { title: 'run_code', status: 'completed', params: { description: 'Calculate the totals', code: 'private code' } } },
      ]}
    />);

    expect(screen.getByText(/Planning how to complete your request/)).toBeInTheDocument();
    expect(screen.getByText(/quarterly revenue/)).toBeInTheDocument();
    expect(screen.getByText(/Calculate the totals/)).toBeInTheDocument();
    expect(screen.queryByText('stream.activity.toolFallback')).not.toBeInTheDocument();
    expect(screen.queryByText(/private code/)).not.toBeInTheDocument();
  });

  it('shows the agent name and activity animation while the tool is running', () => {
    const { container, rerender } = render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming
      components={[
        { id: 'reasoning-1', type: 'reasoning', data: { summary: '', status: 'completed' } },
        { id: 'tool-1', type: 'toolInfo', data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Read the research explanation', renderKind: 'run_code', status: 'running', actorName: 'smart_agent', actorId: 'private-agent-id', paramsJson: '{"path":"/tmp/private.txt"}' } },
      ]}
    />);

    expect(screen.getByText('Smart Agent')).toBeInTheDocument();
    expect(screen.getByText(/Read the research explanation/)).toBeInTheDocument();
    expect(container.querySelector('[data-agent-activity]')).toHaveAttribute('data-active', 'true');
    expect(container.querySelector('[data-agent-spinner]')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-scan]')).toBeInTheDocument();
    expect(container.querySelector('[data-reasoning-spinner]')).toBeInTheDocument();
    expect(container.querySelector('[data-tool-spinner]')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('private-agent-id');
    expect(container).not.toHaveTextContent('/tmp/private.txt');

    rerender(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{ id: 'tool-1', type: 'toolInfo', data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Read the research explanation', renderKind: 'run_code', status: 'running', actorName: 'smart_agent' } }]}
    />);

    expect(container.querySelector('[data-agent-activity]')).not.toHaveAttribute('data-active');
    expect(container.querySelector('[data-agent-spinner]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-agent-scan]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-reasoning-spinner]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tool-spinner]')).not.toBeInTheDocument();
  });

  it('opens a sanitized tool response without exposing private payload fields', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[{
        id: 'tool-1',
        type: 'toolInfo',
        data: {
          toolName: 'run_code',
          displayKey: 'runCode',
          summary: 'Wait safely',
          status: 'failed',
          resultJson: JSON.stringify({ message: 'Execution stopped', password: 'private', path: '/tmp/private.py', recordId: '507f1f77bcf86cd799439011', code: 'print("private")' }),
        },
      }]}
    />);

    const trigger = screen.getByRole('button', { name: 'Tool response: Run code' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Execution stopped/)).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText(/Execution stopped/)).toBeInTheDocument();
    expect(screen.queryByText(/private\.py|507f1f77bcf86cd799439011|print\(|"private"/)).not.toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
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

  it('suppresses unsafe tool summaries and reduces file paths to a filename', () => {
    render(<ConversationAssistantBubble
      conversationId='conversation-1'
      messageId='message-1'
      isStreaming={false}
      components={[
        { id: 'reasoning-unsafe', type: 'reasoning', data: { summary: 'Review_record_507f1f77bcf86cd799439011', status: 'completed' } },
        { id: 'tool-1', type: 'toolInfo', data: { toolName: 'run_code', summary: 'const secret = token;', status: 'completed' } },
        { id: 'tool-2', type: 'toolInfo', data: { title: 'read_file', status: 'completed', params: { path: '/tmp/private/customer.csv' } } },
        { id: 'tool-3', type: 'toolInfo', data: { title: 'custom_tool', description: 'users/12345678/runs/run-1/private.json', status: 'completed' } },
        { id: 'tool-4', type: 'toolInfo', data: { title: 'custom_tool', description: 'YELLOWSTORM_ATTACHMENT_SENTINEL_42', status: 'completed' } },
        { id: 'tool-5', type: 'toolInfo', data: { title: 'custom_tool', description: 'file=/tmp/private/customer.csv', status: 'completed' } },
        { id: 'tool-6', type: 'toolInfo', data: { title: 'custom_tool', description: 'path=C:\\private\\customer.csv', status: 'completed' } },
        { id: 'tool-7', type: 'toolInfo', data: { title: 'custom_tool', description: 'uri=s3://private-bucket/customer.csv', status: 'completed' } },
        { id: 'tool-8', type: 'toolInfo', data: { title: 'custom_tool', status: 'completed', actorName: 'Research_507f1f77bcf86cd799439011' } },
        { id: 'tool-9', type: 'toolInfo', data: { title: 'custom_507f1f77bcf86cd799439011', status: 'completed' } },
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
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText(/Planning how to complete your request/)).toBeInTheDocument();
    expect(screen.getByText('report.csv')).toBeInTheDocument();
    expect(screen.queryByText(/\/tmp\/private\/report/)).not.toBeInTheDocument();
    expect(document.querySelector('[id*="opaque-artifact"]')).not.toBeInTheDocument();
  });
});
