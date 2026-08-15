import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { Header } from './Header';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

describe('Playbooks carousel Header', () => {
  it('links to the complete Playbooks list and labels carousel controls', async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();

    render(
      <MemoryRouter>
        <Header
          canScrollPrev
          canScrollNext
          total={5}
          onPrev={onPrev}
          onNext={onNext}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'swiper.viewAll' })).toHaveAttribute('href', '/playbooks');
    await userEvent.click(screen.getByRole('button', { name: 'swiper.previous' }));
    await userEvent.click(screen.getByRole('button', { name: 'swiper.next' }));
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
