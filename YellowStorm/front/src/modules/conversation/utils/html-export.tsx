import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface HtmlExportBlock {
  label: string;
  timestamp?: string;
  markdown: string;
}

export function exportBlocksToHtml(blocks: HtmlExportBlock[], title: string): Blob {
  const content = renderToStaticMarkup(
    <main>
      <h1>{title}</h1>
      {blocks.map((block, index) => (
        <section key={index}>
          <header>{block.label}{block.timestamp ? ` · ${block.timestamp}` : ''}</header>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.markdown}</ReactMarkdown>
        </section>
      ))}
    </main>,
  );
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui,sans-serif;color:#172033}h1{border-bottom:1px solid #d7dce5;padding-bottom:16px}section{margin:32px 0}header{color:#667085;font-size:14px;font-weight:600}pre{overflow:auto;padding:16px;background:#f4f6f8;border-radius:6px}code{font-family:ui-monospace,monospace}table{border-collapse:collapse}th,td{border:1px solid #d7dce5;padding:6px 10px}img{max-width:100%}blockquote{border-left:3px solid #98a2b3;margin-left:0;padding-left:16px;color:#475467}</style></head><body>${content}</body></html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
