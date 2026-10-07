'use strict';
const $ = s => document.querySelector(s);
const MODELS = {
  claude: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'],
  gemini: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite']
};
const NAMES = { claude: 'Claude', gemini: 'Gemini' };
const LABELS = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'gemini-3.8-flash': 'Gemini 3.8 Flash', 'gemini-3.1-pro-preview': 'Gemini 3.1 Pro', 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite'
};
const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICON = {
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  check: svg('<path d="M5 12l5 5 9-9"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>')
};
const SPARK = '<svg viewBox="0 0 24 24"><path d="M12 2c.4 5.6 4.4 9.6 10 10-5.6.4-9.6 4.4-10 10-.4-5.6-4.4-9.6-10-10 5.6-.4 9.6-4.4 10-10z"/></svg>';
function iconBtn(html, title) { const b = el('button', 'iconbtn'); b.innerHTML = html; b.title = title; b.setAttribute('aria-label', title); return b; }

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } }
};
const defaults = {
  provider: 'claude',
  keys: { claude: '', gemini: '' },
  models: { claude: MODELS.claude[0], gemini: MODELS.gemini[0] },
  system: '', temperature: 1, maxTokens: 16384, theme: 'light', thinking: true, preferOwnKey: false, effort: 'low'
};
const saved = store.get('settings', {});
const settings = { ...defaults, ...saved,
  keys: { ...defaults.keys, ...(saved.keys || {}) },
  models: { ...defaults.models, ...(saved.models || {}) } };
// one-time migration: move people still on the old default Gemini model to 3.8 Flash
if (!saved.v || saved.v < 2) {
  if (settings.models.gemini === 'gemini-2.5-flash') settings.models.gemini = MODELS.gemini[0];
  settings.v = 2; store.set('settings', settings);
}
// one-time migration: swap removed Gemini models for their replacements
const MIGRATE = { 'gemini-2.5-pro': 'gemini-3.1-pro-preview', 'gemini-2.5-flash': 'gemini-3.8-flash', 'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite' };
if ((saved.v || 0) < 5) {
  if (settings.maxTokens === 4096) settings.maxTokens = 16384; // old default caused cut-off replies
  if (MIGRATE[settings.models.gemini]) settings.models.gemini = MIGRATE[settings.models.gemini];
  settings.v = 5; store.set('settings', settings);
}
let chats = store.get('chats', []);
let currentId = store.get('currentId', null);
let abort = null;
let lastError = null;
let lastErrAction = null;
let lastErrNeutral = false;
function setError(text, action, neutral) { lastError = text; lastErrAction = action || null; lastErrNeutral = !!neutral; }

const saveSettings = () => store.set('settings', settings);
const saveChats = () => { store.set('chats', chats); store.set('currentId', currentId); };
const current = () => chats.find(c => c.id === currentId);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- helpers ---------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function renderMarkdown(text) {
  if (!window.marked || !window.DOMPurify) return null;
  return DOMPurify.sanitize(marked.parse(text, { breaks: true }));
}
const THINK_PHRASES = ['Reading your message', 'Thinking it through', 'Working out an answer', 'Putting a reply together'];
function lastHeading(t) { // Gemini's thought summaries use **Bold headings**; show the newest one as the live status
  let h = null, x; const re = /\*\*([^*\n]{3,90})\*\*/g;
  while ((x = re.exec(t))) h = x[1].trim();
  return h;
}
function thinkLabel(m, waiting, secs) {
  if (waiting) return (m.thinking && lastHeading(m.thinking)) || THINK_PHRASES[Math.floor(secs / 4) % THINK_PHRASES.length] + '…';
  if (m.provider === 'gemini') return 'Show thinking';
  return m.thinkMs ? `Thought for ${Math.max(1, Math.round(m.thinkMs / 1000))}s` : 'Thought process';
}
function fillBody(body, m, streaming) {
  if (m.role === 'user') { body.textContent = m.content; return; }
  body.innerHTML = '';
  const waiting = streaming && !m.content;
  const secs = m.startedAt ? Math.floor((Date.now() - m.startedAt) / 1000) : 0;
  if (waiting || m.thinking) {
    const expandable = !!m.thinking;
    const d = el(expandable ? 'details' : 'div', 'think' + (expandable ? '' : ' plain'));
    if (expandable) d.open = !!m.thinkOpen;
    const sum = el(expandable ? 'summary' : 'div', 'think-sum');
    sum.append(el('span', waiting ? 'shimmer' : '', thinkLabel(m, waiting, secs)));
    if (waiting && secs >= 2) sum.append(el('span', 'think-time', secs + 's'));
    if (expandable) sum.onclick = () => { m.thinkOpen = !d.open; };
    d.append(sum);
    if (expandable) {
      const tb = el('div', 'think-body'); const th = renderMarkdown(m.thinking);
      if (th == null) { tb.textContent = m.thinking; tb.style.whiteSpace = 'pre-wrap'; } else tb.innerHTML = th;
      d.append(tb);
      if (waiting) requestAnimationFrame(() => { tb.scrollTop = tb.scrollHeight; });
    }
    body.append(d);
    if (waiting && secs >= 20) body.append(el('div', 'think-hint', 'This is taking a while. You can press Stop, turn Thinking off, or lower the thinking effort in Settings.'));
  }
  if (m.content) {
    const ans = el('div', 'answer');
    const html = renderMarkdown(m.content);
    if (html == null) ans.textContent = m.content; else ans.innerHTML = html;
    ans.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (code && window.hljs && !streaming) { try { hljs.highlightElement(code); } catch {} }
      const b = el('button', 'copy', 'Copy');
      b.onclick = () => { navigator.clipboard.writeText(pre.innerText.replace(/Copy$/, '').trim()); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); };
      pre.appendChild(b);
    });
    body.append(ans);
  }
  body.classList.toggle('cursor', !!streaming && !!m.content);
}

