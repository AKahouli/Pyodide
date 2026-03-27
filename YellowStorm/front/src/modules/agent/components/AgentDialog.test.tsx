import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentDialog } from './AgentDialog';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./AgentList', () => ({
  AgentList: () => <div>agent-list</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('AgentDialog', () => {
  it('renders dialog content and list when open', () => {
    render(<AgentDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByText('dialog.title')).toBeInTheDocument();
    expect(screen.getByText('dialog.description')).toBeInTheDocument();
    expect(screen.getByText('agent-list')).toBeInTheDocument();
  });
});
