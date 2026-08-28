import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HumanApprovalNode } from './HumanApprovalNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type }: { id: string; type: string }) => <span data-testid={`${type}-handle-${id}`} />,
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
  ContextMenuTrigger: ({ children }: any) => <>{children}</>,
  ContextMenuContent: ({ children }: any) => <>{children}</>,
  ContextMenuItem: ({ children }: any) => <>{children}</>,
  ContextMenuSeparator: () => null,
}));

vi.mock('./PortLabel', () => ({
  PortLabel: ({ name }: { name: string }) => <span>{name}</span>,
}));

describe('HumanApprovalNode', () => {
  it('renders handles for every configured approval input and output port', () => {
    render(
      <HumanApprovalNode
        {...({
          id: 'approval-1',
          selected: false,
          data: {
            title: 'Approve qualified leads',
            humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: null },
            inputPorts: [
              { id: 'qualified_leads', name: 'Qualified Leads', artifactKind: 'data', required: true },
              { id: 'scoring_summary', name: 'Scoring Summary', artifactKind: 'text', required: true },
            ],
            outputPorts: [
              { id: 'approved_leads', name: 'Approved Leads', artifactKind: 'data' },
              { id: 'approval_decision', name: 'Approval Decision', artifactKind: 'text' },
            ],
          },
        } as any)}
      />,
    );

    expect(screen.getByTestId('target-handle-qualified_leads')).toBeInTheDocument();
    expect(screen.getByTestId('target-handle-scoring_summary')).toBeInTheDocument();
    expect(screen.getByTestId('source-handle-approved_leads')).toBeInTheDocument();
    expect(screen.getByTestId('source-handle-approval_decision')).toBeInTheDocument();
    expect(screen.queryByTestId('target-handle-default')).not.toBeInTheDocument();
    expect(screen.queryByTestId('source-handle-default')).not.toBeInTheDocument();
  });
});
