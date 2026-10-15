import { fetchSlideExportImage } from '../api';
import { mapConversationComponentsToContentParts } from '../utils';
import type { ExportImageResolver } from './document-export';

/** Resolve saved selectors through existing scoped authorization, then embed bytes. */
export const resolveOpenUiExportImage: ExportImageResolver = async (source, component, message) => {
  await import('../components/openui/devtools-off');
  const { loadGeneratedImage, loadDocumentImage, GENERATED_IMAGE_REFERENCE } = await import('../components/openui/document-images');
  const scope = { conversationId: message.conversationId, messageId: message.id };
  let blob: Blob;
  if (GENERATED_IMAGE_REFERENCE.test(source)) blob = await loadGeneratedImage(source, scope);
  else if (/^\[\d+\]$/.test(source)) {
    const parts = mapConversationComponentsToContentParts(message.components ?? [component]);
    const citations = parts.flatMap((part) => part.type === 'text' && part.componentId === component.id ? part.citations ?? [] : []);
    const matches = citations.filter((item) => item.reference?.replace(/[\[\]\s]/g, '') === source.slice(1, -1));
    const owned = matches.filter((item) => component.id && item.parentId === component.id);
    const candidates = owned.length ? owned : matches.filter((item) => !item.parentId);
    const citation = candidates.length === 1 ? candidates[0] : undefined;
    if (!citation) throw new Error('Missing export image citation');
    blob = await loadDocumentImage(citation, scope);
  } else {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid export image');
    const data = await fetchSlideExportImage(scope.conversationId, scope.messageId, source, new AbortController().signal);
    const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
    if (!match) throw new Error('Invalid export image bytes');
    blob = new Blob([Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0))], { type: match[1] });
  }
  if (!['image/png', 'image/jpeg'].includes(blob.type)) {
    const image = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image conversion unavailable');
      context.drawImage(image, 0, 0);
      return canvas.toDataURL('image/png');
    } finally { image.close(); }
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};
