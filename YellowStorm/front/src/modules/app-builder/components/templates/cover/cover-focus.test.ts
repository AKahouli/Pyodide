import { describe, expect, it } from 'vitest';
import {
  COVER_CARD_ASPECT,
  clampFocusToImage,
  computeCoverCropRect,
  defaultCoverFocus,
  normalizeFocus,
  screenshotCoverFocus,
} from './cover-focus';

describe('cover-focus', () => {
  it('keeps default focus centered at zoom 1', () => {
    expect(defaultCoverFocus()).toEqual({ cx: 0.5, cy: 0.5, zoom: 1 });
  });

  it('anchors auto screenshots near the top of the page', () => {
    const focus = screenshotCoverFocus();
    expect(focus.cx).toBe(0.5);
    expect(focus.cy).toBeLessThan(0.5);
    expect(focus.zoom).toBe(1);
  });

  it('computes a 16:10 crop that fits a landscape image', () => {
    const crop = computeCoverCropRect(1600, 900, defaultCoverFocus());
    expect(crop.width / crop.height).toBeCloseTo(COVER_CARD_ASPECT, 5);
    expect(crop.height).toBeCloseTo(900, 5);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.y).toBe(0);
  });

  it('shrinks the crop when zooming in', () => {
    const wide = computeCoverCropRect(1600, 900, { cx: 0.5, cy: 0.5, zoom: 1 });
    const tight = computeCoverCropRect(1600, 900, { cx: 0.5, cy: 0.5, zoom: 2 });
    expect(tight.width).toBeCloseTo(wide.width / 2, 5);
    expect(tight.height).toBeCloseTo(wide.height / 2, 5);
  });

  it('clamps focus so the crop stays inside the image', () => {
    const clamped = clampFocusToImage(1000, 1000, { cx: 0, cy: 0, zoom: 1 });
    const crop = computeCoverCropRect(1000, 1000, clamped);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1000 + 0.001);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1000 + 0.001);
  });

  it('normalizes out-of-range focus values', () => {
    expect(normalizeFocus({ cx: -1, cy: 2, zoom: 99 })).toEqual({
      cx: 0,
      cy: 1,
      zoom: 3,
    });
  });
});
