import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

const open = (count: number) => {
  const onChange = vi.fn();
  render(<Select onValueChange={onChange}>
    <SelectTrigger aria-label='pick'><SelectValue placeholder='pick' /></SelectTrigger>
    <SelectContent>{Array.from({ length: count }, (_, index) => <SelectItem key={index} value={`v${index}`}>{index === 3 ? 'Équipe' : `Item ${index}`}</SelectItem>)}</SelectContent>
  </Select>);
  fireEvent.click(screen.getByRole('combobox', { name: 'pick' }));
  return onChange;
};

describe('semantic-model Select', () => {
  it('has no search box for a short list', () => {
    open(5);
    expect(screen.getAllByRole('option')).toHaveLength(5);
    expect(screen.queryByRole('textbox', { name: 'action.searchList' })).toBeNull();
  });

  it('searches a long list, ignoring case and accents, and still picks a match', () => {
    const onChange = open(20);
    const search = screen.getByRole('textbox', { name: 'action.searchList' });
    fireEvent.change(search, { target: { value: 'equipe' } });
    expect(screen.getAllByRole('option').filter((option) => !option.className.includes('hidden')).map((option) => option.textContent)).toEqual(['Équipe']);
    fireEvent.click(screen.getByRole('option', { name: 'Équipe' }));
    expect(onChange).toHaveBeenCalledWith('v3');
  });

  it('says when nothing matches', () => {
    open(20);
    fireEvent.change(screen.getByRole('textbox', { name: 'action.searchList' }), { target: { value: 'zzz' } });
    expect(screen.getByText('action.noListMatch')).toBeInTheDocument();
  });
});
