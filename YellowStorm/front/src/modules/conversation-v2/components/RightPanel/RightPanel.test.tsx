import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { RightPanel } from './RightPanel';
import { useConversationV2Store } from '../../store';

describe('RightPanel', () => {
  beforeEach(() => {
    useConversationV2Store.getState().closeRightPanel();
    useConversationV2Store.setState({
      streaming: false,
      liveToolCallId: null,
      applicationComponent: null,
      deployStatus: 'idle',
      deployedUrl: null,
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

  it('shows application title, URL, and deploy control after an application event', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
      },
    });

    render(<RightPanel />);

    expect(screen.getAllByText('Generated app').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('https://preview.example/app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
  });

  it('disables deploy and shows only the spinner while deployment is running', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
      },
      deployStatus: 'deploying',
    });

    render(<RightPanel />);

    const deployButton = screen.getByRole('button', { name: /publishing/i });
    expect(deployButton).toBeDisabled();
    expect(deployButton).not.toHaveTextContent(/publish/i);
  });

  it('replaces the iframe URL when deployment returns the live URL', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
      },
    });
    render(<RightPanel />);

    expect(screen.getByTitle('Preview')).toHaveAttribute(
      'src',
      'https://preview.example/app',
    );
    act(() => {
      useConversationV2Store.getState().setDeployState({
        deployStatus: 'deployed',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:00:00.000Z',
      });
    });

    expect(screen.getByTitle('Preview')).toHaveAttribute(
      'src',
      'https://apps.example/app-1',
    );
    expect(screen.getByDisplayValue('https://apps.example/app-1')).toBeInTheDocument();
  });

  it('remounts the iframe when redeploy keeps the same URL', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://apps.example/app-1',
      },
      deployStatus: 'deployed',
      deployedUrl: 'https://apps.example/app-1',
      lastDeployedAt: '2026-07-17T10:00:00.000Z',
    });
    const { container } = render(<RightPanel />);
    const firstIframe = container.querySelector('iframe');

    act(() => {
      useConversationV2Store.getState().setDeployState({
        deployStatus: 'deployed',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:05:00.000Z',
      });
    });

    const secondIframe = container.querySelector('iframe');
    expect(secondIframe).not.toBe(firstIframe);
    expect(secondIframe).toHaveAttribute('src', 'https://apps.example/app-1');
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
      },
    });
    const { container } = render(<RightPanel />);
    expect(container.querySelector('.cursor-ew-resize')).toBeInTheDocument();
    expect(container.querySelector('[aria-label], [aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelector('.cursor-ew-resize svg')).toBeInTheDocument();
  });
});