/* ---------- rendering ---------- */
function renderSidebar() {
  const nb = $('#newChat'), cur = current();
  nb.disabled = !cur || !cur.messages.length;
  nb.title = nb.disabled ? "You're already in a new chat" : '';
  const list = $('#chatList'); list.innerHTML = '';
  [...chats].sort((a, b) => b.updated - a.updated).forEach(c => {
    const item = el('div', 'chat-item' + (c.id === currentId ? ' active' : ''));
    item.append(el('span', 't', c.title));
    const x = el('button', 'x'); x.innerHTML = ICON.x; x.title = 'Delete chat';
    x.onclick = e => { e.stopPropagation(); deleteChat(c.id); };
    item.append(x);
    item.onclick = () => { if (abort) return; const cur = current(); if (cur && cur.id !== c.id && !cur.messages.length) chats = chats.filter(x => x.id !== cur.id); currentId = c.id; lastError = null; saveChats(); renderAll(); $('#sidebar').classList.remove('open'); };
    list.append(item);
  });
}
function cutText(r) {
  if (/max_tokens/i.test(r)) return 'This reply hit the length limit and was cut off.';
  if (r === 'STREAM_ENDED') return 'The connection closed before the reply finished.';
  return `The model stopped early (${r}).`;
}
function messageEl(m, i, isLast, streaming) {
  const wrap = el('div', 'msg ' + m.role + (m.provider ? ' by-' + m.provider : ''));
  if (m.role === 'assistant') { const av = el('span', 'avatar' + (streaming ? ' busy' : '')); av.innerHTML = SPARK; wrap.append(av); }
  const body = el('div', 'body'); fillBody(body, m, streaming); wrap.append(body);
  if (m.stopped && !streaming) wrap.append(el('div', 'stopped', 'You stopped this response'));
  if (m.role === 'assistant' && !streaming) {
    const a = el('div', 'actions');
    const cp = iconBtn(ICON.copy, 'Copy');
    cp.onclick = () => { navigator.clipboard.writeText(m.content); cp.innerHTML = ICON.check; setTimeout(() => cp.innerHTML = ICON.copy, 1200); };
    a.append(cp);
    if (isLast) { const rg = iconBtn(ICON.refresh, 'Regenerate'); rg.onclick = regenerate; a.append(rg); }
    a.append(el('span', 'meta', (m.model || NAMES[m.provider] || '') + (m.free ? ' · free tokens' : '')));
    wrap.append(a);
    if (m.cut && isLast) {
      const n = el('div', 'trunc'); n.append(el('span', null, cutText(m.cut)));
      const cb = el('button', null, 'Continue');
      cb.onclick = () => { if (abort) return; m.cut = null; current().messages.push({ role: 'user', content: 'Continue' }); saveChats(); renderSidebar(); generate(); };
      n.append(cb); wrap.append(n);
    }
  }
  return wrap;
}
function renderMessages(streamingLast) {
  const box = $('#messages'); box.innerHTML = '';
  const c = current();
  if (!c || !c.messages.length) {
    const e = el('div', 'empty');
    e.append(...(settings.provider === 'gemini'
      ? [el('h1', null, 'Hello'), el('p', null, 'How can I help you today?')]
      : [el('h1', null, 'How can I help you today?'), el('p', null, 'Pick a model in the prompt box, add your API key in Settings, and start typing.')]));
    box.append(e);
  } else {
    c.messages.forEach((m, i) => box.append(messageEl(m, i, i === c.messages.length - 1, streamingLast && i === c.messages.length - 1)));
  }
  if (lastError) {
    const e = el('div', 'err' + (lastErrNeutral ? ' neutral' : '')); e.append(el('span', null, lastError));
    if (lastErrAction) { const act = lastErrAction; const ab = el('button', 'ghost', act.label); ab.onclick = () => act.fn(); e.append(ab); }
    if (c && c.messages.length && c.messages[c.messages.length - 1].role === 'user') {
      const r = el('button', 'ghost', 'Retry'); r.onclick = () => { lastError = null; generate(); }; e.append(r);
    }
    box.append(e);
  }
  box.scrollTop = box.scrollHeight;
}
let raf = 0;
function scheduleStreamRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const c = current(); if (!c) return;
    const box = $('#messages'); const last = box.lastElementChild;
    const m = c.messages[c.messages.length - 1];
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (last && last.classList.contains('assistant')) {
      const body = last.querySelector('.body'); fillBody(body, m, true);
      if (stick) box.scrollTop = box.scrollHeight;
    } else renderMessages(true);
  });
}
const modelLabel = id => LABELS[id] || id;
function renderTopbar() {
  const p = settings.provider;
  document.documentElement.dataset.brand = p;
  const brand = document.querySelector('.brand'); if (brand) brand.textContent = p === 'gemini' ? 'Gemini' : 'Chat';
  $('#modelLabel').textContent = modelLabel(settings.models[p]);
  $('#thinkBtn').classList.toggle('on', !!settings.thinking);
  $('#thinkBtn').setAttribute('aria-pressed', String(!!settings.thinking));
  const model = settings.models[p], r = routeFor(p, model);
  let txt, bad = false;
  if (r.kind === 'free') txt = account.quota ? `${fmtTok(account.quota.remaining)} free tokens left` : 'Using free tokens';
  else if (r.kind === 'own') txt = 'Using your API key';
  else {
    bad = true;
    txt = !freeEligible(p, model) ? 'Add an API key in Settings' : (account.user ? 'Daily tokens used: add a key' : 'Sign in or add a key');
  }
  $('#keyState').textContent = txt;
  $('#keyState').classList.toggle('bad', bad);
}
function closeMenu() { $('#modelMenu').classList.add('hidden'); }
function pickModel(p, id) { settings.provider = p; settings.models[p] = id; saveSettings(); closeMenu(); renderTopbar(); if (!abort) renderMessages(); }
function buildModelMenu() {
  const menu = $('#modelMenu'); menu.innerHTML = '';
  for (const p of ['claude', 'gemini']) {
    menu.append(el('div', 'menu-head', NAMES[p]));
    const ids = [...MODELS[p]]; const cur = settings.models[p];
    if (!ids.includes(cur)) ids.push(cur);
    ids.forEach(id => {
      const b = el('button', 'menu-item'); b.append(el('span', null, modelLabel(id)));
      const right = el('span', 'menu-right'); const tg = modelTag(p, id);
      if (tg) right.append(el('span', 'tag' + (tg.free ? ' free' : ''), tg.text));
      if (settings.provider === p && cur === id) { const t = el('span', 'tick'); t.innerHTML = ICON.check; right.append(t); }
      b.append(right);
      b.onclick = () => pickModel(p, id);
      menu.append(b);
    });
    const inp = el('input', 'menu-input'); inp.placeholder = 'Other model ID, then Enter'; inp.spellcheck = false;
    inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) pickModel(p, inp.value.trim()); };
    menu.append(inp);
  }
}
function renderAll() { renderSidebar(); renderMessages(); renderTopbar(); document.documentElement.dataset.theme = settings.theme; }
function setBusy(b) { $('#send').classList.toggle('hidden', b); $('#stop').classList.toggle('hidden', !b); }

