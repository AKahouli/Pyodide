function buildAvatarInitials(agentName: string): string {
  const parts = agentName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts[0]?.charAt(0)?.toUpperCase() || 'AI';
}

function buildWidgetHtml(agentDisplayName: string, avatarInitials: string): string {
  const safeName = agentDisplayName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeInitials = avatarInitials.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<button id="ys-widget-toggle" type="button" aria-label="Open chat with ' + safeName + '">',
    '  <span id="ys-widget-badge" role="status" aria-live="polite"></span>',
    '</button>',
    '<div id="ys-widget-panel" role="dialog" aria-label="' + safeName + ' chat">',
    '  <div id="ys-widget-header">',
    '    <div id="ys-widget-header-left">',
    '      <div id="ys-widget-avatar" aria-hidden="true">' + safeInitials + '</div>',
    '      <div id="ys-widget-title-wrap">',
    '        <span id="ys-widget-title">' + safeName + '</span>',
    '        <span id="ys-widget-subtitle"><span id="ys-widget-status-dot"></span>Online · replies in seconds</span>',
    '      </div>',
    '    </div>',
    '    <div id="ys-widget-header-actions">',
    '      <button id="ys-widget-menu-btn" type="button" aria-label="Chat options" aria-haspopup="menu" aria-expanded="false" title="Options">',
    '        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="19" r="1.75"/></svg>',
    '      </button>',
    '      <div id="ys-widget-menu" class="ys-menu" role="menu" hidden>',
    '        <button type="button" class="ys-menu-item" data-action="new-chat" role="menuitem"><span class="ys-menu-icon">↻</span>New conversation</button>',
    '        <button type="button" class="ys-menu-item" data-action="copy-chat" role="menuitem"><span class="ys-menu-icon">⎘</span>Copy transcript</button>',
    '        <button type="button" class="ys-menu-item" data-action="download-chat" role="menuitem"><span class="ys-menu-icon">↓</span>Download transcript</button>',
    '      </div>',
    '      <button id="ys-widget-close" type="button" aria-label="Close chat">✕</button>',
    '    </div>',
    '  </div>',
    '  <div id="ys-widget-toast" class="ys-toast" role="status" aria-live="polite"></div>',
    '  <div id="ys-widget-body">',
    '    <div id="ys-widget-messages">',
    '      <div id="ys-widget-empty" class="ys-empty">',
    '        <div class="ys-empty-icon" aria-hidden="true">',
    '          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    '        </div>',
    '        <p class="ys-empty-title">Chat with ' + safeName + '</p>',
    '        <p class="ys-empty-sub">Send a message to start the conversation</p>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <form id="ys-widget-form">',
    '    <input id="ys-widget-input" type="text" placeholder="Message ' + safeName + '…" autocomplete="off" aria-label="Message input" />',
    '    <button id="ys-widget-send" type="submit" aria-label="Send message"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
    '  </form>',
    '  <div id="ys-widget-powered">Powered by <span>YellowStorm</span></div>',
    '</div>',
  ].join('\n');
}

