import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import AdmZip = require('adm-zip');
import * as ExcelJS from 'exceljs';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DocumentService } from '@modules/document/document.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import {
  computeFieldProfiles,
  PREVIEW_ROW_SCAN_LIMIT,
  resolveSheetEntities,
  SHEET_ROW_KEY,
  type ConceptResolutionInput,
  type ConceptResolutionResult,
  type ConceptResolver,
  type SheetFieldProfile,
} from '../domain/semantic-source-mapping.types';

const MAX_PARSED_FILE_BYTES = 50 * 1024 * 1024;

export interface ParsedSpreadsheet {
  sheets: Array<{ name: string; rowCount: number; fieldCount: number }>;
  rows: Record<string, unknown>[];
  headers: string[];
}

@Injectable()
export class SpreadsheetConceptResolver implements ConceptResolver {
  readonly kind = 'excel_sheet' as const;

  constructor(
    private readonly documents: WorkspaceDocumentService,
    private readonly storage: DocumentService,
  ) {}

  async profile(workspaceId: string, documentId: string, sheetName?: string) {
    const parsed = await this.parse(workspaceId, documentId, sheetName);
    if (!sheetName) return { sheets: parsed.sheets };
    const fields: SheetFieldProfile[] = computeFieldProfiles(parsed.rows.slice(0, 200));
    return {
      sheets: parsed.sheets,
      sheet: parsed.sheets.find((entry) => entry.name === sheetName),
      fields,
      sampleRows: parsed.rows.slice(0, 10),
      totalRows: parsed.rows.length,
    };
  }

  async preview(input: ConceptResolutionInput & { sheetName?: string }): Promise<ConceptResolutionResult> {
    const parsed = await this.parse(input.workspaceId, input.documentId, input.sheetName);
    const { entities, stats } = resolveSheetEntities(
      parsed.rows,
      input.fieldMappings,
      input.identityFields,
      input.limit ?? 50,
    );
    const selectedSheet = parsed.sheets.find((sheet) => sheet.name === input.sheetName) ?? parsed.sheets[0];
    const availableRows = Math.max(0, (selectedSheet?.rowCount ?? 1) - 1);
    const profiles = computeFieldProfiles(parsed.rows.slice(0, PREVIEW_ROW_SCAN_LIMIT));
    return {
      entities,
      stats,
      identityEvidence: input.identityFields.flatMap((targetAttribute) => {
        const sourceField = input.fieldMappings.find((mapping) => mapping.targetAttribute === targetAttribute)?.sourceField;
        const profile = profiles.find((candidate) => candidate.name === sourceField);
        return profile ? [{ ...profile, name: targetAttribute }] : [];
      }),
      warnings: this.warnings(entities.length, stats, input.identityFields, input.fieldMappings.length),
      complete: availableRows <= parsed.rows.length && stats.scannedRows >= parsed.rows.length,
    };
  }

