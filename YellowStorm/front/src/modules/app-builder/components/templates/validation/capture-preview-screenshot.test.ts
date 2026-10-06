import { describe, expect, it } from 'vitest';
import { COVER_CARD_ASPECT } from '../cover/cover-focus';
import { cropCoverCanvasRect } from './capture-preview-screenshot';

describe('cropCoverCanvasRect', () => {
  it('keeps a 16:10 screenshot intact', () => {
    expect(cropCoverCanvasRect(1280, 800)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 800 });
  });

  it('crops a tall landing page from the top', () => {
    const crop = cropCoverCanvasRect(1280, 2400);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe(0);
    expect(crop.sw).toBe(1280);
    expect(crop.sh / crop.sw).toBeCloseTo(1 / COVER_CARD_ASPECT, 5);
  });

  it('crops extra width from the center of a panoramic shot', () => {
    const crop = cropCoverCanvasRect(2000, 800);
    expect(crop.sy).toBe(0);
    expect(crop.sh).toBe(800);
    expect(crop.sw / crop.sh).toBeCloseTo(COVER_CARD_ASPECT, 5);
    expect(crop.sx).toBeGreaterThan(0);
    expect(crop.sx + crop.sw).toBeLessThanOrEqual(2000);
  });
});
