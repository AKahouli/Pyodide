/** Template card media aspect (matches TemplateCard `aspect-[16/10]`). */
export const COVER_CARD_ASPECT = 16 / 10;

export const COVER_MAX_IMAGES = 8;
export const COVER_MIN_ZOOM = 1;
export const COVER_MAX_ZOOM = 3;

/** Focus window: center in normalized image coords + zoom (1 = widest crop). */
export interface CoverFocus {
  cx: number;
  cy: number;
  zoom: number;
}

export interface CoverImageItem {
  id: string;
  file: File;
  previewUrl: string;
  focus: CoverFocus;
  isPrimary: boolean;
}

export interface CoverCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function defaultCoverFocus(): CoverFocus {
  return { cx: 0.5, cy: 0.5, zoom: 1 };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeFocus(focus: CoverFocus): CoverFocus {
  return {
    cx: clamp(focus.cx, 0, 1),
    cy: clamp(focus.cy, 0, 1),
    zoom: clamp(focus.zoom, COVER_MIN_ZOOM, COVER_MAX_ZOOM),
  };
}

/**
 * Largest 16:10 window that fits in the image at the given zoom, centered on focus.
 */
export function computeCoverCropRect(
  imageWidth: number,
  imageHeight: number,
  focus: CoverFocus,
): CoverCropRect {
  const normalized = normalizeFocus(focus);
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let cropWidth: number;
  let cropHeight: number;
  if (imageWidth / imageHeight > COVER_CARD_ASPECT) {
    cropHeight = imageHeight / normalized.zoom;
    cropWidth = cropHeight * COVER_CARD_ASPECT;
  } else {
    cropWidth = imageWidth / normalized.zoom;
    cropHeight = cropWidth / COVER_CARD_ASPECT;
  }

  cropWidth = Math.min(cropWidth, imageWidth);
  cropHeight = Math.min(cropHeight, imageHeight);

  const x = clamp(normalized.cx * imageWidth - cropWidth / 2, 0, imageWidth - cropWidth);
  const y = clamp(normalized.cy * imageHeight - cropHeight / 2, 0, imageHeight - cropHeight);

  return { x, y, width: cropWidth, height: cropHeight };
}

/** Keep the crop fully inside the image after a pan/zoom change. */
export function clampFocusToImage(
  imageWidth: number,
  imageHeight: number,
  focus: CoverFocus,
): CoverFocus {
  const normalized = normalizeFocus(focus);
  const crop = computeCoverCropRect(imageWidth, imageHeight, normalized);
  if (crop.width <= 0 || crop.height <= 0) return normalized;
  return {
    cx: (crop.x + crop.width / 2) / imageWidth,
    cy: (crop.y + crop.height / 2) / imageHeight,
    zoom: normalized.zoom,
  };
}

function loadImage(url: string, timeoutMs = 8_000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('Timed out loading cover image.'));
    }, timeoutMs);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Failed to load cover image.'));
    };
    image.src = url;
  });
}

/**
 * Rasterize the focus crop to a JPEG suitable for the template cover API.
 * Falls back to the original file when canvas export is unavailable (e.g. jsdom).
 */
export async function exportPrimaryCoverFile(item: CoverImageItem): Promise<File> {
  try {
    const image = await loadImage(item.previewUrl);
    const crop = computeCoverCropRect(image.naturalWidth, image.naturalHeight, item.focus);
    if (crop.width < 1 || crop.height < 1) return item.file;

    const outputWidth = Math.max(1, Math.round(Math.min(1280, crop.width)));
    const outputHeight = Math.max(1, Math.round(outputWidth / COVER_CARD_ASPECT));

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return item.file;

    ctx.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) return item.file;

    const baseName = item.file.name.replace(/\.[^.]+$/, '') || 'template-cover';
    return new File([blob], `${baseName}-cover.jpg`, { type: 'image/jpeg' });
  } catch {
    return item.file;
  }
}
