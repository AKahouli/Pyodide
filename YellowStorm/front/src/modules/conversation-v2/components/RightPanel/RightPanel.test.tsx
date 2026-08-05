import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { RightPanel } from './RightPanel';
import { useConversationV2Store } from '../../store';

vi.mock('../../hooks/useNodepodPreview', () => ({
  useNodepodPreview: () => ({
    status: 'ready',
    previewUrl: 'https://nodepod.local/__virtual__/3000/',
    error: null,
    files: {
      '/package.json': '{"name":"demo"}',
      '/app/page.tsx': 'export default function Page() { return null }',
    },
    retry: vi.fn(),
  }),
}));

describe('RightPanel', () => {
  beforeEach(() => {
    useConversationV2Store.getState().closeRightPanel();
    useConversationV2Store.setState({
      streaming: false,
      liveToolCallId: null,
      applicationComponent: null,
      deployStatus: 'idle',
      deployedUrl: null,
      appViewMode: 'nodepod',
    });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<RightPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no selected tool', () => {
    useConversationV2Store.setState({ rightPanelMode: 'tool', selectedToolCallId: null });
    const { container } = render(<RightPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens for the selected tool', () => {
    useConversationV2Store.setState({ rightPanelMode: 'tool', selectedToolCallId: 'tc1' });
    render(<RightPanel />);
    expect(screen.getByText(/rightPanel\.title/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('shows application title and deploy control after an application event', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        cephPath: 'yellowstorm/user/app/projectSRC',
        filesTree: {
          name: '',
          type: 'directory',
          children: [
            { name: 'package.json', type: 'file', path: 'package.json', size: 40 },
            {
              name: 'app',
              type: 'directory',
              children: [
                { name: 'page.tsx', type: 'file', path: 'app/page.tsx', size: 100 },
              ],
            },
          ],
        },
        fileCount: 2,
        revision: 'app-1',
      },
    });

    render(<RightPanel />);

    expect(screen.getAllByText('Generated app').length).toBeGreaterThan(0);
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://nodepod.local/__virtual__/3000/',
    );
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
  });

  it('disables deploy and shows only the spinner while deployment is running', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
      deployStatus: 'deploying',
    });

    render(<RightPanel />);

    const deployButton = screen.getByRole('button', { name: /publishing/i });
    expect(deployButton).toBeDisabled();
    expect(deployButton).not.toHaveTextContent(/publish/i);
  });

  it('switches to the deployed iframe after publish while keeping Nodepod warm', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
      appViewMode: 'nodepod',
    });
    render(<RightPanel />);

    expect(
      document.querySelector('iframe[src="https://nodepod.local/__virtual__/3000/"]'),
    ).toBeInTheDocument();

    act(() => {
      useConversationV2Store.getState().setDeployState({
        deployStatus: 'deployed',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:00:00.000Z',
      });
    });

    expect(useConversationV2Store.getState().appViewMode).toBe('deployed');
    expect(
      document.querySelector('iframe[src="https://apps.example/app-1"]'),
    ).toBeInTheDocument();
    // Nodepod iframe stays mounted (warm) underneath.
    expect(
      document.querySelector('iframe[src="https://nodepod.local/__virtual__/3000/"]'),
    ).toBeInTheDocument();
    expect(useConversationV2Store.getState().deployedUrl).toBe('https://apps.example/app-1');
  });

  it('can switch back to Nodepod preview after deploy', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
      deployStatus: 'deployed',
      deployedUrl: 'https://apps.example/app-1',
      appViewMode: 'deployed',
    });
    render(<RightPanel />);

    expect(
      document.querySelector('iframe[src="https://apps.example/app-1"]'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /switchToNodepod/i }));

    expect(useConversationV2Store.getState().appViewMode).toBe('nodepod');
    expect(
      document.querySelector('iframe[src="https://apps.example/app-1"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('iframe[src="https://nodepod.local/__virtual__/3000/"]'),
    ).toBeInTheDocument();
  });

  it('shows the jump-to-live button when streaming and viewing a past tool', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'tool',
      selectedToolCallId: 'old',
      liveToolCallId: 'live',
      streaming: true,
    });
    render(<RightPanel />);
    expect(screen.getByRole('button', { name: /jumpToLive/i })).toBeInTheDocument();
  });

  it('hides the jump-to-live button when already on the live tool', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'tool',
      selectedToolCallId: 'live',
      liveToolCallId: 'live',
      streaming: true,
    });
    render(<RightPanel />);
    expect(screen.queryByRole('button', { name: /jumpToLive/i })).not.toBeInTheDocument();
  });

  it('close button collapses the panel', () => {
    useConversationV2Store.setState({ rightPanelMode: 'tool', selectedToolCallId: 'tc1' });
    render(<RightPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useConversationV2Store.getState().rightPanelMode).toBe('closed');
  });

  it('renders a left-edge resize handle when open', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
    });
    const { container } = render(<RightPanel />);
    expect(container.querySelector('.cursor-ew-resize')).toBeInTheDocument();
    expect(container.querySelector('[aria-label], [aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelector('.cursor-ew-resize svg')).toBeInTheDocument();
  });
});
