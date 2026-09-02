import { describe, expect, it } from 'vitest';
import { inspectLogoFile } from './logo-file';
import { validateLogoSourceDimensions } from './logo-mime';
import { containRect } from './logo-fit';

describe('inspectLogoFile', () => {
  it('rejects unsupported types', async () => {
    const file = new File(['nope'], 'notes.txt', { type: 'text/plain' });
    expect(await inspectLogoFile(file)).toEqual({ ok: false, issue: 'type' });
  });

  it('rejects gif uploads', async () => {
    const file = new File(['GIF89a'], 'mark.gif', { type: 'image/gif' });
    expect(await inspectLogoFile(file)).toEqual({ ok: false, issue: 'type' });
  });

  it('accepts a sidebar-shaped SVG', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 56"></svg>';
    const file = new File([svg], 'mark.svg', { type: 'image/svg+xml' });
    expect(await inspectLogoFile(file)).toEqual({ ok: true, inspection: { width: 300, height: 56, isSvg: true } });
  });

  it('rejects a square SVG that cannot fit the sidebar slot', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000"></svg>';
    const file = new File([svg], 'huge.svg', { type: 'image/svg+xml' });
    expect(await inspectLogoFile(file)).toEqual({ ok: false, issue: 'dimensions' });
  });

  it('rejects a portrait SVG', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 224"></svg>';
    const file = new File([svg], 'tall.svg', { type: 'image/svg+xml' });
    expect(await inspectLogoFile(file)).toEqual({ ok: false, issue: 'dimensions' });
  });
});

describe('validateLogoSourceDimensions', () => {
  it('accepts landscape marks that can contain-fit the sidebar', () => {
    expect(validateLogoSourceDimensions(289, 54)).toBe(true);
    expect(validateLogoSourceDimensions(1200, 200)).toBe(true);
  });

  it('rejects squares, strips, and tiny images', () => {
    expect(validateLogoSourceDimensions(256, 256)).toBe(false);
    expect(validateLogoSourceDimensions(32, 32)).toBe(false);
    expect(validateLogoSourceDimensions(2000, 40)).toBe(false);
  });
});

describe('containRect', () => {
  it('scales a landscape logo to fill width and centers it vertically', () => {
    expect(containRect(289, 54, 448, 96)).toEqual({ x: 0, y: 6, width: 448, height: 84 });
  });

  it('scales a taller landscape logo to fill height and centers it horizontally', () => {
    expect(containRect(200, 80, 448, 96)).toEqual({ x: 104, y: 0, width: 240, height: 96 });
  });
});
