import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetRenderer } from './index';

const loadWorkbookMock = vi.hoisted(() => vi.fn());
const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock('exceljs', () => ({
  Workbook: class {
    xlsx = { load: loadWorkbookMock };
    worksheets = [];
  },
}));

vi.mock('../../store', () => ({
  useFileViewerPendingNavigation: () => null,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: translateMock }),
}));

describe('SpreadsheetRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadWorkbookMock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }));
  });

  it('ignores table metadata that ExcelJS cannot reconcile', async () => {
    render(
      <SpreadsheetRenderer
        tab={{
          id: 'sheet-1',
          fileName: 'report.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          url: 'https://example.test/report.xlsx',
        }}
        isActive
      />,
    );

    await waitFor(() => {
      expect(loadWorkbookMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
        ignoreNodes: ['tableParts'],
      });
    });
  });
});
