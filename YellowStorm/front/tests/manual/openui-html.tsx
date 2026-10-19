// Synthetic browser fixture only; excluded from the production build. No account data or APIs.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initI18n, LocalizationProvider } from '../../src/modules/localization';
import { HtmlViewContent } from '../../src/modules/conversation/components/openui/HtmlView';
import '../../src/index.css';

const html = `<style>body{padding:24px;background:#ecf5fb;color:#14344c;font:16px system-ui}input{padding:8px;border:1px solid #9bb4c8;border-radius:8px}h2{margin-top:0}.bar{height:18px;background:#1687a7;border-radius:8px}</style><h2>Boundary test</h2><label>Count <input aria-label="Count" type="number" data-state="count"></label><p>Current: <strong data-text="count"></strong></p><div class="bar" data-progress="count"></div><label>Show detail <input aria-label="Show detail" type="checkbox" data-state="show"></label><p data-show="show">Visible detail</p><label>Draft name <input aria-label="Draft name" data-state="name"></label><p data-text="name"></p><p id="script">Generated script removed</p><button id="change">Script increment</button><script>yellowmind.ready.then(()=>{document.getElementById('script').textContent='Generated script ran';document.getElementById('change').addEventListener('click',()=>yellowmind.setState({count:yellowmind.state.count+1}));let blocked=[];try{parent.document.body}catch{blocked.push('parent')};try{localStorage.getItem('qa')}catch{blocked.push('storage')};const p=document.createElement('p');p.textContent='Access blocked: '+blocked.join(', ');document.body.append(p)})</script>`;
function Fixture() {
  const [state, setState] = useState<Record<string, unknown>>({ count: 0, show: false, name: '' });
  const [mode, setMode] = useState<'strict' | 'interactive'>('strict');
  const [second, setSecond] = useState<Record<string, unknown>>({ count: 0, show: false, name: '' });
  return <main className='mx-auto max-w-3xl space-y-4 p-6'>
    <h1>HtmlView synthetic boundary QA</h1>
    <label>Fixture mode <select aria-label='Fixture mode' value={mode} onChange={e => setMode(e.target.value === 'interactive' ? 'interactive' : 'strict')}><option value='strict'>Strict</option><option value='interactive'>Interactive</option></select></label>
    <form><fieldset><HtmlViewContent html={html} title='Boundary test' value={state} onChange={setState} writable mode={mode} scheme='dark' /></fieldset></form>
    <output aria-label='Host typed state'>{JSON.stringify(state)}</output>
    <HtmlViewContent html={html} title='Second dashboard' value={second} onChange={setSecond} writable mode={mode} />
    <output aria-label='Second typed state'>{JSON.stringify(second)}</output>
  </main>;
}
await initI18n();
createRoot(document.getElementById('root')!).render(<StrictMode><LocalizationProvider><Fixture /></LocalizationProvider></StrictMode>);
