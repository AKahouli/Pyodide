import { describe, expect, it } from 'vitest';
import type { AttributeDefinition } from '../types';
import { detectDelimiter, manualColumns, matchHeader, normalizeName, parseDelimited, parseTable, tableToPatches } from './manual-table';

const field = (key: string, label: string): AttributeDefinition => ({ key, label, type: 'text', required: false });
const columns = manualColumns([field('email', 'Email'), field('date_of_birth', 'Date of birth'), field('city', 'City')], 'Name');

describe('detectDelimiter', () => {
  it('prefers a tab, as spreadsheets copy cells', () => {
    expect(detectDelimiter('Name\tCity, State\nAnn\tParis')).toBe('\t');
  });

  it('picks the semicolon or the comma by how much each is used on the first line', () => {
    expect(detectDelimiter('Name;City;Age\nAnn;Paris;3,5')).toBe(';');
    expect(detectDelimiter('Name,City,Age\nAnn,Paris,3')).toBe(',');
    expect(detectDelimiter('Name\nAnn')).toBe(',');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"Last, First";City;Age')).toBe(';');
  });
});

describe('parseDelimited', () => {
  it('reads tab separated rows with either line ending and ignores the trailing newline', () => {
    expect(parseDelimited('a\tb\r\n1\t2\r\n', '\t')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty cells in place and drops blank rows', () => {
    expect(parseDelimited('a\t\tc\n\n\t\t\n1\t2\t3', '\t')).toEqual([['a', '', 'c'], ['1', '2', '3']]);
  });

  it('reads quoted fields: delimiters, doubled quotes and line breaks inside quotes', () => {
    expect(parseDelimited('name;note\n"Smith; John";"said ""hi"""\n"Ann";"line 1\nline 2"', ';')).toEqual([
      ['name', 'note'], ['Smith; John', 'said "hi"'], ['Ann', 'line 1\nline 2'],
    ]);
  });

  it('drops a byte order mark', () => {
    expect(parseTable('﻿Name,City\nAnn,Paris')).toEqual([['Name', 'City'], ['Ann', 'Paris']]);
  });
});

describe('matchHeader', () => {
  it('matches columns by label or key, ignoring case, accents and punctuation', () => {
    expect(normalizeName(' Date de Naissance ')).toBe('datedenaissance');
    expect(matchHeader(['NAME', 'date_of_birth', 'e-mail', 'Date of birth'], columns)).toEqual([0, 2, 1, null]);
  });
});

describe('tableToPatches', () => {
  it('uses a first row of column names to place cells, in any order, and drops it', () => {
    const table = parseTable('City\tName\tUnknown\nParis\tAnn\tx\nLyon\tBob\ty');
    const { patches, header } = tableToPatches(table, columns, { startColumn: 2, header: 'auto' });
    expect(header).toBe(true);
    expect(patches).toEqual([{ 3: 'Paris', 0: 'Ann' }, { 3: 'Lyon', 0: 'Bob' }]);
  });

  it('places cells from the focused column when there is no header', () => {
    const { patches, header } = tableToPatches([['ann@x.fr', '1990-01-02'], ['bob@x.fr', '1991-03-04']], columns, { startColumn: 1, header: 'auto' });
    expect(header).toBe(false);
    expect(patches).toEqual([{ 1: 'ann@x.fr', 2: '1990-01-02' }, { 1: 'bob@x.fr', 2: '1991-03-04' }]);
  });

  it('drops cells that fall past the last column and trims them', () => {
    const { patches } = tableToPatches([[' a ', 'b', 'c', 'd', 'e']], columns, { startColumn: 3, header: 'auto' });
    expect(patches).toEqual([{ 3: 'a' }]);
  });

  it('does not take a lone pasted word for a header', () => {
    expect(tableToPatches([['Name']], columns, { startColumn: 0, header: 'auto' })).toEqual({ header: false, patches: [{ 0: 'Name' }] });
    // Nor a first row where most cells are values.
    expect(tableToPatches([['Name', 'a', 'b'], ['x', 'y', 'z']], columns, { startColumn: 0, header: 'auto' }).header).toBe(false);
  });

  it('always reads the first row of a file as a header, and says when no column matches', () => {
    expect(tableToPatches([['Name', 'foo']], columns, { startColumn: 0, header: 'always' })).toEqual({ header: true, patches: [] });
    expect(tableToPatches([['foo', 'bar'], ['1', '2']], columns, { startColumn: 0, header: 'always' }).header).toBe(false);
  });

  it('reads a semicolon CSV with accents and quotes', () => {
    const table = parseTable('Nom;"City"\n"Dupont; Jean";Paris');
    const french = manualColumns([field('city', 'City')], 'Nom');
    expect(tableToPatches(table, french, { startColumn: 0, header: 'always' }).patches).toEqual([{ 0: 'Dupont; Jean', 1: 'Paris' }]);
  });
});