/* ---------- chats ---------- */
function newChat() {
  if (abort) return;
  const cur = current();
  if (!cur || !cur.messages.length) { $('#input').focus(); $('#sidebar').classList.remove('open'); return; } // already in a fresh chat
  createChat();
}
function createChat() {
  if (abort) return;
  const c = { id: uid(), title: 'New chat', messages: [], updated: Date.now() };
  chats.push(c); currentId = c.id; lastError = null; saveChats(); renderAll(); $('#input').focus();
  $('#sidebar').classList.remove('open');
}
function deleteChat(id) {
  if (abort) return;
  chats = chats.filter(c => c.id !== id);
  if (currentId === id) currentId = chats.length ? chats[chats.length - 1].id : null;
  saveChats(); renderAll();
}
function exportChat() {
  const c = current(); if (!c || !c.messages.length) return;
  const md = c.messages.map(m => `### ${m.role === 'user' ? 'You' : NAMES[m.provider] || 'Assistant'}\n\n${m.content}\n`).join('\n');
  const a = el('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = c.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 40) + '.md'; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- sending ---------- */
function send() {
  if (abort) return;
  const text = $('#input').value.trim(); if (!text) return;
  if (!current()) createChat();
  const c = current();
  c.messages.push({ role: 'user', content: text });
  if (c.title === 'New chat') c.title = text.slice(0, 40);
  c.updated = Date.now();
  $('#input').value = ''; autosize(); lastError = null;
  saveChats(); renderSidebar(); generate();
}
function regenerate() {
  const c = current(); if (!c || abort) return;
  if (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
  lastError = null; generate();
}
async function generate() {
  const c = current(); if (!c || abort) return;
  const p = settings.provider, model = settings.models[p];
  if (!model) { setError('Choose a model in the prompt box.'); renderMessages(); return; }
  const route = routeFor(p, model);
  if (route.kind === 'none') { setError(route.message, route.action); renderMessages(); return; }
  let kind = route.kind; // 'free' = your daily tokens via the server, 'own' = their own API key
  const history = c.messages.map(m => ({ role: m.role, content: m.content }));
  const msg = { role: 'assistant', content: '', provider: p, model, startedAt: Date.now() };
  if (kind === 'free') msg.free = true;
  c.messages.push(msg);
  abort = new AbortController(); setBusy(true); renderMessages(true);
  const tick = setInterval(() => { if (!msg.content) scheduleStreamRender(); }, 1000); // keeps the status text and timer moving
  const opts = { model, system: settings.system.trim(), messages: history,
    temperature: settings.temperature, maxTokens: settings.maxTokens,
    signal: abort.signal, thinking: settings.thinking, effort: settings.thinking ? settings.effort : 'low',
    onStop: r => { if (!/^(STOP|end_turn|stop_sequence|FINISH_REASON_UNSPECIFIED)$/.test(String(r))) msg.cut = String(r); },
    onThought: t => { msg.thinking = (msg.thinking || '') + t; scheduleStreamRender(); },
    onChunk: t => { if (!msg.content) msg.thinkMs = Date.now() - msg.startedAt; msg.content += t; scheduleStreamRender(); } };
  const run = k => p === 'claude' ? streamClaude({ ...opts, key: settings.keys.claude })
    : k === 'free' ? streamGeminiFree(opts) : streamGemini({ ...opts, key: settings.keys.gemini });
  try {
    try { await run(kind); }
    catch (e) {
      // free tokens ran out: quietly carry on with the person's own key if they have one
      if (kind === 'free' && e.code === 'quota' && settings.keys.gemini && !msg.content) {
        kind = 'own'; msg.free = false; if (account.quota) account.quota.remaining = 0;
        toast('Free tokens used up. Continuing with your own key.');
        await run('own');
      } else throw e;
    }
  } catch (e) {
    if (e.name === 'AbortError') msg.stopped = true;
    if (e.name !== 'AbortError') {
      if (e.code === 'quota') {
        if (account.quota) account.quota.remaining = 0;
        setError("You've used today's free tokens (they reset at midnight UTC). Add your own Gemini API key to keep going.", { label: 'Add my key', fn: openModal });
      } else if (e.code === 'auth') setError('Your session expired. Please sign in again.', { label: 'Sign in', fn: () => openAuth('signin') });
      else if (e.code === 'upstream_rate' && !settings.keys.gemini) setError(e.message, { label: 'Add my key', fn: openModal });
      else setError(e.message || String(e));
    }
  } finally {
    clearInterval(tick);
    if (!msg.content) { c.messages.pop(); if (msg.stopped) setError('You stopped this response.', null, true); }
    abort = null; setBusy(false); c.updated = Date.now(); saveChats(); renderAll();
    if (account.user) refreshQuota();
  }
}

/* ---------- provider APIs ---------- */
async function errText(res) {
  const t = await res.text();
  try { const j = JSON.parse(t); return (j.error && (j.error.message || j.error)) || t; } catch { return t || `HTTP ${res.status}`; }
}
async function readSSE(res, onData) {
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  const feed = l => { if (l.startsWith('data:')) { const d = l.slice(5).trim(); if (d && d !== '[DONE]') onData(d); } };
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/); buf = lines.pop();
    lines.forEach(feed);
  }
  buf += dec.decode();
  buf.split(/\r?\n/).forEach(feed); // don't drop a final line that had no trailing newline
}
const claudeAdaptive = m => /claude-(opus|sonnet)-(4-[6-9]|[5-9])/.test(m);
async function streamClaude({ key, model, system, messages, temperature, maxTokens, thinking, signal, onChunk, onThought, onStop }) {
  // newer models want adaptive thinking, older ones want a token budget; fall back to the other if rejected
  const modes = !thinking ? [null] : (claudeAdaptive(model) ? ['adaptive', 'enabled'] : ['enabled', 'adaptive']);
  let lastErr;
  for (const mode of modes) {
    const body = { model, max_tokens: maxTokens, stream: true, messages };
    if (system) body.system = system;
    if (mode) {
      body.max_tokens = Math.max(maxTokens, 8192);
      body.thinking = mode === 'adaptive' ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: 4000 };
    } else if (temperature !== 1) body.temperature = temperature;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const msg = await errText(res);
      if (mode && mode === modes[0] && modes.length > 1 && res.status === 400 && /thinking|adaptive|budget/i.test(String(msg))) { lastErr = msg; continue; }
      throw new Error(msg);
    }
    let finished = false;
    await readSSE(res, d => {
      let j; try { j = JSON.parse(d); } catch { return; }
      if (j.type === 'content_block_delta' && j.delta) {
        if (j.delta.type === 'text_delta') onChunk(j.delta.text);
        else if (j.delta.type === 'thinking_delta') onThought(j.delta.thinking || '');
      } else if (j.type === 'message_delta' && j.delta && j.delta.stop_reason) { finished = true; onStop(j.delta.stop_reason); }
      else if (j.type === 'error') throw new Error((j.error && j.error.message) || 'Stream error');
    });
    if (!finished) onStop('STREAM_ENDED');
    return;
  }
  throw new Error(lastErr || 'Request failed');
}
function geminiLevel(model, effort) {
  let l = ['low', 'medium', 'high'].includes(effort) ? effort : null;
  if (l === 'low' && /flash-lite/i.test(model)) l = null; // Flash-Lite is already fast by default
  return l;
}
async function streamGemini({ key, model, system, messages, temperature, thinking, effort, signal, onChunk, onThought, onStop }) {
  // try the richest request first; if the model rejects an option, step down
  const level = geminiLevel(model, effort);
  const attempts = [];
  if (level) attempts.push({ level, thoughts: !!thinking, cap: true });
  attempts.push({ level: null, thoughts: !!thinking, cap: true });
  if (thinking) attempts.push({ level: null, thoughts: false, cap: true });
  attempts.push({ level: null, thoughts: false, cap: false });
  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    const { level: lv, thoughts, cap } = attempts[i];
    const generationConfig = {};
    if (temperature !== 1) generationConfig.temperature = temperature;
    if (cap) generationConfig.maxOutputTokens = 65536; // explicit high cap so replies aren't cut at a default limit
    const tc = {}; if (lv) tc.thinkingLevel = lv; if (thoughts) tc.includeThoughts = true;
    if (Object.keys(tc).length) generationConfig.thinkingConfig = tc;
    const body = {
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const msg = await errText(res);
      if (i < attempts.length - 1 && res.status === 400 && /thinking|thought|level|output.?token/i.test(String(msg))) { lastErr = msg; continue; }
      throw new Error(msg);
    }
    let finished = false;
    await readSSE(res, d => {
      let j; try { j = JSON.parse(d); } catch { return; }
      if (j.error) throw new Error(j.error.message || 'Stream error');
      if (j.promptFeedback && j.promptFeedback.blockReason) { finished = true; onStop('BLOCKED: ' + j.promptFeedback.blockReason); }
      const cand = j.candidates && j.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      if (parts) parts.forEach(p => { if (!p.text) return; if (p.thought) onThought(p.text); else onChunk(p.text); });
      if (cand && cand.finishReason) { finished = true; onStop(cand.finishReason); }
    });
    if (!finished) onStop('STREAM_ENDED');
    return;
  }
  throw new Error(lastErr || 'Request failed');
}
async function streamGeminiFree({ model, system, messages, temperature, thinking, effort, signal, onChunk, onThought, onStop }) {
  const { data } = await sb.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) { const e = new Error('Please sign in again.'); e.code = 'auth'; throw e; }
  const res = await fetch(`${APP.SUPABASE_URL}/functions/v1/${APP.FUNCTION_NAME}`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': APP.SUPABASE_ANON_KEY },
    body: JSON.stringify({ model, system, messages, temperature, thinking, thinkingLevel: effort })
  });
  if (!res.ok) {
    let j = {}; try { j = await res.json(); } catch {}
    const e = new Error(j.error || `Error ${res.status}`); e.code = j.code || ('http_' + res.status); throw e;
  }
  let finished = false;
  await readSSE(res, d => {
    let j; try { j = JSON.parse(d); } catch { return; }
    if (j.error) throw new Error(j.error.message || 'Stream error');
    if (j.promptFeedback && j.promptFeedback.blockReason) { finished = true; onStop('BLOCKED: ' + j.promptFeedback.blockReason); }
    const cand = j.candidates && j.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    if (parts) parts.forEach(p => { if (!p.text) return; if (p.thought) onThought(p.text); else onChunk(p.text); });
    if (cand && cand.finishReason) { finished = true; onStop(cand.finishReason); }
  });
  if (!finished) onStop('STREAM_ENDED');
}