const WIDGET_STYLES = [
  '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");',
  '',
  '#ys-widget-root{position:fixed;right:20px;bottom:20px;z-index:99999;font-family:"Inter",system-ui,-apple-system,sans-serif;pointer-events:none;}',
  '#ys-widget-root *{box-sizing:border-box;pointer-events:auto;}',
  '',
  '#ys-widget-toggle{width:58px;height:58px;border:none;border-radius:50%;background:linear-gradient(145deg,#4f46e5 0%,#7c3aed 55%,#6366f1 100%);color:#fff;cursor:pointer;box-shadow:0 10px 40px rgba(79,70,229,.45),0 4px 12px rgba(15,23,42,.15);font-size:0;transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .22s ease;position:relative;display:flex;align-items:center;justify-content:center;}',
  '#ys-widget-toggle::before{content:"";width:26px;height:26px;background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z\'/%3E%3C/svg%3E") center/contain no-repeat;transition:transform .25s ease;}',
  '#ys-widget-toggle::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(99,102,241,.35);animation:ys-ring 2.8s ease-in-out infinite;pointer-events:none;}',
  '#ys-widget-toggle:hover{transform:scale(1.06);box-shadow:0 14px 48px rgba(79,70,229,.5),0 6px 16px rgba(15,23,42,.12);}',
  '#ys-widget-toggle.ys-active{transform:scale(1.02);}',
  '#ys-widget-toggle.ys-active::before{transform:rotate(0deg);background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'white\' stroke-width=\'2.5\' stroke-linecap=\'round\'%3E%3Cline x1=\'18\' y1=\'6\' x2=\'6\' y2=\'18\'/%3E%3Cline x1=\'6\' y1=\'6\' x2=\'18\' y2=\'18\'/%3E%3C/svg%3E") center/18px no-repeat;}',
  '#ys-widget-toggle.ys-active::after{animation:none;opacity:0;}',
  '',
  '#ys-widget-badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;line-height:18px;text-align:center;padding:0 5px;border:2px solid #fff;transform:scale(0);transition:transform .2s cubic-bezier(.34,1.56,.64,1);}',
  '#ys-widget-badge.ys-visible{transform:scale(1);}',
  '',
  '#ys-widget-panel{position:absolute;right:0;bottom:72px;width:min(400px,calc(100vw - 24px));height:min(620px,calc(100vh - 100px));border-radius:20px;overflow:hidden;background:#fff;border:1px solid rgba(15,23,42,.08);box-shadow:0 24px 80px rgba(15,23,42,.16),0 8px 24px rgba(15,23,42,.08);display:flex;flex-direction:column;opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .28s ease,transform .28s cubic-bezier(.34,1.2,.64,1);}',
  '#ys-widget-panel.ys-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}',
  '',
  '#ys-widget-header{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:linear-gradient(135deg,#312e81 0%,#4f46e5 50%,#6366f1 100%);color:#fff;}',
  '#ys-widget-header-left{display:flex;align-items:center;gap:12px;min-width:0;flex:1;}',
  '#ys-widget-avatar{width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.2);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;letter-spacing:.02em;flex-shrink:0;}',
  '#ys-widget-title-wrap{display:flex;flex-direction:column;gap:3px;min-width:0;}',
  '#ys-widget-title{font-weight:600;font-size:15px;line-height:1.25;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '#ys-widget-subtitle{font-size:11px;opacity:.85;display:flex;align-items:center;gap:6px;}',
  '#ys-widget-status-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 2px rgba(74,222,128,.35);flex-shrink:0;animation:ys-pulse 2s ease-in-out infinite;}',
  '#ys-widget-header-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;position:relative;}',
  '#ys-widget-menu-btn,#ys-widget-close{background:rgba(255,255,255,.12);color:#fff;border:none;width:34px;height:34px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s ease,transform .15s ease;}',
  '#ys-widget-menu-btn:hover,#ys-widget-close:hover{background:rgba(255,255,255,.22);transform:scale(1.05);}',
  '#ys-widget-close{font-size:17px;line-height:1;}',
  '#ys-widget-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:200px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.14);padding:6px;z-index:2;display:flex;flex-direction:column;gap:2px;}',
  '#ys-widget-menu[hidden]{display:none;}',
  '.ys-menu-item{display:flex;align-items:center;gap:10px;width:100%;border:none;background:transparent;text-align:left;padding:10px 12px;border-radius:8px;font-size:13px;color:#334155;cursor:pointer;font-family:inherit;transition:background .12s ease;}',
  '.ys-menu-item:hover{background:#f1f5f9;}',
  '.ys-menu-item:disabled{opacity:.45;cursor:not-allowed;}',
  '.ys-menu-icon{width:18px;text-align:center;opacity:.7;flex-shrink:0;}',
  '#ys-widget-toast{position:absolute;left:50%;bottom:88px;transform:translateX(-50%) translateY(8px);background:#0f172a;color:#fff;font-size:12px;padding:8px 14px;border-radius:10px;opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;z-index:3;max-width:90%;text-align:center;}',
  '#ys-widget-toast.ys-visible{opacity:1;transform:translateX(-50%) translateY(0);}',
  '',
  '#ys-widget-body{display:flex;flex-direction:column;flex:1;min-height:0;background:linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%);}',
  '#ys-widget-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}',
  '#ys-widget-messages::-webkit-scrollbar{width:5px;}',
  '#ys-widget-messages::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px;}',
  '',
  '.ys-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 20px;min-height:200px;}',
  '.ys-empty-icon{width:56px;height:56px;border-radius:16px;background:#fff;border:1px solid #e2e8f0;color:#6366f1;display:flex;align-items:center;justify-content:center;margin-bottom:14px;box-shadow:0 4px 12px rgba(99,102,241,.08);}',
  '.ys-empty-title{font-size:14px;font-weight:600;color:#334155;margin:0 0 6px;}',
  '.ys-empty-sub{font-size:12px;color:#64748b;margin:0;line-height:1.45;max-width:220px;}',
  '.ys-empty.ys-hidden{display:none;}',
  '',
  '.ys-msg-wrap{display:flex;flex-direction:column;gap:4px;max-width:85%;animation:ys-msg-in .28s cubic-bezier(.34,1.2,.64,1);}',
  '.ys-msg-wrap.ys-right{align-self:flex-end;align-items:flex-end;}',
  '.ys-msg-wrap.ys-left{align-self:flex-start;align-items:flex-start;}',
  '.ys-msg{padding:10px 14px;border-radius:16px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}',
  '.ys-msg-user{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;border-bottom-right-radius:5px;box-shadow:0 2px 8px rgba(79,70,229,.25);}',
  '.ys-msg-assistant{background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:5px;box-shadow:0 1px 3px rgba(15,23,42,.06);}',
  '.ys-msg-time{font-size:10px;color:#94a3b8;padding:0 2px;}',
  '.ys-msg-error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:12px;padding:10px 14px;font-size:12px;align-self:stretch;max-width:100%;}',
  '',
  '.ys-typing{display:flex;align-items:center;gap:5px;padding:12px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;border-bottom-left-radius:5px;align-self:flex-start;box-shadow:0 1px 3px rgba(15,23,42,.05);}',
  '.ys-typing-dot{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:ys-bounce 1.4s ease-in-out infinite;}',
  '.ys-typing-dot:nth-child(2){animation-delay:.16s;}',
  '.ys-typing-dot:nth-child(3){animation-delay:.32s;}',
  '',
  '#ys-widget-form{display:flex;gap:10px;padding:12px 14px 10px;border-top:1px solid #e2e8f0;background:#fff;flex-shrink:0;}',
  '#ys-widget-input{flex:1;min-width:0;height:44px;border:1.5px solid #e2e8f0;border-radius:14px;padding:0 16px;font-size:14px;font-family:inherit;outline:none;background:#f8fafc;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease;color:#0f172a;}',
  '#ys-widget-input::placeholder{color:#94a3b8;}',
  '#ys-widget-input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15);background:#fff;}',
  '#ys-widget-send{width:44px;height:44px;border:none;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .15s ease,box-shadow .15s ease,opacity .15s ease;box-shadow:0 4px 14px rgba(79,70,229,.35);}',
  '#ys-widget-send svg{width:18px;height:18px;}',
  '#ys-widget-send:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 18px rgba(79,70,229,.4);}',
  '#ys-widget-send:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none;}',
  '#ys-widget-powered{flex-shrink:0;text-align:center;padding:6px 0 10px;font-size:10px;color:#94a3b8;background:#fff;}',
  '#ys-widget-powered span{font-weight:600;color:#6366f1;}',
  '',
  '@keyframes ys-ring{0%,100%{transform:scale(1);opacity:.6;}50%{transform:scale(1.2);opacity:0;}}',
  '@keyframes ys-pulse{0%,100%{opacity:1;}50%{opacity:.5;}}',
  '@keyframes ys-msg-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}',
  '@keyframes ys-bounce{0%,60%,100%{transform:translateY(0);}30%{transform:translateY(-5px);}}',
  '@media (max-width:480px){#ys-widget-root{right:12px;bottom:12px;}#ys-widget-panel{bottom:68px;border-radius:16px;}}',
].join('\n');

