// Trusted HtmlView bridge. No application credentials or APIs.
(()=>{
let port,state={},writable=false,resolve;const listeners=new Set();
const ready=new Promise(r=>resolve=r);const clone=x=>JSON.parse(JSON.stringify(x));
function render(){document.querySelectorAll('[data-state]').forEach(el=>{const key=el.dataset.state;if(!(key in state))return;el.disabled=!writable;if(el.type==='checkbox')el.checked=state[key]===true;else el.value=state[key]??''});
document.querySelectorAll('[data-text]').forEach(el=>{const v=state[el.dataset.text];el.textContent=v==null?'':typeof v==='object'?JSON.stringify(v):String(v)});
document.querySelectorAll('[data-show]').forEach(el=>el.hidden=state[el.dataset.show]!==true);
document.querySelectorAll('[data-filter]').forEach(el=>{const v=state[el.dataset.filter];el.hidden=v!=='all'&&String(v)!==el.dataset.filterValue});
document.querySelectorAll('[data-progress]').forEach(el=>{const v=state[el.dataset.progress];el.style.width=typeof v==='number'?Math.max(0,Math.min(100,v))+'%':'0%'});
document.querySelectorAll('[data-attr-width],[data-attr-height],[data-attr-x],[data-attr-y]').forEach(el=>{for(const attr of ['width','height','x','y']){const v=state[el.getAttribute('data-attr-'+attr)];if(typeof v==='number'&&Number.isFinite(v))el.setAttribute(attr,String(Math.max(0,Math.min(10000,v))))}});
}
function emit(){render();for(const fn of listeners)try{fn(clone(state))}catch{} }
Object.defineProperty(window,'yellowmind',{value:Object.freeze({ready,get state(){return clone(state)},
setState(patch){if(!writable||!port)throw Error('View is read only');const next={...state,...patch};port.postMessage({type:'state',state:next});state=next;emit()},
subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}}),writable:false});
function capture(message){
const previous=writable;writable=false;
try {
 if(JSON.stringify(message.state)!==JSON.stringify(state))throw Error('State changed');
 const before=JSON.stringify(state),root=document.body.cloneNode(true),sources=[document.body,...document.body.querySelectorAll('*')],targets=[root,...root.querySelectorAll('*')];
 if(sources.length>3000)throw Error('Capture complexity');
 for(let i=0;i<sources.length;i++){
  const source=sources[i],target=targets[i],computed=getComputedStyle(source);
  if(computed.display==='none'||computed.visibility==='hidden'){target.remove();continue}
  for(const property of computed)target.style.setProperty(property,computed.getPropertyValue(property));
  if(source.tagName==='CANVAS'){const img=document.createElement('img');img.src=source.toDataURL('image/png');img.width=source.width;img.height=source.height;target.replaceWith(img)}
  if(['INPUT','TEXTAREA','SELECT'].includes(source.tagName)){const text=document.createElement('span');text.textContent=source.type==='checkbox'?String(source.checked):source.tagName==='SELECT'?(source.selectedOptions[0]?.textContent??source.value):source.value;target.replaceWith(text)}
 }
 root.querySelectorAll('script,style,link,meta').forEach(node=>node.remove());
 const wrapper=document.createElement('div');wrapper.style.cssText=root.style.cssText;wrapper.append(...root.childNodes);
 const html=wrapper.outerHTML,width=Math.ceil(document.documentElement.clientWidth),height=Math.ceil(document.documentElement.scrollHeight);
 if(html.length>1500000||width>1600||height>10000||before!==JSON.stringify(state))throw Error('Capture limit');
 port.postMessage({type:'capture',id:message.id,state:clone(state),capture:{html,width,height}});
}catch{port.postMessage({type:'capture',id:message.id,state:null})}finally{writable=previous}
}
function init(e){if(e.source!==parent||e.data?.type!=='ys-html-init'||!e.ports[0]||port)return;
port=e.ports[0];port.onmessage=e=>{if(e.data?.type==='capture'){capture(e.data);return}if(e.data?.type==='state'){state=clone(e.data.state);writable=e.data.writable===true;emit();resolve()} };
port.start();port.postMessage({type:'ready'});
function measure(){port.postMessage({type:'height',height:Math.ceil(document.documentElement.getBoundingClientRect().height)})}
new ResizeObserver(measure).observe(document.documentElement);measure();
}
addEventListener('message',init);
const loader=document.currentScript;
function announce(){parent.postMessage({type:'ys-html-shell-ready',token:loader.dataset.token},'*')}
addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='ys-html-probe'&&e.data.token===loader.dataset.token)announce()});
announce();
if(loader.dataset.mode==='interactive')ready.then(()=>{
  for(const script of document.querySelectorAll('script[type="application/yellowmind"]')){
    try { new Function(script.textContent)(); } catch { port?.postMessage({type:'error'}); }
  }
});
// Browser extensions can reject promises or throw in isolated worlds. Only attribute
// synchronous errors from this artifact URL; unrelated extension failures must not stop it.
addEventListener('error',e=>{if(e.filename===location.href)port?.postMessage({type:'error'})});
addEventListener('click',e=>{if(e.target.closest?.('a,form'))e.preventDefault()},true);
addEventListener('input',e=>{const el=e.target,key=el.dataset?.state;if(!key||!(key in state)||!writable)return;const value=el.type==='checkbox'?el.checked:el.type==='number'||el.type==='range'?(el.value===''?null:Number(el.value)):el.value;window.yellowmind.setState({[key]:value})});
addEventListener('change',e=>{if(e.target.tagName==='SELECT')e.target.dispatchEvent(new Event('input',{bubbles:true}))});
})();
