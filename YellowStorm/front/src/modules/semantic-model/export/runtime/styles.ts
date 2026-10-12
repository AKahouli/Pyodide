/** The page's own styles, kept as a string so the file needs no stylesheet and tests see the same text as the build. */
export const EXPORT_STYLES = `
:root { color-scheme: dark; --bg: #0f0f1a; --panel: #15152a; --line: rgba(255,255,255,.1); --text: #f3f4f6; --muted: rgba(255,255,255,.5); --accent: #7dd3fc; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
.heading { min-width: 0; }
h1 { margin: 0; font-size: 15px; }
.sub { margin: 0; color: var(--muted); font-size: 12px; }
.muted { color: var(--muted); }
.small { font-size: 11px; }
.search { position: relative; width: 300px; max-width: 100%; }
.search input { width: 100%; height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.05); color: var(--text); font: inherit; }
#results { position: absolute; z-index: 5; left: 0; right: 0; top: 36px; margin: 0; padding: 4px 0; list-style: none; background: #1a1a2b; border: 1px solid var(--line); border-radius: 6px; max-height: 320px; overflow: auto; }
#results button { display: flex; width: 100%; gap: 8px; align-items: center; padding: 6px 12px; text-align: left; }
#results button:hover { background: rgba(255,255,255,.08); }
#results .empty { padding: 8px 12px; color: var(--muted); font-size: 12px; }
.grow { flex: 1; min-width: 0; }
.name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tools { display: flex; gap: 4px; margin-left: auto; }
.tools button { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--line); font-size: 12px; color: rgba(255,255,255,.75); }
.tools button[aria-pressed="true"] { background: rgba(255,255,255,.15); color: #fff; }
.legend { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; font-size: 12px; color: rgba(255,255,255,.75); white-space: nowrap; }
.chip:hover { background: rgba(255,255,255,.08); }
.chip.off { color: rgba(255,255,255,.3); text-decoration: line-through; }
.count { color: var(--muted); font-variant-numeric: tabular-nums; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }
.link { color: var(--accent); text-align: left; }
.link:hover { text-decoration: underline; }
main { flex: 1; display: flex; min-height: 0; position: relative; }
#graph { flex: 1; min-width: 0; position: relative; overflow: hidden; }
#graph svg { display: block; width: 100%; height: 100%; font-family: system-ui, sans-serif; touch-action: none; cursor: grab; }
#graph svg .node { cursor: pointer; }
#graph svg .node:focus-visible circle.body { stroke: var(--accent); }
.edge-label { fill: rgba(255,255,255,.6); font-size: 10px; paint-order: stroke; stroke: var(--bg); stroke-width: 3px; pointer-events: none; }
#selection { position: absolute; left: 12px; top: 12px; z-index: 2; display: flex; align-items: center; gap: 8px; max-width: calc(100% - 24px); padding: 6px 8px 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(21,21,42,.92); }
[hidden] { display: none !important; }
#selection .name { max-width: 24ch; font-weight: 600; }
#selection button { padding: 3px 8px; border-radius: 6px; border: 1px solid var(--line); font-size: 12px; }
#selection button[aria-pressed="true"] { background: rgba(255,255,255,.15); }
#selection .icon { border: 0; }
#status { position: absolute; left: 12px; bottom: 8px; display: flex; gap: 16px; margin: 0; font-size: 12px; color: var(--muted); pointer-events: none; }
.ring { display: inline-block; width: 12px; height: 12px; border: 2px solid #fbbf24; border-radius: 50%; vertical-align: -2px; margin-right: 4px; }
#loading { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 24px; text-align: center; color: var(--muted); }
#panel { width: min(420px, 100%); display: flex; flex-direction: column; border-left: 1px solid var(--line); background: var(--panel); z-index: 3; }
#panel header { display: flex; gap: 8px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--line); }
#panel h2 { margin: 6px 0 2px; font-size: 16px; word-break: break-word; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
.icon { padding: 4px 6px; border-radius: 4px; color: var(--muted); }
.icon:hover { background: rgba(255,255,255,.1); color: #fff; }
.scroll { flex: 1; overflow: auto; padding: 12px 16px 32px; }
h3 { margin: 16px 0 6px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.scroll section:first-child h3 { margin-top: 0; }
dl { margin: 0; }
.row { padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
dt { font-size: 11px; color: var(--muted); }
dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
dd.clamp { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
dd.missing { color: rgba(251,191,36,.7); font-style: italic; }
.missing-toggle { margin-top: 8px; font-size: 12px; color: rgba(251,191,36,.8); }
.group { font-size: 12px; color: rgba(255,255,255,.75); padding: 3px 0; text-align: left; }
.groups, .groups ul { list-style: none; margin: 0; padding: 0; }
.groups ul { margin-left: 14px; padding-left: 8px; border-left: 1px solid var(--line); }
.groups ul .link { font-size: 12px; padding: 1px 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
@media (max-width: 720px) { #panel { position: absolute; inset: 0; width: 100%; } .tools { margin-left: 0; } .search { width: 100%; } }
`;
