import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouterNode } from './RouterNode';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      switch (key) {
        case 'routerNode.defaultTitle':
          return 'Decision';
        case 'routerNode.routesConfigured.one':
          return `${vars?.count} route configured`;
        case 'routerNode.routesConfigured.other':
          return `${vars?.count} routes configured`;
        case 'routerNode.rulesConfigured.one':
          return `${vars?.count} deterministic rule`;
        case 'routerNode.rulesConfigured.other':
          return `${vars?.count} deterministic rules`;
        case 'routerNode.legacyRouting':
          return 'AI routing fallback';
        case 'routerNode.defaultRoute':
          return `Default: ${vars?.label}`;
        case 'routerNode.loopLimit':
          return `Loop limit: ${vars?.count}`;
        case 'nodeContextMenu.edit':
        case 'nodeContextMenu.clone':
        case 'nodeContextMenu.delete':
        case 'clipboard.menuCopy':
        case 'clipboard.menuCut':
        case 'clipboard.menuPaste':
          return key;
        default:
          return key;
      }
    },
  }),
}));

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id: string }) => <span data-testid={`handle-${id}`} />,
  Position: { Left: 'left', Right: 'right' },
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock('@/components/ai-elements/node', () => ({
  Node: ({ children, handles, ...props }: any) => <div {...props}>{children}</div>,
  NodeHeader: ({ children }: any) => <div>{children}</div>,
  NodeTitle: ({ children }: any) => <div>{children}</div>,
  NodeContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: any) => <button type="button">{children}</button>,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: any) => <>{children}</>,
  ContextMenuTrigger: ({ children, asChild, ...props }: any) => (asChild ? <>{children}</> : <div {...props}>{children}</div>),
  ContextMenuContent: ({ children }: any) => <>{children}</>,
  ContextMenuItem: ({ children }: any) => <>{children}</>,
  ContextMenuSeparator: () => null,
}));

vi.mock('./PortLabel', () => ({
  PortLabel: ({ name }: { name: string }) => <span>{name}</span>,
}));

describe('RouterNode', () => {
  it('renders a readable routing summary', () => {
    render(
      <RouterNode
        {...({
          id: 'router-1',
          selected: false,
          data: {
            title: '',
            description: '',
            routerConfig: {
              outputLabels: ['contract', 'invoice', '__error__'],
              conditions: [{ label: 'contract', operator: 'equals' }],
              defaultLabel: 'invoice',
              maxIterations: 3,
            },
          },
        } as any)}
      />,
    );

    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('2 routes configured')).toBeInTheDocument();
    expect(screen.getByText('1 deterministic rule')).toBeInTheDocument();
    expect(screen.getByText('Default: invoice')).toBeInTheDocument();
    expect(screen.getByText('Loop limit: 3')).toBeInTheDocument();
  });

  it('shows AI fallback when no deterministic rules exist', () => {
    render(
      <RouterNode
        {...({
          id: 'router-2',
          selected: false,
          data: {
            title: '',
            description: '',
            routerConfig: {
              outputLabels: ['contract', '__error__'],
              maxIterations: 0,
            },
          },
        } as any)}
      />,
    );

    expect(screen.getByText('1 route configured')).toBeInTheDocument();
    expect(screen.getByText('AI routing fallback')).toBeInTheDocument();
  });
});