/* ---------- settings modal ---------- */
function openModal() {
  $('#keyClaude').value = settings.keys.claude; $('#keyGemini').value = settings.keys.gemini;
  $('#system').value = settings.system; $('#temp').value = settings.temperature; $('#tempVal').textContent = settings.temperature;
  $('#maxTokens').value = settings.maxTokens; $('#theme').value = settings.theme; $('#effort').value = settings.effort || 'low';
  $('#preferOwn').checked = !!settings.preferOwnKey; $('#preferOwnWrap').classList.toggle('hidden', !accountsEnabled);
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  settings.keys.claude = $('#keyClaude').value.trim(); settings.keys.gemini = $('#keyGemini').value.trim();
  settings.system = $('#system').value; settings.temperature = parseFloat($('#temp').value);
  settings.maxTokens = Math.max(256, parseInt($('#maxTokens').value) || 4096); settings.theme = $('#theme').value; settings.effort = $('#effort').value; settings.preferOwnKey = $('#preferOwn').checked;
  saveSettings(); $('#modal').classList.add('hidden'); renderAll();
}

/* ---------- wiring ---------- */
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; }
$('#send').onclick = send;
$('#stop').onclick = () => abort && abort.abort();
$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$('#newChat').onclick = newChat;
$('#exportChat').onclick = exportChat;
$('#openSettings').onclick = $('#openSettings2').onclick = openModal;
$('#closeSettings').onclick = closeModal;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#temp').oninput = () => $('#tempVal').textContent = $('#temp').value;
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle(innerWidth <= 760 ? 'open' : 'collapsed');
$('#modelBtn').onclick = e => { e.stopPropagation(); const m = $('#modelMenu'); if (m.classList.contains('hidden')) { buildModelMenu(); m.classList.remove('hidden'); } else closeMenu(); };
document.addEventListener('click', e => { if (!e.target.closest('.picker')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
$('#thinkBtn').onclick = () => { settings.thinking = !settings.thinking; saveSettings(); renderTopbar(); };
$('#wipe').onclick = () => {
  if (!confirm('Delete ALL chats and saved API keys from this browser?')) return;
  localStorage.clear(); location.reload();
};
/* ---------- accounts + free daily tokens (optional, needs Supabase) ---------- */
const APP = Object.assign({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', FUNCTION_NAME: 'gemini-chat', FREE_MODELS: [] }, window.APP_CONFIG || {});
APP.SUPABASE_URL = String(APP.SUPABASE_URL || '').trim().replace(/\/+$/, '');
APP.SUPABASE_ANON_KEY = String(APP.SUPABASE_ANON_KEY || '').trim();
const cfgSet = !!(APP.SUPABASE_URL && APP.SUPABASE_ANON_KEY);
const debugOn = /[?&]debug\b/.test(location.search);
const accountsEnabled = !!(cfgSet && window.supabase);
if (!cfgSet) console.info('Accounts are off: fill in SUPABASE_URL and SUPABASE_ANON_KEY in config.js');
else if (!window.supabase) console.error('Accounts are off: the Supabase library did not load (blocked network or ad blocker?)');
const sb = accountsEnabled ? window.supabase.createClient(APP.SUPABASE_URL, APP.SUPABASE_ANON_KEY) : null;
const account = { user: null, quota: null };
let authMode = 'signin';

const fmtTok = n => Number(n).toLocaleString('en-US');
function freeEligible(p, model) { return accountsEnabled && p === 'gemini' && APP.FREE_MODELS.includes(model); }
function modelTag(p, id) {
  if (!accountsEnabled) return null;
  if (p === 'gemini' && APP.FREE_MODELS.includes(id)) return { text: account.user ? 'Free tokens' : 'Free with account', free: true };
  return { text: 'Own key' };
}
// Decide how a message gets sent: free tokens via the server, the person's own key, or not at all.
function routeFor(p, model) {
  const key = settings.keys[p];
  const free = freeEligible(p, model);
  const left = !account.quota || account.quota.remaining > 0;
  if (free && account.user && left && !(settings.preferOwnKey && key)) return { kind: 'free' };
  if (key) return { kind: 'own' };
  const toSettings = { label: 'Open Settings', fn: openModal };
  if (p === 'claude') return { kind: 'none', message: 'Claude models need your own Anthropic API key. Add it in Settings.', action: toSettings };
  if (!free) return { kind: 'none', action: toSettings, message: accountsEnabled
    ? 'This model needs your own Google Gemini API key. Add it in Settings. (Free tokens only work on Gemini 3.8 Flash and 3.5 Flash-Lite.)'
    : 'Add your Google Gemini API key in Settings first.' };
  if (!account.user) return { kind: 'none', message: 'Sign in for free daily tokens on this model, or add your own Gemini API key in Settings.', action: { label: 'Sign in', fn: () => openAuth('signin') } };
  return { kind: 'none', message: "You've used today's free tokens (they reset at midnight UTC). Add your own Gemini API key to keep going.", action: toSettings };
}
function toast(t) {
  let d = $('#toast'); if (!d) { d = el('div'); d.id = 'toast'; document.body.append(d); }
  d.textContent = t; d.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => d.classList.remove('show'), 4000);
}
async function refreshQuota() {
  if (!sb || !account.user) return;
  const { data, error } = await sb.rpc('get_quota');
  if (!error && data) { account.quota = data; renderAccount(); renderTopbar(); }
}
async function setUser(u) {
  account.user = u && u.email_confirmed_at ? u : null; // only email-confirmed accounts count
  account.quota = null;
  if (account.user) { closeAuth(); await refreshQuota(); }
  renderAccount(); renderTopbar();
}
function renderAccount() {
  const box = $('#account'); if (!box) return;
  box.classList.toggle('hidden', !accountsEnabled && !debugOn && !cfgSet); box.innerHTML = '';
  if (debugOn) {
    const tick = v => v ? 'yes' : 'NO';
    box.append(el('div', 'acct-note', `Debug: config.js read: ${tick(window.APP_CONFIG)} · URL set: ${tick(APP.SUPABASE_URL)} · key set: ${tick(APP.SUPABASE_ANON_KEY)} · library loaded: ${tick(window.supabase)} · accounts on: ${tick(accountsEnabled)}`));
  }
  if (!accountsEnabled) {
    if (cfgSet) box.append(el('p', 'acct-note', "Sign-in is set up, but its library couldn't load. Check your connection or ad blocker, then refresh."));
    return;
  }
  if (!account.user) {
    const b = el('button', 'sidebtn'); b.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg> Sign in for free tokens';
    b.onclick = () => openAuth('signin');
    box.append(b, el('p', 'acct-note', 'Free daily tokens on Gemini 3.8 Flash and 3.5 Flash-Lite. Other models use your own key.'));
    return;
  }
  const card = el('div', 'acct-card');
  card.append(el('div', 'acct-email', account.user.email || 'Signed in'));
  const q = account.quota;
  if (q) {
    const pct = q.limit > 0 ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 100;
    const m = el('div', 'meter'); const i = el('i'); i.style.width = pct + '%'; m.append(i);
    card.append(m, el('div', 'acct-note', `${fmtTok(q.remaining)} of ${fmtTok(q.limit)} free tokens left today`), el('div', 'acct-note', 'Resets at midnight UTC'));
  }
  const out = el('button', 'linkbtn', 'Sign out'); out.onclick = () => sb.auth.signOut();
  const row = el('div', 'acct-row'); row.append(out); card.append(row);
  box.append(card);
}

function openAuth(mode) { authMode = mode || 'signin'; paintAuth(); $('#authModal').classList.remove('hidden'); setTimeout(() => $('#authEmail').focus(), 0); }
function closeAuth() { $('#authModal').classList.add('hidden'); }
function authMsg(text, bad) { const m = $('#authMsg'); m.textContent = text || ''; m.classList.toggle('hidden', !text); m.classList.toggle('bad', !!bad); }
function paintAuth() {
  const up = authMode === 'signup';
  $('#tabIn').classList.toggle('on', !up); $('#tabUp').classList.toggle('on', up);
  $('#authSubmit').textContent = up ? 'Create account' : 'Sign in';
  $('#authPass').autocomplete = up ? 'new-password' : 'current-password';
  $('#authNote').textContent = up
    ? 'Make a free account to chat with Gemini 3.8 Flash and Gemini 3.5 Flash-Lite without your own key. We email you a link to confirm your address.'
    : 'Sign in to use your free daily tokens on Gemini 3.8 Flash and Gemini 3.5 Flash-Lite. Claude models and Gemini 3.1 Pro always need your own key.';
  authMsg('');
}
function friendlyAuthError(m) {
  m = String(m || '');
  if (/not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox (and spam) for the link.';
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a few minutes and try again.';
  return m || 'Something went wrong. Please try again.';
}
async function submitAuth() {
  if (!sb) return;
  const email = $('#authEmail').value.trim(), password = $('#authPass').value;
  if (!email || !password) return authMsg('Enter your email and password.', true);
  if (authMode === 'signup' && password.length < 8) return authMsg('Use a password with at least 8 characters.', true);
  $('#authSubmit').disabled = true; authMsg('');
  try {
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      // Supabase hides "already registered" by returning a user with no identities
      if (data && data.user && data.user.identities && data.user.identities.length === 0) throw new Error('That email already has an account. Try signing in.');
      authMsg(`Almost there! We sent a confirmation link to ${email}. Click it, then come back here and sign in.`, false);
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange closes the dialog once the session arrives
    }
  } catch (e) { authMsg(friendlyAuthError(e.message), true); }
  finally { $('#authSubmit').disabled = false; }
}
function initAccount() {
  renderAccount();
  if (!sb) return;
  sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => setUser(session && session.user), 0); });
}
$('#tabIn').onclick = () => { authMode = 'signin'; paintAuth(); };
$('#tabUp').onclick = () => { authMode = 'signup'; paintAuth(); };
$('#authSubmit').onclick = submitAuth;
$('#authCancel').onclick = closeAuth;
$('#authModal').addEventListener('click', e => { if (e.target.id === 'authModal') closeAuth(); });
$('#authPass').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });

renderAll();
initAccount();

