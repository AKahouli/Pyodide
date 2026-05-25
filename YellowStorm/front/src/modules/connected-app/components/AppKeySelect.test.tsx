import { render, screen, fireEvent } from '@testing-library/react';
import { AppKeySelect } from './AppKeySelect';

const mockPresets = [
  { key: 'github', displayName: 'GitHub', appKey: 'github' },
  { key: 'google', displayName: 'Google', appKey: 'google' },
  { key: 'microsoft', displayName: 'Microsoft', appKey: 'microsoft' },
];

describe('AppKeySelect', () => {
  it('renders with placeholder when no value is provided', () => {
    render(<AppKeySelect value="" onChange={vi.fn()} presets={mockPresets} />);
    expect(screen.getByText('Select or enter app key...')).toBeInTheDocument();
  });

  it('displays selected preset app', () => {
    render(
      <AppKeySelect value="github" onChange={vi.fn()} presets={mockPresets} />,
    );
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('(github)')).toBeInTheDocument();
  });

  it('displays custom app key when value is not in presets', () => {
    render(
      <AppKeySelect value="custom-app" onChange={vi.fn()} presets={mockPresets} />,
    );
    const input = screen.getByDisplayValue('custom-app');
    expect(input).toBeInTheDocument();
  });

  it('opens dropdown on click', () => {
    render(<AppKeySelect value="" onChange={vi.fn()} presets={mockPresets} />);
    const trigger = screen.getByText('Select or enter app key...');
    fireEvent.click(trigger);
    expect(screen.getByText('Preset Apps')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('selects a preset when clicked', () => {
    const handleChange = vi.fn();
    render(
      <AppKeySelect value="" onChange={handleChange} presets={mockPresets} />,
    );
    const trigger = screen.getByText('Select or enter app key...');
    fireEvent.click(trigger);
    const githubOption = screen.getByText('GitHub');
    fireEvent.click(githubOption);
    expect(handleChange).toHaveBeenCalledWith('github');
  });

  it('filters out existing app keys from presets', () => {
    render(
      <AppKeySelect
        value=""
        onChange={vi.fn()}
        presets={mockPresets}
        existingAppKeys={['github']}
      />,
    );
    const trigger = screen.getByText('Select or enter app key...');
    fireEvent.click(trigger);
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
  });

  it('shows custom input option when available presets exist', () => {
    render(<AppKeySelect value="" onChange={vi.fn()} presets={mockPresets} />);
    const trigger = screen.getByText('Select or enter app key...');
    fireEvent.click(trigger);
    expect(screen.getByText('Custom App Key...')).toBeInTheDocument();
  });

  it('switches to custom input mode when custom option is selected', () => {
    const handleChange = vi.fn();
    render(
      <AppKeySelect value="" onChange={handleChange} presets={mockPresets} />,
    );
    const trigger = screen.getByText('Select or enter app key...');
    fireEvent.click(trigger);
    const customOption = screen.getByText('Custom App Key...');
    fireEvent.click(customOption);
    const input = screen.getByPlaceholderText('Select or enter app key...');
    expect(input).toBeInTheDocument();
  });

  it('updates value when typing in custom input', () => {
    const handleChange = vi.fn();
    render(
      <AppKeySelect
        value=""
        onChange={handleChange}
        presets={mockPresets}
      />,
    );
    const trigger = screen.getByText('Select or enter app key...');
    fireEvent.click(trigger);
    const customOption = screen.getByText('Custom App Key...');
    fireEvent.click(customOption);
    const input = screen.getByPlaceholderText('Select or enter app key...');
    fireEvent.change(input, { target: { value: 'my-custom-app' } });
    expect(handleChange).toHaveBeenCalledWith('my-custom-app');
  });

  it('is disabled when disabled prop is true', () => {
    render(
      <AppKeySelect value="" onChange={vi.fn()} presets={mockPresets} disabled />,
    );
    const trigger = screen.getByText('Select or enter app key...');
    expect(trigger).toBeDisabled();
  });

  it('closes dropdown when clicking outside', () => {
    render(<AppKeySelect value="" onChange={vi.fn()} presets={mockPresets} />);
    const trigger = screen.getByText('Select or enter app key...');
    fireEvent.click(trigger);
    expect(screen.getByText('Preset Apps')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Preset Apps')).not.toBeInTheDocument();
  });
});