const PRINT_CLEANUP_MS = 5_000;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildMessagePdfDocument(title: string, bodyHtml: string, subtitle?: string): string {
  const subtitleHtml = subtitle
    ? `<p style="color:#6b7280;font-size:12px;margin:0 0 24px;">${escapeHtml(subtitle)}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #111827; font-size: 14px; line-height: 1.6; max-width: 800px; margin: 32px auto; padding: 0 24px; }
    h1, h2, h3 { line-height: 1.3; }
    pre { background: #f3f4f6; padding: 12px 16px; overflow-x: auto; border-radius: 6px; white-space: pre-wrap; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
    a { color: #2563eb; }
    @media print { body { margin: 0; max-width: none; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${subtitleHtml}
  ${bodyHtml}
</body>
</html>`;
}

export function printHtmlDocument(html: string): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error('print-frame-unavailable');
  }

  doc.open();
  doc.write(html);
  doc.close();
  win.focus();
  win.print();
  window.setTimeout(() => iframe.remove(), PRINT_CLEANUP_MS);
}
