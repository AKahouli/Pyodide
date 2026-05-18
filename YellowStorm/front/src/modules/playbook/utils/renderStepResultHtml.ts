import type { TaskResult, PlaybookComponent, SemanticMatchResult, ToolTraceItem, PlaybookExecution } from '../types';
import type { MessageComponent } from '@/modules/conversation/types';
import { getSafeArtifactUrl } from './safe-artifact-url';
import { getPreferredStepResultText } from './step-result-display';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleString();
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return '#16a34a';
    case 'failed': return '#dc2626';
    case 'running': return '#2563eb';
    case 'interrupted': return '#d97706';
    case 'skipped': return '#6b7280';
    case 'pending': return '#9ca3af';
    default: return '#6b7280';
  }
}

function getStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function renderCodeBlock(code: string, language: string): string {
  return `<pre style="background:#f5f5f5;border:1px solid #e5e5e5;border-radius:6px;padding:12px 16px;overflow-x:auto;font-size:13px;line-height:1.5;margin:8px 0;"><code>${escapeHtml(code)}</code></pre>`;
}

function renderComponentToHtml(comp: MessageComponent): string {
  const data = comp.data || {};

  switch (comp.type) {
    case 'text': {
      const content = (data.content as string) || '';
      return renderMarkdownToHtml(content);
    }
    case 'code': {
      const lang = (data.language as string) || '';
      const content = (data.content as string) || '';
      const filename = (data.filename as string) || '';
      const header = filename ? `<div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${escapeHtml(filename)}</div>` : '';
      const langLabel = lang ? `<span style="font-size:11px;color:#9ca3af;margin-bottom:4px;display:inline-block;">${escapeHtml(lang)}</span>` : '';
      return `${header}${langLabel}${renderCodeBlock(content, lang)}`;
    }
    case 'reasoning': {
      const content = (data.content as string) || '';
      return `<blockquote style="border-left:3px solid #d1d5db;padding-left:12px;margin:8px 0;color:#4b5563;font-style:italic;">${escapeHtml(content)}</blockquote>`;
    }
    case 'plan': {
      const title = (data.title as string) || 'Plan';
      const steps = (data.steps as Array<{ task: string; agent?: string; status?: string }>) || [];
      const stepsHtml = steps.map((s, i) => {
        const statusIcon = s.status === 'completed' ? '&#10003;' : s.status === 'in_progress' ? '&#9679;' : '&#9675;';
        return `<li style="margin:4px 0;">${statusIcon} ${escapeHtml(s.task)}${s.agent ? ` <span style="color:#9ca3af;">(${escapeHtml(s.agent)})</span>` : ''}</li>`;
      }).join('');
      return `<div style="margin:8px 0;"><div style="font-weight:600;margin-bottom:6px;">${escapeHtml(title)}</div><ol style="padding-left:20px;">${stepsHtml}</ol></div>`;
    }
    case 'queue': {
      const title = (data.title as string) || 'Queue';
      const items = (data.items as Array<{ title: string; status: string }>) || [];
      const itemsHtml = items.map((item) => {
        const icon = item.status === 'completed' ? '&#10003;' : '&#9675;';
        const textStyle = item.status === 'completed' ? 'text-decoration:line-through;color:#9ca3af;' : '';
        return `<li style="margin:3px 0;"><span>${icon} <span style="${textStyle}">${escapeHtml(item.title)}</span></span></li>`;
      }).join('');
      return `<div style="margin:8px 0;"><div style="font-weight:600;margin-bottom:6px;">${escapeHtml(title)}</div><ul style="padding-left:20px;">${itemsHtml}</ul></div>`;
    }
    case 'checkpoint': {
      const label = (data.label as string) || (data.content as string) || 'Checkpoint';
      return `<div style="border-top:1px solid #d1d5db;margin:12px 0;padding-top:8px;font-size:13px;color:#6b7280;">&#9654; ${escapeHtml(label)}</div>`;
    }
    case 'error': {
      const title = (data.title as string) || 'Error';
      const content = (data.content as string) || '';
      return `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin:8px 0;"><div style="font-weight:600;color:#dc2626;margin-bottom:4px;">${escapeHtml(title)}</div><div style="color:#991b1b;font-size:13px;white-space:pre-wrap;">${escapeHtml(content)}</div></div>`;
    }
    case 'sources': {
      const sources = (data.sources as Array<{ title: string; url: string }>) || [];
      const linksHtml = sources.map(s => `<li style="margin:3px 0;"><a href="${escapeHtml(s.url)}" target="_blank" style="color:#2563eb;">${escapeHtml(s.title || s.url)}</a></li>`).join('');
      return linksHtml ? `<div style="margin:8px 0;"><div style="font-weight:600;margin-bottom:6px;">Sources</div><ul style="padding-left:20px;">${linksHtml}</ul></div>` : '';
    }
    case 'sandbox': {
      const code = (data.code as string) || '';
      const output = (data.output as string) || '';
      const error = (data.error as string) || '';
      let result = `<div style="margin:8px 0;"><div style="font-weight:600;margin-bottom:6px;">Sandbox Execution</div>`;
      if (code) result += renderCodeBlock(code, 'python');
      if (output) result += `<div style="margin-top:8px;font-weight:600;font-size:12px;color:#16a34a;">Output</div>${renderCodeBlock(output, '')}`;
      if (error) result += `<div style="margin-top:8px;font-weight:600;font-size:12px;color:#dc2626;">Error</div>${renderCodeBlock(error, '')}`;
      result += `</div>`;
      return result;
    }
    case 'webPreview': {
      const content = (data.content as string) || '';
      return `<div style="margin:8px 0;"><div style="font-weight:600;margin-bottom:6px;">Web Preview</div>${renderCodeBlock(content, 'html')}</div>`;
    }
    case 'artifact': {
      const filename = (data.filename as string) || 'file';
      const filePath = (data.filePath as string) || '';
      return `<div style="background:#f5f5f5;border:1px solid #e5e5e5;border-radius:6px;padding:8px 12px;margin:8px 0;font-size:13px;">&#128206; ${escapeHtml(filename)}${filePath ? `<span style="color:#9ca3af;margin-left:8px;">${escapeHtml(filePath)}</span>` : ''}</div>`;
    }
    case 'chart': {
      const title = (data.title as string) || 'Chart';
      const chartData = data.chartData;
      if (!chartData || !Array.isArray(chartData)) return '';
      const headers = Object.keys(chartData[0] || {});
      const tableHeader = headers.map(h => `<th style="border:1px solid #e5e5e5;padding:6px 10px;background:#f9fafb;font-size:12px;text-align:left;">${escapeHtml(h)}</th>`).join('');
      const tableRows = chartData.map(row => {
        const cells = headers.map(h => `<td style="border:1px solid #e5e5e5;padding:6px 10px;font-size:12px;">${escapeHtml(String(row[h] ?? ''))}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<div style="margin:8px 0;"><div style="font-weight:600;margin-bottom:6px;">${escapeHtml(title)}</div><table style="border-collapse:collapse;width:100%;"><thead><tr>${tableHeader}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
    }
    case 'citation': {
      const reference = (data.reference as string) || '';
      const source = (data.source as string) || (data.fileName as string) || 'Source';
      const page = (data.page as string) || '';
      const displayLabel = reference || source;
      return page ? `<span style="font-size:11px;color:#6b7280;">[${escapeHtml(displayLabel)}, p.${escapeHtml(page)}]</span>` : `<span style="font-size:11px;color:#6b7280;">[${escapeHtml(displayLabel)}]</span>`;
    }
    default:
      return (data.content as string) ? `<p>${escapeHtml(data.content as string)}</p>` : '';
  }
}

function renderMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  const blocks: Array<{ raw: boolean; text: string }> = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\|(.+)\|$/.test(line.trim())) {
      const headerCells = line.trim().split('|').slice(1, -1).map(c => c.trim());
      i++;

      if (i < lines.length && /^\|[\s:|-]+\|$/.test(lines[i].trim())) {
        i++;
      }

      const headerHtml = headerCells.map(c => `<th style="border:1px solid #d1d5db;padding:6px 10px;background:#f9fafb;font-size:13px;font-weight:600;text-align:left;">${escapeHtml(c)}</th>`).join('');
      const bodyRows: string[] = [];

      while (i < lines.length && /^\|(.+)\|$/.test(lines[i].trim())) {
        const cells = lines[i].trim().split('|').slice(1, -1).map(c => c.trim());
        const rowHtml = cells.map(c => `<td style="border:1px solid #d1d5db;padding:6px 10px;font-size:13px;">${escapeHtml(c)}</td>`).join('');
        bodyRows.push(`<tr>${rowHtml}</tr>`);
        i++;
      }

      blocks.push({ raw: true, text: `<table style="border-collapse:collapse;width:100%;margin:8px 0;"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>` });
    } else {
      blocks.push({ raw: false, text: line });
      i++;
    }
  }

  let html = blocks.map(b => b.raw ? b.text : escapeHtml(b.text)).join('\n');

  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:600;margin:16px 0 8px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:600;margin:20px 0 8px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:700;margin:20px 0 10px;">$1</h1>');

  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f5f5f5;padding:1px 4px;border-radius:3px;font-size:13px;">$1</code>');

  html = html.replace(/^[-*] (.+)$/gm, '<li style="margin:2px 0;">$1</li>');

  html = html.replace(/^(\d+)\. (.+)$/gm, '<li style="margin:2px 0;">$2</li>');

  html = html.replace(/(\[([^\]]+)\]\(([^)]+)\))/g, '<a href="$3" style="color:#2563eb;" target="_blank">$2</a>');

  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0;">');

  const finalLines = html.split('\n');
  const output: string[] = [];
  let inList = false;

  for (const line of finalLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<li') || trimmed.startsWith('<h') || trimmed.startsWith('<hr') || trimmed.startsWith('<pre') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<table') || trimmed.startsWith('<thead') || trimmed.startsWith('<tbody') || trimmed.startsWith('<tr') || trimmed === '') {
      if (inList && !trimmed.startsWith('<li')) {
        output.push('</ul>');
        inList = false;
      }
      output.push(line);
    } else {
      if (!inList) {
        output.push(`<p style="margin:4px 0;">${line}</p>`);
      } else {
        output.push(line);
      }
    }
  }
  if (inList) output.push('</ul>');

  return output.join('\n');
}

function renderComponentsToHtml(components: PlaybookComponent[]): string {
  if (!components || components.length === 0) return '';

  const parts: string[] = [];

  for (const comp of components) {
    if (comp.type === 'humanFeedback') {
      const data = comp.data as Record<string, unknown>;
      const type = (data.interruptType as string) || 'review';
      const message = (data.message as string) || '';
      const approved = data.approved as boolean | undefined;
      const reason = (data.reason as string) || '';
      const feedback = (data.feedback as string) || '';
      const statusLabel = approved === true ? 'Approved' : approved === false ? 'Rejected' : 'Pending';

      parts.push(`<div style="background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin:12px 0;">
        <div style="font-weight:600;font-size:13px;color:#1e40af;margin-bottom:6px;">Human Feedback (${escapeHtml(type)})</div>
        <div style="font-size:13px;margin-bottom:6px;">${escapeHtml(message)}</div>
        <div style="font-size:12px;color:#6b7280;">Status: <strong>${escapeHtml(statusLabel)}</strong></div>
        ${reason ? `<div style="font-size:12px;margin-top:4px;"><strong>Reason:</strong> ${escapeHtml(reason)}</div>` : ''}
        ${feedback ? `<div style="font-size:12px;margin-top:4px;"><strong>Feedback:</strong> ${escapeHtml(feedback)}</div>` : ''}
      </div>`);
    } else {
      parts.push(renderComponentToHtml(comp as MessageComponent));
    }
  }

  return parts.join('\n');
}

function renderToolTrace(items: ToolTraceItem[]): string {
  if (!items || items.length === 0) return '';

  const itemsHtml = items.map(item => {
    const argsStr = JSON.stringify(item.args, null, 2);
    return `<div style="background:#f9fafb;border:1px solid #e5e5e5;border-radius:6px;padding:12px;margin:6px 0;">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px;">
        <span style="color:#6b7280;">#${item.callIndex}</span> 
        <code style="background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:12px;">${escapeHtml(item.toolName)}</code>
      </div>
      <div style="font-size:12px;margin-bottom:6px;"><strong style="color:#6b7280;">Args:</strong></div>
      <pre style="background:#f5f5f5;border:1px solid #e5e5e5;border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;max-height:200px;">${escapeHtml(argsStr)}</pre>
      ${item.outputSummary ? `<div style="font-size:12px;margin-top:6px;"><strong style="color:#6b7280;">Output:</strong></div><pre style="background:#f5f5f5;border:1px solid #e5e5e5;border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;max-height:200px;white-space:pre-wrap;">${escapeHtml(item.outputSummary)}</pre>` : ''}
    </div>`;
  }).join('');

  return `<div style="margin:16px 0;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Tool Trace (${items.length} call${items.length !== 1 ? 's' : ''})</h3>${itemsHtml}</div>`;
}

function renderEvaluation(evalData: SemanticMatchResult): string {
  const scores = [
    { label: 'Overall', value: evalData.matchScore },
    { label: 'Embedding Similarity', value: evalData.semanticSimilarityScore },
    { label: 'Evidence Consistency', value: evalData.evidenceConsistencyScore },
    { label: 'Judge Score', value: evalData.judgeScore },
  ];

  const scoresHtml = scores.map(s => `
    <div style="background:white;border-radius:6px;padding:10px 12px;text-align:center;">
      <div style="font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;">${s.label}</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px;color:#111827;">${Math.round(s.value)}%</div>
    </div>`).join('');

  let additionalSections = '';
  if (evalData.reason) {
    additionalSections += `<div style="margin-top:12px;background:white;border-radius:6px;padding:10px 12px;">
      <div style="font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;">Reason</div>
      <div style="margin-top:4px;font-size:13px;white-space:pre-wrap;">${escapeHtml(evalData.reason)}</div>
    </div>`;
  }

  if (evalData.missingPoints?.length || evalData.changedPoints?.length) {
    additionalSections += `<div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">`;
    if (evalData.missingPoints?.length) {
      const list = evalData.missingPoints.map(p => `<li style="margin:2px 0;">${escapeHtml(p)}</li>`).join('');
      additionalSections += `<div style="background:white;border-radius:6px;padding:10px 12px;">
        <div style="font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;">Missing Points</div>
        <ul style="padding-left:16px;margin-top:4px;font-size:13px;">${list}</ul>
      </div>`;
    }
    if (evalData.changedPoints?.length) {
      const list = evalData.changedPoints.map(p => `<li style="margin:2px 0;">${escapeHtml(p)}</li>`).join('');
      additionalSections += `<div style="background:white;border-radius:6px;padding:10px 12px;">
        <div style="font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;">Changed Points</div>
        <ul style="padding-left:16px;margin-top:4px;font-size:13px;">${list}</ul>
      </div>`;
    }
    additionalSections += `</div>`;
  }

  return `<div style="margin:16px 0;">
    <h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Evaluation</h3>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">${scoresHtml}</div>
    ${additionalSections}
    <div style="margin-top:8px;font-size:11px;color:#9ca3af;">${evalData.judgeUsed ? `Judge model: ${escapeHtml(evalData.model || '-')}` : 'Embedding-only fallback used'}</div>
  </div>`;
}

function renderStepResultBody(step: TaskResult, options?: { includeToolTrace?: boolean; includeEvaluation?: boolean; includePrompts?: boolean }): string {
  const includeToolTrace = options?.includeToolTrace ?? true;
  const includeEvaluation = options?.includeEvaluation ?? true;
  const includePrompts = options?.includePrompts ?? false;

  let mainContent = '';

  if (step.error) {
    mainContent += `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:16px 0;">
      <div style="font-weight:600;color:#dc2626;font-size:13px;margin-bottom:6px;">&#9888; Error</div>
      <pre style="white-space:pre-wrap;font-size:13px;color:#991b1b;font-family:monospace;margin:0;">${escapeHtml(step.error)}</pre>
    </div>`;
  }

  if (step.components && step.components.length > 0) {
    mainContent += renderComponentsToHtml(step.components);
  } else {
    const resultText = getPreferredStepResultText(step);
    if (resultText) {
      mainContent += `<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;margin:8px 0;">${escapeHtml(resultText)}</div>`;
    }
  }

  if (step.artifacts && step.artifacts.length > 0) {
    const artifactItems = step.artifacts.map((artifact) => {
      const title = artifact.filename || artifact.portId;
      const meta = [artifact.artifactKind, artifact.mimeType].filter(Boolean).join(' · ');
      const safeUrl = getSafeArtifactUrl(artifact.url);
      const link = safeUrl
        ? `<div style="margin-top:4px;"><a href="${escapeHtml(safeUrl)}" target="_blank" style="color:#2563eb;">${escapeHtml(safeUrl)}</a></div>`
        : '';
      const preview = artifact.content
        ? `<pre style="margin-top:6px;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:4px;padding:8px;font-size:11px;white-space:pre-wrap;">${escapeHtml(artifact.content)}</pre>`
        : '';
      return `<div style="background:#f9fafb;border:1px solid #e5e5e5;border-radius:6px;padding:10px 12px;margin:6px 0;">
        <div style="font-weight:600;font-size:13px;">${escapeHtml(title)}</div>
        ${meta ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${escapeHtml(meta)}</div>` : ''}
        ${link}
        ${preview}
      </div>`;
    }).join('');
    mainContent += `<div style="margin:16px 0;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Artifacts</h3>${artifactItems}</div>`;
  }

  if (includeEvaluation && step.semanticMatch) {
    mainContent += renderEvaluation(step.semanticMatch);
  }

  if (includeToolTrace && step.toolTrace && step.toolTrace.length > 0) {
    mainContent += renderToolTrace(step.toolTrace);
  }

  if (includePrompts && step.llmPromptTrace && step.llmPromptTrace.length > 0) {
    const promptsHtml = step.llmPromptTrace.map((item, i) => {
      const stageLabel = item.stage ? item.stage.split('_').filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'LLM Call';
      return `<details style="background:#f9fafb;border:1px solid #e5e5e5;border-radius:6px;padding:8px 12px;margin:4px 0;">
        <summary style="cursor:pointer;font-size:13px;font-weight:500;">${i + 1}. ${escapeHtml(stageLabel)} &mdash; <code style="font-size:11px;">${escapeHtml(item.model || '-')}</code></summary>
        <pre style="margin-top:8px;max-height:400px;overflow:auto;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:4px;padding:8px;font-size:11px;white-space:pre-wrap;">${escapeHtml(item.prompt || '-')}</pre>
      </details>`;
    }).join('');
    mainContent += `<div style="margin:16px 0;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">LLM Prompts</h3>${promptsHtml}</div>`;
  }

  return mainContent;
}

function renderStepResultSection(step: TaskResult, options?: { includeToolTrace?: boolean; includeEvaluation?: boolean; includePrompts?: boolean }): string {
  const statusColor = getStatusColor(step.status);
  const statusLabel = getStatusLabel(step.status);
  const metadataRows = [
    step.agentName ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Agent</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${escapeHtml(step.agentName)}</td></tr>` : '',
    `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Started</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${formatDateTime(step.startedAt)}</td></tr>`,
    step.completedAt ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Completed</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${formatDateTime(step.completedAt)}</td></tr>` : '',
    `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Duration</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${formatDuration(step.durationMs)}</td></tr>`,
    step.modelName ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Model</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${escapeHtml(step.modelName)}</td></tr>` : '',
    step.totalTokens != null ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Tokens</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${step.totalTokens.toLocaleString()}</td></tr>` : '',
  ].filter(Boolean).join('');

  return `<div style="border-top:1px solid #e5e5e5;padding-top:20px;margin-top:20px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <h2 style="font-size:18px;font-weight:700;">${escapeHtml(step.nodeTitle)}</h2>
      <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:white;background:${statusColor};">${statusLabel}</span>
    </div>
    <table style="border-collapse:collapse;">${metadataRows}</table>
    <div style="padding:0;">${renderStepResultBody(step, options)}</div>
  </div>`;
}

export function renderStepResultHtml(step: TaskResult, options?: { includeToolTrace?: boolean; includeEvaluation?: boolean; includePrompts?: boolean }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(step.nodeTitle)} - Step Result</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #111827; background: white; padding: 32px; max-width: 900px; margin: 0 auto; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <div style="border-bottom:2px solid #e5e5e5;padding-bottom:16px;margin-bottom:20px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <h1 style="font-size:20px;font-weight:700;">${escapeHtml(step.nodeTitle)}</h1>
      <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:white;background:${getStatusColor(step.status)};">${getStatusLabel(step.status)}</span>
    </div>
    <table style="border-collapse:collapse;">${[step.agentName ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Agent</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${escapeHtml(step.agentName)}</td></tr>` : '',
      `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Started</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${formatDateTime(step.startedAt)}</td></tr>`,
      step.completedAt ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Completed</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${formatDateTime(step.completedAt)}</td></tr>` : '',
      `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Duration</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${formatDuration(step.durationMs)}</td></tr>`,
      step.modelName ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Model</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${escapeHtml(step.modelName)}</td></tr>` : '',
      step.totalTokens != null ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Tokens</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${step.totalTokens.toLocaleString()}</td></tr>` : '',
    ].filter(Boolean).join('')}</table>
  </div>

  <div style="padding:0;">
    ${renderStepResultBody(step, options)}
  </div>

  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:11px;color:#9ca3af;text-align:center;">
    Generated on ${new Date().toLocaleString()} &middot; YellowStorm Playbook
  </div>
</body>
</html>`;
}

export function renderWorkflowExecutionResultsHtml(execution: PlaybookExecution): string {
  const sortedResults = [...(execution.taskResults || [])].sort((a, b) => a.order - b.order);
  const completedAt = execution.completedAt ? new Date(execution.completedAt).toLocaleString() : '-';
  const startedAt = execution.startedAt ? new Date(execution.startedAt).toLocaleString() : '-';
  const statusColor = getStatusColor(execution.status);
  const statusLabel = getStatusLabel(execution.status);

  const stepSections = sortedResults.map((step) => renderStepResultSection(step, {
    includeToolTrace: true,
    includeEvaluation: true,
    includePrompts: false,
  })).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow Results - ${escapeHtml(execution.playbookId)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #111827; background: white; padding: 32px; max-width: 1100px; margin: 0 auto; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <div style="border-bottom:2px solid #e5e5e5;padding-bottom:16px;margin-bottom:20px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
      <h1 style="font-size:20px;font-weight:700;">Workflow Results</h1>
      <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:white;background:${statusColor};">${statusLabel}</span>
    </div>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;">Execution</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${escapeHtml(execution.id)}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;">Playbook</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${escapeHtml(execution.playbookId)}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;">Started</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${startedAt}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;">Completed</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${completedAt}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;">Duration</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${formatDuration(execution.durationMs)}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;">Steps</td><td style="padding:4px 0;font-size:13px;font-weight:500;">${sortedResults.length.toLocaleString()}</td></tr>
    </table>
  </div>

  <div>
    ${stepSections || '<p style="color:#6b7280;font-size:14px;">No step results available.</p>'}
  </div>

  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:11px;color:#9ca3af;text-align:center;">
    Generated on ${new Date().toLocaleString()} &middot; YellowStorm Playbook
  </div>
</body>
</html>`;
}

export function downloadStepResultHtml(step: TaskResult, filename?: string): void {
  const html = renderStepResultHtml(step);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `${sanitizeFilename(step.nodeTitle)}-result.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadWorkflowExecutionResultsHtml(execution: PlaybookExecution, filename?: string): void {
  const html = renderWorkflowExecutionResultsHtml(execution);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `workflow-${sanitizeFilename(execution.id)}-results.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadStepResultPdf(step: TaskResult): void {
  const html = renderStepResultHtml(step);
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
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow!.focus();
  iframe.contentWindow!.print();
  setTimeout(() => {
    document.body.removeChild(iframe);
  }, 5000);
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
