import MarkdownIt = require('markdown-it');
import type { EmbeddedMessage } from '../interfaces/share.interface';

/**
 * Builds the private-share email: the conversation content is embedded in the
 * body with a link to the (forked or public) copy. Email clients strip
 * <style> blocks and scripts, so everything is inline-styled and chart
 * components degrade to data tables.
 */

// ponytail: emails keep the oldest 40 messages (conclusions often live at the
// end); if that bothers recipients, keep the last N instead of the first.
const MAX_EMBEDDED_MESSAGES = 40;
const MAX_CHART_ROWS = 50;

// html:false escapes raw HTML in the source, so conversation content cannot
// inject markup into the email.
const markdown = new MarkdownIt({ html: false, linkify: false });

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Markdown to HTML — html:false escapes raw HTML, so content cannot inject markup. */
function markdownToHtml(source: string): string {
  return markdown.render(source);
}

function chartToHtml(data: Record<string, unknown>): string {
  const records = Array.isArray(data.data) ? (data.data as Record<string, unknown>[]) : [];
  if (!records.length) return '';
  const series = Array.isArray(data.series) ? (data.series as { dataKey: string; label?: string }[]) : [];
  const columns = series.length
    ? series.map((entry) => ({ key: entry.dataKey, label: entry.label || entry.dataKey }))
    : Object.keys(records[0]).map((key) => ({ key, label: key }));
  const title = typeof data.title === 'string' && data.title ? `<p style="margin:12px 0 4px;font-weight:600;">${escapeHtml(data.title)}</p>` : '';
  const head = columns.map((column) => `<th style="border:1px solid #d1d5db;padding:4px 8px;text-align:left;background:#f3f4f6;">${escapeHtml(column.label)}</th>`).join('');
  const rows = records
    .slice(0, MAX_CHART_ROWS)
    .map((record) => `<tr>${columns.map((column) => `<td style="border:1px solid #d1d5db;padding:4px 8px;">${escapeHtml(String(record[column.key] ?? ''))}</td>`).join('')}</tr>`)
    .join('');
  return `${title}<table style="border-collapse:collapse;font-size:12px;">${rows ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${rows}</tbody></table>`;
}

function componentToEmailHtml(component: { type: string; data: Record<string, unknown> }): string {
  const data = component.data || {};
  switch (component.type) {
    case 'text':
      return markdownToHtml(String(data.content || ''));
    case 'code':
      return `<pre style="background:#f3f4f6;padding:10px;font-size:12px;overflow-x:auto;"><code>${escapeHtml(String(data.content || ''))}</code></pre>`;
    case 'plan': {
      const title = String(data.title || '');
      const steps = Array.isArray(data.steps) ? (data.steps as unknown[]) : [];
      return `${title ? `<h3 style="font-size:14px;">${escapeHtml(title)}</h3>` : ''}<ul>${steps.map((step) => `<li>${escapeHtml(String(step))}</li>`).join('')}</ul>`;
    }
    case 'checkpoint':
      return `<hr><p><strong>${escapeHtml(String(data.content || ''))}</strong></p>`;
    case 'error':
      return `<blockquote style="border-left:3px solid #ef4444;margin:8px 0;padding-left:10px;"><strong>${escapeHtml(String(data.title || 'Error'))}</strong>: ${escapeHtml(String(data.content || ''))}</blockquote>`;
    case 'sandbox': {
      let html = `<pre style="background:#f3f4f6;padding:10px;font-size:12px;overflow-x:auto;"><code>${escapeHtml(String(data.code || ''))}</code></pre>`;
      if (data.output) html += `<pre style="background:#f3f4f6;padding:10px;font-size:12px;overflow-x:auto;"><code>${escapeHtml(String(data.output))}</code></pre>`;
      if (data.error) html += `<pre style="background:#fef2f2;padding:10px;font-size:12px;overflow-x:auto;"><code>${escapeHtml(String(data.error))}</code></pre>`;
      return html;
    }
    case 'chart':
      return chartToHtml(data);
    case 'webPreview':
      return `<p style="font-size:12px;color:#6b7280;"><em>Interactive HTML preview — open the conversation to view it.</em></p>`;
    case 'artifact':
      return `<p>📎 ${escapeHtml(String(data.filename || 'file'))}</p>`;
    case 'sources': {
      const sources = Array.isArray(data.sources) ? (data.sources as { title?: string; url?: string }[]) : [];
      if (!sources.length) return '';
      return `<p style="margin:8px 0 2px;font-size:12px;font-weight:600;color:#6b7280;">Sources</p><ul style="font-size:12px;color:#374151;">${sources
        .map((source) => `<li>${escapeHtml(String(source.title || source.url || ''))}</li>`)
        .join('')}</ul>`;
    }
    default:
      return '';
  }
}

function messageToHtml(message: EmbeddedMessage): string {
  if (message.conversationType === 'user') {
    const content = escapeHtml(message.content || '').replace(/\n/g, '<br>');
    return `<div style="background:#eef2ff;border-radius:8px;padding:10px 12px;margin:8px 0;">${content}</div>`;
  }
  return (message.components || [])
    .map((component) => componentToEmailHtml({ type: String(component.type), data: component.data || {} }))
    .filter(Boolean)
    .join('\n');
}

function messageToText(message: EmbeddedMessage): string {
  if (message.conversationType === 'user') return message.content || '';
  return (message.components || [])
    .map((component) => {
      const data = component.data || {};
      switch (String(component.type)) {
        case 'text':
          return String(data.content || '');
        case 'code':
          return String(data.content || '');
        case 'sandbox':
          return String(data.code || data.output || data.error || '');
        case 'chart':
          return data.title ? `[chart: ${String(data.title)}]` : '[chart]';
        case 'webPreview':
          return '[interactive HTML preview]';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

export interface ShareEmailBody {
  html: string;
  text: string;
}

export function buildShareEmailBody(title: string, conversationUrl: string, messages: readonly EmbeddedMessage[]): ShareEmailBody {
  const embedded = messages.slice(0, MAX_EMBEDDED_MESSAGES);
  const truncationNote = messages.length > MAX_EMBEDDED_MESSAGES
    ? `<p style="font-size:12px;color:#6b7280;">… ${messages.length - MAX_EMBEDDED_MESSAGES} more messages. Open the conversation to see everything.</p>`
    : '';
  const body = embedded.map(messageToHtml).filter(Boolean).join('\n');

  const html = [
    `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;color:#1f2937;line-height:1.5;">`,
    `<h2 style="font-size:18px;margin:16px 0 4px;">${escapeHtml(title)}</h2>`,
    `<p>A YelloStorm conversation has been shared with you. Its content is included below.</p>`,
    `<p><a href="${conversationUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:6px;font-weight:600;">Open conversation</a></p>`,
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">`,
    body || '<p style="color:#6b7280;">This conversation has no visible content.</p>',
    truncationNote,
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">`,
    `<p style="font-size:12px;color:#6b7280;">Open conversation: <a href="${conversationUrl}">${conversationUrl}</a></p>`,
    `</div>`,
  ].join('\n');

  const textParts = embedded.map(messageToText).filter(Boolean);
  const text = [
    `A YelloStorm conversation has been shared with you: ${title}`,
    '',
    ...textParts,
    ...(messages.length > MAX_EMBEDDED_MESSAGES ? [`… ${messages.length - MAX_EMBEDDED_MESSAGES} more messages.`] : []),
    '',
    'Open conversation:',
    conversationUrl,
  ].join('\n');

  return { html, text };
}