const GENERATE_UUID_FN =
  'function generateUUID(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){var r=Math.random()*16|0;var v=c==="x"?r:(r&0x3|0x8);return v.toString(16);});}';

const WIDGET_SCRIPT = [
  'var root=document.createElement("div");root.id="ys-widget-root";',
  'root.innerHTML=[\'<style>\',' + JSON.stringify(WIDGET_STYLES) + ',\'</style>\',' + 'WIDGET_HTML_PLACEHOLDER' + '].join("\\n");',
  'document.body.appendChild(root);',
  '',
  'var panel=document.getElementById("ys-widget-panel");',
  'var toggle=document.getElementById("ys-widget-toggle");',
  'var closeBtn=document.getElementById("ys-widget-close");',
  'var menuBtn=document.getElementById("ys-widget-menu-btn");',
  'var menuPanel=document.getElementById("ys-widget-menu");',
  'var toastEl=document.getElementById("ys-widget-toast");',
  'var messagesEl=document.getElementById("ys-widget-messages");',
  'var emptyEl=document.getElementById("ys-widget-empty");',
  'var form=document.getElementById("ys-widget-form");',
  'var input=document.getElementById("ys-widget-input");',
  'var sendBtn=document.getElementById("ys-widget-send");',
  'var badge=document.getElementById("ys-widget-badge");',
  GENERATE_UUID_FN,
  'var isOpen=false;var requestInFlight=false;var unreadCount=0;var menuOpen=false;var toastTimer=null;var visitorId=generateUUID();',
  'try{var stored=localStorage.getItem("ys_visitor_id");if(stored)visitorId=stored;}catch(e){}',
  'try{localStorage.setItem("ys_visitor_id",visitorId);}catch(e){}',
  '',
  'function formatTime(){var d=new Date();var h=d.getHours();var m=d.getMinutes();return(h<10?"0":"")+h+":"+(m<10?"0":"")+m;}',
  'function showToast(msg){if(!toastEl)return;if(toastTimer)clearTimeout(toastTimer);toastEl.textContent=msg;toastEl.classList.add("ys-visible");toastTimer=setTimeout(function(){toastEl.classList.remove("ys-visible");},2400);}',
  'function setMenuOpen(open){menuOpen=open;if(menuPanel){menuPanel.hidden=!open;}if(menuBtn)menuBtn.setAttribute("aria-expanded",String(open));}',
  'function hideEmptyState(){if(emptyEl)emptyEl.classList.add("ys-hidden");}',
  'function showEmptyState(){if(emptyEl)emptyEl.classList.remove("ys-hidden");}',
  'function clearChatUi(){if(window._ysEvt){window._ysEvt.close();window._ysEvt=null;}resetStreamUiState();var nodes=messagesEl.querySelectorAll(".ys-msg-wrap,.ys-msg-error,.ys-typing");for(var i=0;i<nodes.length;i++){nodes[i].remove();}showEmptyState();}',
  'function buildTranscript(){var lines=[];var items=messagesEl.querySelectorAll(".ys-msg-wrap,.ys-msg-error");for(var i=0;i<items.length;i++){var el=items[i];var role=el.classList.contains("ys-right")?"You":AGENT_NAME;var textEl=el.querySelector(".ys-msg")||el;var text=(textEl.textContent||"").trim();if(text)lines.push(role+": "+text);}return lines.join("\\n\\n");}',
  'async function resetConversation(){if(requestInFlight){showToast("Wait for the current reply to finish.");return;}if(!confirm("Start a new conversation? Your current messages will be cleared."))return;setMenuOpen(false);try{if(window._ysEvt){window._ysEvt.close();window._ysEvt=null;}var resp=await fetch(SESSION_RESET_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+WIDGET_TOKEN},body:JSON.stringify({visitorId:visitorId})});if(!resp.ok)throw new Error("HTTP "+resp.status);var data=await resp.json();var payload=data.data||data;SESSION_ID=payload&&payload.sessionId?String(payload.sessionId):"";clearChatUi();showToast("New conversation started");}catch(e){showToast("Could not reset conversation");}}',
  'async function copyTranscript(){var text=buildTranscript();if(!text){showToast("Nothing to copy yet");return;}try{await navigator.clipboard.writeText(text);showToast("Transcript copied");}catch(e){showToast("Copy failed");}setMenuOpen(false);}',
  'function downloadTranscript(){var text=buildTranscript();if(!text){showToast("Nothing to download yet");return;}var blob=new Blob([text],{type:"text/plain;charset=utf-8"});var url=URL.createObjectURL(blob);var a=document.createElement("a");a.href=url;a.download=(AGENT_NAME||"chat").replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"-transcript.txt";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);showToast("Transcript downloaded");setMenuOpen(false);}',
  'function setOpen(nextOpen){isOpen=nextOpen;panel.classList.toggle("ys-open",isOpen);toggle.classList.toggle("ys-active",isOpen);toggle.setAttribute("aria-expanded",String(isOpen));if(isOpen){unreadCount=0;badge.classList.remove("ys-visible");badge.textContent="";input.focus();}}',
  'function scrollToBottom(){messagesEl.scrollTop=messagesEl.scrollHeight;}',
  'function addMessage(role,text,isError){hideEmptyState();var wrap=document.createElement("div");wrap.className="ys-msg-wrap "+(role==="user"?"ys-right":"ys-left");if(isError){var err=document.createElement("div");err.className="ys-msg-error";err.textContent=text;messagesEl.appendChild(err);}else{var msg=document.createElement("div");msg.className="ys-msg "+(role==="user"?"ys-msg-user":"ys-msg-assistant");msg.textContent=text;var time=document.createElement("span");time.className="ys-msg-time";time.textContent=formatTime();wrap.appendChild(msg);wrap.appendChild(time);messagesEl.appendChild(wrap);}scrollToBottom();if(!isOpen&&role==="assistant"&&!isError){unreadCount++;badge.textContent=unreadCount>9?"9+":String(unreadCount);badge.classList.add("ys-visible");}}',
  'var currentAssistantEl=null;var streamComponentText={};var streamHadChunks=false;',
  'function resetStreamUiState(){streamComponentText={};streamHadChunks=false;currentAssistantEl=null;}',
  'function rebuildAssistantBubble(){var merged="";for(var id in streamComponentText){if(streamComponentText.hasOwnProperty(id))merged+=streamComponentText[id];}if(!merged)return;hideEmptyState();if(!currentAssistantEl){addMessage("assistant","");currentAssistantEl=messagesEl.lastElementChild;}var bubble=currentAssistantEl&&currentAssistantEl.querySelector(".ys-msg");if(bubble)bubble.textContent=merged;scrollToBottom();}',
  'function applyStreamChunk(eventData){if(!eventData||!eventData.component)return;var component=eventData.component;if(component.type!=="text"||!component.data||typeof component.data.content!=="string")return;var componentId=component.id||"default";var action=eventData.action||"add";var piece=component.data.content;if(action==="delete"){delete streamComponentText[componentId];rebuildAssistantBubble();return;}if(action==="add"||streamComponentText[componentId]===undefined){streamComponentText[componentId]=piece;}else{streamComponentText[componentId]+=piece;}streamHadChunks=true;rebuildAssistantBubble();}',
  'function showTyping(show){requestInFlight=show;sendBtn.disabled=show;var existing=messagesEl.querySelector(".ys-typing");if(show&&!existing){hideEmptyState();var typing=document.createElement("div");typing.className="ys-typing";typing.setAttribute("aria-label","AI is typing");typing.innerHTML=\'<span class="ys-typing-dot"></span><span class="ys-typing-dot"></span><span class="ys-typing-dot"></span>\';messagesEl.appendChild(typing);scrollToBottom();}if(!show&&existing){existing.remove();}}',
  'async function connectStream(){try{if(window._ysEvt){window._ysEvt.close();window._ysEvt=null;}if(!SESSION_ID)return;var url=STREAM_URL+"?token="+encodeURIComponent(WIDGET_TOKEN)+"&sessionId="+encodeURIComponent(SESSION_ID);var evt=new EventSource(url);evt.addEventListener("stream_start",function(){showTyping(true);resetStreamUiState();});evt.addEventListener("stream_chunk",function(e){var d=JSON.parse(e.data);applyStreamChunk(d);});evt.addEventListener("stream_complete",function(e){showTyping(false);var d=JSON.parse(e.data);var reply=d&&d.reply?String(d.reply).trim():"";if(reply){var bubble=currentAssistantEl&&currentAssistantEl.querySelector(".ys-msg");var shown=bubble&&bubble.textContent?bubble.textContent.trim():"";if(!shown){if(!bubble)addMessage("assistant",reply);else bubble.textContent=reply;scrollToBottom();}}currentAssistantEl=null;streamHadChunks=false;streamComponentText={};});evt.addEventListener("stream_error",function(e){showTyping(false);resetStreamUiState();var d=JSON.parse(e.data);addMessage("assistant",d.message||"An error occurred. Please try again.",true);});evt.onerror=function(){};window._ysEvt=evt;}catch(e){}}',
  'async function sendMessage(text){hideEmptyState();addMessage("user",text);showTyping(true);try{var resp=await fetch(CHAT_API_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+WIDGET_TOKEN},body:JSON.stringify({message:text,visitorId:visitorId})});if(!resp.ok)throw new Error("HTTP "+resp.status);var data=await resp.json();var payload=data.data||data;if(payload&&payload.sessionId){SESSION_ID=String(payload.sessionId);connectStream();}}catch(err){showTyping(false);addMessage("assistant","Sorry, something went wrong. Please try again.",true);}}',
  'toggle.addEventListener("click",function(){setOpen(!isOpen);});',
  'closeBtn.addEventListener("click",function(){setOpen(false);setMenuOpen(false);});',
  'menuBtn.addEventListener("click",function(e){e.stopPropagation();setMenuOpen(!menuOpen);});',
  'menuPanel.addEventListener("click",function(e){var btn=e.target.closest("[data-action]");if(!btn)return;var action=btn.getAttribute("data-action");if(action==="new-chat")resetConversation();else if(action==="copy-chat")copyTranscript();else if(action==="download-chat")downloadTranscript();});',
  'document.addEventListener("click",function(e){if(menuOpen&&!panel.contains(e.target))setMenuOpen(false);});',
  'document.addEventListener("keydown",function(e){if(e.key==="Escape"){if(menuOpen)setMenuOpen(false);else if(isOpen)setOpen(false);}});',
  'form.addEventListener("submit",function(e){e.preventDefault();if(requestInFlight)return;var value=input.value.trim();if(!value)return;input.value="";sendMessage(value);});',
].join('\n');

export function buildWidgetSnippet(
  agentId: string,
  agentName: string,
  token: string,
  chatApiUrl: string,
  streamApiUrl: string,
): string {
  const displayName = agentName.trim() || 'AI Assistant';
  const avatarInitials = buildAvatarInitials(displayName);
  const widgetHtml = buildWidgetHtml(displayName, avatarInitials);
  const scriptWithHtml = WIDGET_SCRIPT.replace(
    'WIDGET_HTML_PLACEHOLDER',
    JSON.stringify(widgetHtml),
  );
  const sessionResetUrl = chatApiUrl.replace(/\/chat\/?$/, '/session/reset');
  const config =
    'var AGENT_ID="' +
    agentId +
    '";var AGENT_NAME=' +
    JSON.stringify(displayName) +
    ';var WIDGET_TOKEN="' +
    token +
    '";var CHAT_API_URL="' +
    chatApiUrl +
    '";var SESSION_RESET_URL="' +
    sessionResetUrl +
    '";var STREAM_URL="' +
    streamApiUrl +
    '";var SESSION_ID="";';
  return ['<script>', '(function(){', config, scriptWithHtml, '})();', '</script>'].join('\n');
}
