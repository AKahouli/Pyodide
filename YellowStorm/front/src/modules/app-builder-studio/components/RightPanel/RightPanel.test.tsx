import { act, render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { RightPanel } from './RightPanel';
import { useAppBuilderStudioStore } from '../../store';

vi.mock('../../hooks/useNodepodPreview', () => ({
  useNodepodPreview: () => ({
    status: 'ready',
    hostStatus: 'ready',
    previewUrl: 'https://nodepod.local/__virtual__/3000/',
    error: null,
    files: {
      '/package.json': '{"name":"demo"}',
      '/app/page.tsx': 'export default function Page() { return null }',
    },
    retry: vi.fn(),
    previewIframeRef: vi.fn(),
  }),
}));

/** DeployControls reads `?action=clone` via useSearchParams — needs a Router. */
function renderPanel(): RenderResult {
  return render(
    <MemoryRouter>
      <RightPanel />
    </MemoryRouter>,
  );
}

describe('RightPanel', () => {
  beforeEach(() => {
    useAppBuilderStudioStore.getState().closeRightPanel();
    useAppBuilderStudioStore.setState({
      streaming: false,
      liveToolCallId: null,
      applicationComponent: null,
      appBuildProgress: null,
      runtimeStatus: 'idle',
      deployStatus: 'idle',
      deployedUrl: null,
      appViewMode: 'nodepod',
    });
  });

  it('renders nothing when closed', () => {
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no selected tool', () => {
    useAppBuilderStudioStore.setState({ rightPanelMode: 'tool', selectedToolCallId: null });
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('opens for the selected tool', () => {
    useAppBuilderStudioStore.setState({ rightPanelMode: 'tool', selectedToolCallId: 'tc1' });
    renderPanel();
    expect(screen.getByText(/rightPanel\.title/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('shows application title and deploy control after an application event', () => {
    useAppBuilderStudioStore.setState({
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
        workspaceRevisionId: 'rev_15',
      },
    });

    renderPanel();

    expect(screen.getByTitle('Generated app')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://nodepod.local/__virtual__/3000/',
    );
    expect(screen.getByRole('button', { name: /publish/i })).toBeEnabled();
  });

  it('enables Publish once an application component is ready', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
    });

    renderPanel();

    expect(screen.getByRole('button', { name: /publish/i })).toBeEnabled();
  });

  it('disables deploy and shows only the spinner while deployment is running', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
        workspaceRevisionId: 'rev_15',
      },
      deployStatus: 'deploying',
    });

    renderPanel();

    const deployButton = screen.getByRole('button', { name: /publishing/i });
    expect(deployButton).toBeDisabled();
    expect(deployButton).not.toHaveTextContent(/publish/i);
  });

  it('keeps Nodepod preview after deploy metadata loads and switches on Deployed toggle', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
      appViewMode: 'nodepod',
    });
    renderPanel();

    expect(
      document.querySelector('iframe[src="https://nodepod.local/__virtual__/3000/"]'),
    ).toBeInTheDocument();

    act(() => {
      useAppBuilderStudioStore.getState().setDeployState({
        deployStatus: 'deployed',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:00:00.000Z',
      });
    });

    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('nodepod');
    expect(
      document.querySelector('iframe[src="https://nodepod.local/__virtual__/3000/"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /modeSwitch/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /modeDeploy/i }));

    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('deployed');
    expect(
      document.querySelector('iframe[src="https://apps.example/app-1"]'),
    ).toBeInTheDocument();
    // Nodepod iframe stays mounted (warm) underneath.
    expect(
      document.querySelector('iframe[src="https://nodepod.local/__virtual__/3000/"]'),
    ).toBeInTheDocument();
    expect(useAppBuilderStudioStore.getState().deployedUrl).toBe('https://apps.example/app-1');
  });

  it('can switch back to Nodepod preview after deploy', () => {
    useAppBuilderStudioStore.setState({
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
    renderPanel();

    expect(
      document.querySelector('iframe[src="https://apps.example/app-1"]'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /modePreview/i }));

    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('nodepod');
    expect(
      document.querySelector('iframe[src="https://apps.example/app-1"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('iframe[src="https://nodepod.local/__virtual__/3000/"]'),
    ).toBeInTheDocument();
  });

  it('can switch from Nodepod preview to the deployed view', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
      deployStatus: 'deployed',
      deployedUrl: 'https://apps.example/app-1',
      appViewMode: 'nodepod',
    });
    renderPanel();

    fireEvent.click(screen.getByRole('tab', { name: /modeDeploy/i }));

    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('deployed');
    expect(
      document.querySelector('iframe[src="https://apps.example/app-1"]'),
    ).toBeInTheDocument();
  });

  it('hides the Preview/Deployed switch until a deployed URL exists', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
      deployStatus: 'idle',
      deployedUrl: null,
      appViewMode: 'nodepod',
    });
    renderPanel();

    expect(screen.queryByRole('tablist', { name: /modeSwitch/i })).not.toBeInTheDocument();
  });

  it('shows the jump-to-live button when streaming and viewing a past tool', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'tool',
      selectedToolCallId: 'old',
      liveToolCallId: 'live',
      streaming: true,
    });
    renderPanel();
    expect(screen.getByRole('button', { name: /jumpToLive/i })).toBeInTheDocument();
  });

  it('hides the jump-to-live button when already on the live tool', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'tool',
      selectedToolCallId: 'live',
      liveToolCallId: 'live',
      streaming: true,
    });
    renderPanel();
    expect(screen.queryByRole('button', { name: /jumpToLive/i })).not.toBeInTheDocument();
  });

  it('shows Nodepod preview when runtime is browser_active without application_component', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: null,
      runtimeStatus: 'browser_active',
    });

    renderPanel();

    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://nodepod.local/__virtual__/3000/',
    );
    // Deploy requires an application component — runtime alone is not enough.
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('shows Nodepod preview while runtime is hydrating before SSE application_component', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: null,
      runtimeStatus: 'hydrating',
    });

    renderPanel();
    expect(document.querySelector('iframe')).toBeInTheDocument();
  });

  it('renders nothing in app mode when there is no runtime, progress, or application', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: null,
      appBuildProgress: null,
      runtimeStatus: 'idle',
    });
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('close button collapses the panel', () => {
    useAppBuilderStudioStore.setState({ rightPanelMode: 'tool', selectedToolCallId: 'tc1' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useAppBuilderStudioStore.getState().rightPanelMode).toBe('closed');
  });

  it('renders a left-edge resize handle when open', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'app',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
    });
    const { container } = renderPanel();
    expect(container.querySelector('.cursor-ew-resize')).toBeInTheDocument();
    expect(container.querySelector('[aria-label], [aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelector('.cursor-ew-resize svg')).toBeInTheDocument();
  });
});
