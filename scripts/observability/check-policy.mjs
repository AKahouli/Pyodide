// Observability logging policy (plan §11.1): hard-fails on NEW violations; a committed
// baseline holds known legacy call sites which must shrink, never grow.
// Usage: node scripts/observability/check-policy.mjs [--baseline scripts/observability/policy-baseline.json]
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const require = createRequire(path.join(repoRoot, 'YellowStorm', 'back', 'package.json'));
const ts = require('typescript');

const args = process.argv.slice(2);
const baselineArg = args.includes('--baseline') ? args[args.indexOf('--baseline') + 1] : 'scripts/observability/policy-baseline.json';

const SCOPES = [
  { name: 'yellowstorm-back', root: 'YellowStorm/back/src', lang: 'ts', exclude: [/\.spec\.ts$/, /node_modules/, /\/dist\//] },
  { name: 'yellowstorm-code-runtime', root: 'yellowstorm-code-runtime/src', lang: 'ts', exclude: [/\.spec\.ts$/, /\.test\.ts$/, /node_modules/, /\/dist\//, /telemetry/] },
  { name: 'yellowstorm-adk', root: 'yellowstorm-adk/src', lang: 'py', exclude: [/__pycache__/, /grpc_generated/] },
  { name: 'mcp', root: 'mcp', lang: 'py', exclude: [/__pycache__/] },
];

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'contracts', 'observability', 'log-events.v1.json'), 'utf8'));
const knownEvents = new Set(Object.keys(registry.events));

function walk(dir, exclude, out = []) {
  const fs = require('node:fs');
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (exclude.some((re) => re.test(rel))) continue;
      walk(full, exclude, out);
    } else if (/\.(ts|py)$/.test(entry.name) && !exclude.some((re) => re.test(rel))) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

// --- TypeScript: parse each file and inspect call expressions -------------------------------
function checkTs(scope) {
  const files = walk(path.join(repoRoot, scope.root), scope.exclude).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    const rel = path.relative(repoRoot, file).replaceAll('\\', '/');
    const sourceFile = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        const firstArg = node.arguments[0];
        // console.* diagnostics in owned code
        if (/^console\.(log|error|warn|info|debug)$/.test(text)) {
          violations.push({ file: rel, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, rule: 'console-diagnostic', detail: text });
        }
        // registry event names on the shared logger API
        if (/logger\.(debug|info|warn|error|fatal)$/.test(text) && firstArg && ts.isStringLiteral(firstArg)) {
          const name = firstArg.text;
          if (!knownEvents.has(name)) {
            violations.push({ file: rel, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, rule: 'unknown-event-name', detail: name });
          }
        }
      }
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
  }
}

// --- Python: line-level checks (fast, conservative) -------------------------------------------
function checkPy(scope) {
  const files = walk(path.join(repoRoot, scope.root), scope.exclude).filter((f) => f.endsWith('.py'));
  for (const file of files) {
    const rel = path.relative(repoRoot, file).replaceAll('\\', '/');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (/^\s*print\(/.test(line) && !trimmed.startsWith('#')) {
        violations.push({ file: rel, line: i + 1, rule: 'print-diagnostic', detail: trimmed.slice(0, 60) });
      }
      // direct structlog/pino-style configuration bypassing the SDK bootstrap
      if (/structlog\.configure\(/.test(line) && !rel.includes('_observability') && !rel.includes('yellowmind_observability')) {
        violations.push({ file: rel, line: i + 1, rule: 'direct-structlog-configure', detail: trimmed.slice(0, 60) });
      }
    });
  }
}

for (const scope of SCOPES) {
  if (scope.lang === 'ts') checkTs(scope);
  else checkPy(scope);
}

// Baseline keys are file:rule (NOT file:line:rule): line numbers drift with any upstream edit,
// which would flag unchanged legacy sites as new. Per-file growth within a baselined rule is a
// known residual gap; new files always fail. Multiple call sites in one file collapse to one key.
const current = [...new Set(violations.map((v) => `${v.file}:${v.rule}`))].sort();
const baselinePath = path.join(repoRoot, baselineArg);
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8')).violations.sort()
  : [];

const baselineSet = new Set(baseline);
const newViolations = current.filter((v) => !baselineSet.has(v));

if (args.includes('--update-baseline')) {
  const fs = require('node:fs');
  // Replace with the sites still present — this is what makes the list shrink
  // when legacy call sites are retired (plan P11). Merging instead would keep
  // stale entries forever and break the shrink-only invariant.
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        _comment: 'Known legacy diagnostic call sites (plan §11.1). This list must shrink, never grow. Regenerate with: node scripts/observability/check-policy.mjs --update-baseline',
        owner: 'platform-team',
        removal_task: 'P11 legacy retirement',
        violations: current,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`[observability-policy] baseline updated: ${current.length} entr(ies)`);
  process.exit(0);
}

if (newViolations.length > 0) {
  console.error(`[observability-policy] FAIL: ${newViolations.length} new violation(s):`);
  for (const v of newViolations) console.error(`  ${v}`);
  console.error('Known legacy call sites live in scripts/observability/policy-baseline.json and may only shrink.');
  process.exit(1);
}

const currentSet = new Set(current);
const fixed = baseline.filter((v) => !currentSet.has(v));
if (fixed.length > 0) {
  console.log(`[observability-policy] ${fixed.length} baseline entr(ies) no longer present — run with --update-baseline to shrink it`);
}
console.log(`[observability-policy] PASS: no new violations (${baseline.length} baselined legacy site(s))`);
