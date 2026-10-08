const fs = require('fs');
const path = require('path');

const runs = ['2bf9b022-a576-4a73-bd05-721c1de2ae71', '2d523824-e240-46fe-a5ea-697fb167a94b', '0022dca1-ec6e-41ac-b14a-a0cba60cc9d1'];

for (const id of runs) {
  const dir = path.join('uploads', 'eval', id);
  const res = path.join(dir, 'results.json');
  console.log('================', id, '================');
  if (!fs.existsSync(res)) { console.log('no results.json'); continue; }
  const data = JSON.parse(fs.readFileSync(res, 'utf8'));
  const arr = Array.isArray(data) ? data : (data.results || []);
  for (const r of arr) {
    console.log('-', r.query_id || r.queryId, '| status:', r.status);
    const m = r.metrics || r;
    console.log('  retrieval recall/prec/pageHit/em:', m.retrieval_recall, m.retrieval_precision, m.retrieval_page_hit, m.retrieval_exact_match);
    console.log('  retrieved_files:', JSON.stringify(m.retrieved_files || r.retrieved_files));
    console.log('  retrieved_pages:', JSON.stringify(m.retrieved_pages || r.retrieved_pages));
    console.log('  retrieved_sources:', JSON.stringify(m.retrieved_sources || r.retrieved_sources));
    console.log('  tool_calls keys:', r.tool_calls ? r.tool_calls.map((t) => t.nodeId).join(',') : '(none)');
    if (r.tool_calls && r.tool_calls.length) {
      for (const tc of r.tool_calls) {
        for (const item of (tc.trace || [])) {
          const args = item.args !== undefined ? JSON.stringify(item.args).slice(0, 300) : '(no args)';
          const out = item.output_summary !== undefined ? JSON.stringify(item.output_summary).slice(0, 200) : (item.output !== undefined ? JSON.stringify(item.output).slice(0, 200) : '(no out)');
          console.log('    TOOL', item.tool_name || item.tool || '?', '| args:', args, '| out:', out);
        }
      }
    }
  }
}