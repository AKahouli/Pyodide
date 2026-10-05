import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppTemplate, TemplateCategory } from '../../types';

type CreateTemplateInput = {
  categoryId: string;
  title: string;
  description?: string;
  zip: File;
  cover: File;
};

const createTemplateMock = vi.hoisted(() =>
  vi.fn(async (_input: CreateTemplateInput) => ({})),
);
const updateTemplateMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../api', () => ({
  adminTemplateApi: {
    createTemplate: createTemplateMock,
    updateTemplate: updateTemplateMock,
  },
}));

vi.mock('./cover/CoverFocusDialog', () => ({
  CoverFocusDialog: () => null,
}));

vi.mock('./TemplateStudio', () => ({
  TemplateStudio: ({
    open,
    onValidated,
    onOpenChange,
  }: {
    open: boolean;
    onValidated: (file: File) => void;
    onOpenChange: (open: boolean) => void;
  }) => {
    if (!open) return null;
    // Simulate successful preview → cover → auto-close.
    queueMicrotask(() => {
      onValidated(new File(['cover-bytes'], 'template-cover.png', { type: 'image/png' }));
      onOpenChange(false);
    });
    return null;
  },
}));

vi.mock('./cover/cover-focus', async () => {
  const actual = await vi.importActual<typeof import('./cover/cover-focus')>(
    './cover/cover-focus',
  );
  return {
    ...actual,
    exportPrimaryCoverFile: vi.fn(async (item: { file: File }) => item.file),
  };
});

vi.mock('@/lib/notifications', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { TemplateFormDrawer } from './TemplateFormDrawer';

const categories = [{ id: 'cat_1', name: 'Starters' } as TemplateCategory];

const existing = {
  id: 'tpl_1',
  categoryId: 'cat_1',
  categoryName: 'Starters',
  title: 'Horizon',
  description: 'Existing description',
  coverImage: 'https://cdn.test/cover.png',
  status: 'published',
  revisionId: 'template_tpl_1',
  createdAt: '2026-09-28T07:16:40.796Z',
  updatedAt: '2026-09-28T07:16:40.796Z',
} as AppTemplate;

function renderDrawer(current: AppTemplate | null = null) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <TemplateFormDrawer
      open
      onOpenChange={onOpenChange}
      template={current}
      categories={categories}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onOpenChange };
}

const zip = new File(['zip-bytes'], 'app.zip', { type: 'application/zip' });

describe('TemplateFormDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens as a right-hand drawer instead of a centered modal', () => {
    renderDrawer();

    const panel = screen.getByRole('dialog');
    expect(panel).toHaveClass('right-0');
    expect(panel).toHaveClass('h-full');
    expect(panel).not.toHaveClass('left-[50%]');
    expect(screen.getByText('templates.createTitle')).toBeInTheDocument();
  });

  it('keeps create locked until ZIP is validated and cover is set from Template Studio', async () => {
    renderDrawer();

    const submit = screen.getByRole('button', { name: 'templates.create' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('templates.fieldTitle'), 'Sales starter');
    expect(submit).toBeDisabled();

    await userEvent.upload(screen.getByLabelText('templates.fieldZip'), zip);
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'templates.validateTemplate' }));

    expect(await screen.findByRole('button', { name: /templates.validationConfirmed/ })).toBeDisabled();
    expect(submit).toBeEnabled();

    fireEvent.submit(submit.closest('form')!);

    await waitFor(() => expect(createTemplateMock).toHaveBeenCalledTimes(1));
    const payload = createTemplateMock.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload!.categoryId).toBe('cat_1');
    expect(payload!.title).toBe('Sales starter');
    expect(payload!.description).toBe('');
    expect(payload!.zip).toBe(zip);
    expect(payload!.cover).toBeInstanceOf(File);
    expect(payload!.cover.name).toBe('template-cover.png');
  });

  it('prefills the edit form, hides the upload zones and updates in place', async () => {
    const { onSaved, onOpenChange } = renderDrawer(existing);

    expect(screen.getByText('templates.editTitle')).toBeInTheDocument();
    expect(screen.queryByLabelText('templates.fieldZip')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('templates.fieldCover')).not.toBeInTheDocument();

    const title = screen.getByLabelText('templates.fieldTitle');
    expect(title).toHaveValue('Horizon');
    expect(screen.getByLabelText('templates.fieldDescription')).toHaveValue('Existing description');

    await userEvent.clear(screen.getByLabelText('templates.fieldDescription'));
    await userEvent.type(screen.getByLabelText('templates.fieldDescription'), 'Updated');
    fireEvent.submit(screen.getByRole('button', { name: 'templates.save' }).closest('form')!);

    await waitFor(() =>
      expect(updateTemplateMock).toHaveBeenCalledWith('tpl_1', {
        categoryId: 'cat_1',
        title: 'Horizon',
        description: 'Updated',
      }),
    );
    expect(createTemplateMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