  async parse(workspaceId: string, documentId: string, sheetName?: string): Promise<ParsedSpreadsheet> {
    const document = await this.documents.findById(workspaceId, documentId);
    if (!document.path) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'This file has no downloadable content');
    // ponytail: hard 50 MB gate instead of streaming; revisit if large workbook previews become a real use case
    if (document.size > MAX_PARSED_FILE_BYTES) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'This file is too large to map (50 MB max)');
    const buffer = await this.storage.download(document.path);
    let workbook = new ExcelJS.Workbook();
    try {
      if (document.mimeType.includes('csv')) await workbook.csv.read(Readable.from(buffer), { sheetName: 'CSV' });
      else {
        try {
          await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        } catch (error) {
          const normalized = this.normalizeSpreadsheetXml(buffer);
          if (!normalized) throw error;
          workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(normalized as unknown as ExcelJS.Buffer);
        }
      }
    } catch (error) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `This file could not be read as a spreadsheet: ${(error as Error).message}`,
      );
    }
    const sheets = workbook.worksheets.map((worksheet) => ({
      name: worksheet.name,
      rowCount: worksheet.actualRowCount,
      fieldCount: this.headerNames(worksheet).length,
    }));
    const selected = sheetName
      ? workbook.worksheets.find((worksheet) => worksheet.name === sheetName)
      : workbook.worksheets[0];
    if (sheetName && !selected) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Sheet "${sheetName}" was not found in this file`);
    return {
      sheets,
      rows: selected ? this.objectRows(selected, PREVIEW_ROW_SCAN_LIMIT) : [],
      headers: selected ? this.headerNames(selected) : [],
    };
  }

  private normalizeSpreadsheetXml(buffer: Buffer): Buffer | null {
    const archive = new AdmZip(buffer);
    let changed = false;
    for (const entry of archive.getEntries()) {
      if (!entry.entryName.endsWith('.xml')) continue;
      const xml = entry.getData().toString('utf8');
      const namespace = xml.match(/xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/);
      if (!namespace) continue;
      const prefix = namespace[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      archive.updateFile(entry.entryName, Buffer.from(
        xml.replace(new RegExp(`<(/?)${prefix}:`, 'g'), '<$1').replace(`xmlns:${namespace[1]}=`, 'xmlns='),
      ));
      changed = true;
    }
    if (!changed) return null;
    for (const entry of archive.getEntries()) {
      if (!/^xl\/worksheets\/_rels\/.*\.rels$/.test(entry.entryName)) continue;
      archive.updateFile(entry.entryName, Buffer.from(
        entry.getData().toString('utf8').replace(/Target=(["'])\/xl\//g, 'Target=$1../'),
      ));
    }
    return archive.toBuffer();
  }

  private warnings(entityCount: number, stats: ConceptResolutionResult['stats'], identityFields: string[], mappingCount: number): string[] {
    const warnings: string[] = [];
    if (!identityFields.length) warnings.push('No identity field selected: rows are not deduplicated across sources.');
    if (stats.nullIdentitySkipped > 0) warnings.push(`${stats.nullIdentitySkipped} row(s) skipped because the identity value is empty.`);
    if (stats.duplicateKeysSkipped > 0) warnings.push(`${stats.duplicateKeysSkipped} duplicate identity value(s) skipped; only the first row is kept.`);
    if (!mappingCount) warnings.push('No fields are mapped yet.');
    if (stats.scannedRows >= PREVIEW_ROW_SCAN_LIMIT) warnings.push(`Preview stopped after the first ${PREVIEW_ROW_SCAN_LIMIT} rows.`);
    if (entityCount && stats.scannedRows > 0 && stats.resolvedEntities / stats.scannedRows < 0.5 && identityFields.length) warnings.push('Less than half of the scanned rows resolved to entities. Check the identity field.');
    return warnings;
  }

  private headerNames(worksheet: ExcelJS.Worksheet): string[] {
    const headerRow = worksheet.getRow(1);
    const names: string[] = [];
    for (let column = 1; column <= headerRow.cellCount; column += 1) {
      const value = this.cellValue(headerRow.getCell(column).value);
      names.push(String(value ?? '').trim() || `Column ${column}`);
    }
    return names;
  }

  private objectRows(worksheet: ExcelJS.Worksheet, maxRows: number): Record<string, unknown>[] {
    const headers = this.headerNames(worksheet);
    const rows: Record<string, unknown>[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1 || rows.length >= maxRows) return;
      const record: Record<string, unknown> = { [SHEET_ROW_KEY]: rowNumber };
      headers.forEach((name, index) => { record[name] = this.cellValue(row.getCell(index + 1).value); });
      rows.push(record);
    });
    return rows;
  }

  private cellValue(value: ExcelJS.CellValue): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object' && !(value instanceof Date)) {
      if ('richText' in value) return value.richText.map((part) => part.text).join('');
      if ('text' in value) return this.cellValue(value.text as ExcelJS.CellValue);
      if ('result' in value) return this.cellValue((value.result ?? null) as ExcelJS.CellValue);
      if ('error' in value || 'sharedFormula' in value) return null;
    }
    return value;
  }
}
