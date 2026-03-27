import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusSection } from './StatusSection';

describe('StatusSection', () => {
  it('renders required title', () => {
    render(<StatusSection title='status.title' />);

    expect(screen.getByText('status.title')).toBeInTheDocument();
  });

  it('renders optional icon, description, and children when provided', () => {
    render(
      <StatusSection
        icon={<span data-testid='status-icon'>icon</span>}
        title='status.title'
        description='status.description'
      >
        <button type='button'>status.action</button>
      </StatusSection>,
    );

    expect(screen.getByTestId('status-icon')).toBeInTheDocument();
    expect(screen.getByText('status.description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'status.action' })).toBeInTheDocument();
  });

  it('does not render optional blocks when omitted', () => {
    render(<StatusSection title='status.title' />);

    expect(screen.queryByTestId('status-icon')).not.toBeInTheDocument();
    expect(screen.queryByText('status.description')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'status.action' })).not.toBeInTheDocument();
  });
});
