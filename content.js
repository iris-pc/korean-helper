(() => {
  if (window.__krHelperLoaded) return;
  window.__krHelperLoaded = true;

  const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
  const MAX_LEN = 300;
  const cache = new Map();
  let host = null;
  let shadow = null;
  let lastText = '';
  let reqId = 0;
  let iconHost = null; // 选区旁悬浮的插件图标
  let pending = null; // 图标对应的选区内容 { rect, text, context }
  const ICON_SIZE = 30;

  const CSS = `
    :host { all: initial; }
    .card {
      position: absolute; width: 360px; max-height: 70vh; display: flex; flex-direction: column;
      background: #fff; color: #37352f; border: 1px solid #e9e9e7; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(15,15,15,.16), 0 0 0 1px rgba(15,15,15,.04);
      font: 14px/1.6 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Malgun Gothic", sans-serif;
      box-sizing: border-box; text-align: left;
    }
    .hd { display: flex; align-items: flex-start; justify-content: space-between; padding: 10px 12px 6px; gap: 8px; }
    .title { font-size: 20px; font-weight: 700; line-height: 1.35; word-break: break-all; }
    .x { cursor: pointer; border: 0; background: none; font-size: 18px; color: #9b9a97; line-height: 1; padding: 2px 4px; border-radius: 4px; }
    .x:hover { background: #efefed; }
    .bd { padding: 0 12px 8px; overflow-y: auto; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .tag { background: #f1f1ef; color: #5f5e5b; border-radius: 4px; padding: 0 6px; font-size: 12px; }
    .tag.blue { background: #e7f3f8; color: #1f6c8a; }
    .meaning { background: #f7f6f3; border-radius: 6px; padding: 6px 10px; margin: 4px 0; font-weight: 600; }
    .sec { margin-top: 8px; }
    .sec > .lb { font-size: 12px; color: #9b9a97; margin-bottom: 2px; }
    .p { margin: 0; white-space: pre-wrap; }
    .g { border-left: 3px solid #e9e9e7; padding-left: 8px; margin: 6px 0; }
    .g b { color: #c4554d; }
    .ex { color: #787774; font-size: 13px; }
    .bk { display: flex; gap: 10px; padding: 4px 0; border-bottom: 1px solid #f1f1ef; }
    .bk:last-child { border-bottom: 0; }
    .bk-ko { flex: 0 0 88px; font-weight: 700; color: #2383e2; word-break: break-all; line-height: 1.45; }
    .bk-info { flex: 1; display: flex; flex-direction: column; line-height: 1.45; }
    .bk-meta { color: #9b9a97; font-size: 12px; }
    .bk-zh { font-size: 13px; }
    .bk-note { font-size: 12px; color: #c4554d; background: #fbf3f2; border-radius: 4px; padding: 1px 6px; margin-top: 2px; }
    .ft { display: flex; gap: 8px; padding: 8px 12px 10px; border-top: 1px solid #efefed; }
    .btn {
      flex: 1; cursor: pointer; border: 1px solid #e0e0de; background: #fff; color: #37352f;
      border-radius: 6px; padding: 5px 0; font-size: 13px; font-family: inherit;
    }
    .btn:hover:not(:disabled) { background: #f1f1ef; }
    .btn.primary { background: #2383e2; border-color: #2383e2; color: #fff; }
    .btn.primary:hover:not(:disabled) { background: #1b74c9; }
    .btn:disabled { opacity: .55; cursor: default; }
    .loading, .err { padding: 6px 0 12px; color: #787774; }
    .err { color: #c4554d; }
    .err a { color: #2383e2; cursor: pointer; text-decoration: underline; }
    .dot { display:inline-block; width:6px; height:6px; margin-right:4px; border-radius:50%; background:#9b9a97; animation: b 1s infinite ease-in-out; }
    .dot:nth-child(2){ animation-delay:.15s } .dot:nth-child(3){ animation-delay:.3s }
    @keyframes b { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
  `;

  // 选区右上角悬浮的插件图标（样式同样用 Shadow DOM 隔离）
  const ICON_CSS = `
    :host { all: initial; }
    .krh-btn {
      display: block; width: 30px; height: 30px; padding: 3px; box-sizing: border-box;
      cursor: pointer; background: #fff; border: 1px solid #e0e0de; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(15,15,15,.18), 0 0 0 1px rgba(15,15,15,.04);
      transition: background .12s, transform .12s, box-shadow .12s;
      animation: krh-in .12s ease-out;
    }
    .krh-btn:hover { background: #f1f1ef; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(15,15,15,.22); }
    .krh-btn:active { transform: translateY(0); }
    .krh-btn svg { display: block; width: 100%; height: 100%; }
    @keyframes krh-in { from { opacity: 0; transform: scale(.75); } to { opacity: 1; transform: scale(1); } }
  `;

  // 与 icons/icon.svg 同一份矢量图标，内联以免额外声明 web_accessible_resources
  const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
    <rect width="180" height="180" rx="40" fill="#2E9E5B"/>
    <circle cx="78" cy="78" r="62" fill="#14532D" stroke="#FFFFFF" stroke-width="10"/>
    <line x1="124" y1="124" x2="155" y2="155" stroke="#FFFFFF" stroke-width="16" stroke-linecap="round"/>
    <path fill="#BBF7D0" d="M48.05 58.34V66H32.83V88.31H38.11V85.89H48.05V99.66H53.64V85.89H63.63V88.09H69.17V66H53.64V58.34ZM38.11 80.69V71.19H48.05V80.69ZM63.63 80.69H53.64V71.19H63.63Z"/>
    <path fill="#BBF7D0" d="M100.25 69.3C94.39 69.3 90.21 72.51 90.21 77.13C90.21 81.84 94.39 85.01 100.25 85.01C106.1 85.01 110.28 81.84 110.28 77.13C110.28 72.51 106.1 69.3 100.25 69.3ZM100.25 73.74C102.84 73.74 104.65 74.93 104.65 77.13C104.65 79.37 102.84 80.56 100.25 80.56C97.65 80.56 95.85 79.37 95.85 77.13C95.85 74.93 97.65 73.74 100.25 73.74ZM114.46 59V89.45H120.31V76.25H125.72V71.41H120.31V59ZM97.34 58.96V63.27H88.28V67.85H112.21V63.27H103.15V58.96ZM94.04 87.16V99.04H121.76V94.33H99.94V87.16Z"/>
    <line x1="85" y1="54" x2="74" y2="104" stroke="#4ADE80" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`;

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function closePopup() {
    reqId++;
    lastText = '';
    if (host) host.remove();
    host = null;
    shadow = null;
  }

  function closeIcon() {
    if (iconHost) iconHost.remove();
    iconHost = null;
    pending = null;
  }

  // 选中后在选区右上角浮出插件图标，点它才进入 AI 解析
  function showIcon(rect, text, context) {
    closeIcon();
    pending = { rect, text, context };

    iconHost = document.createElement('div');
    iconHost.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;';
    const sh = iconHost.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = ICON_CSS;
    sh.appendChild(st);

    const btn = document.createElement('button');
    btn.className = 'krh-btn';
    btn.type = 'button';
    btn.title = 'AI 解析';
    btn.setAttribute('aria-label', 'AI 解析');
    btn.innerHTML = ICON_SVG;
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // 别让浏览器把选区清掉
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeIcon();
      openPopup(rect, text, context);
    });
    sh.appendChild(btn);

    // 贴在选区右上角；上方/右侧放不下时自动翻转、收边
    const GAP = 6;
    let left = rect.right + GAP;
    let top = rect.top - ICON_SIZE - GAP;
    if (top < 4) top = rect.bottom + GAP;
    if (left + ICON_SIZE > window.innerWidth - 4) left = rect.right - ICON_SIZE - GAP;
    left = Math.max(4, Math.min(left, window.innerWidth - ICON_SIZE - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - ICON_SIZE - 4));
    iconHost.style.left = left + 'px';
    iconHost.style.top = top + 'px';

    document.documentElement.appendChild(iconHost);
  }

  function getContext(sel, text) {
    const node = sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    // PDF 阅读器里文字被切成零碎的 span，需要取整页文字层作为上下文
    const layer = el && el.closest && el.closest('.textLayer');
    const src = layer ? layer.textContent : el && (el.innerText || el.textContent);
    let t = (src || '').replace(/\s+/g, ' ').trim();
    if (t.length > 300) {
      const i = t.indexOf(text);
      const s = i < 0 ? 0 : Math.max(0, i - 120);
      t = t.slice(s, s + 300);
    }
    return t || text;
  }

  function openPopup(rect, text, context) {
    closePopup();
    lastText = text;
    const myId = ++reqId;

    host = document.createElement('div');
    host.style.cssText = 'position:absolute;top:0;left:0;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    shadow.appendChild(st);

    const card = h('div', 'card');
    const left = Math.min(
      Math.max(window.scrollX + 8, rect.left + window.scrollX),
      window.scrollX + document.documentElement.clientWidth - 376
    );
    card.style.left = Math.max(left, 4) + 'px';
    card.style.top = rect.bottom + window.scrollY + 8 + 'px';

    const hd = h('div', 'hd');
    const titleEl = h('div', 'title', text.length > 40 ? text.slice(0, 40) + '…' : text);
    if (text.length > 14) titleEl.style.cssText = 'font-size:14px;font-weight:600;line-height:1.5;';
    hd.appendChild(titleEl);
    const x = h('button', 'x', '×');
    x.onclick = closePopup;
    hd.appendChild(x);

    const bd = h('div', 'bd');

    const ft = h('div', 'ft');
    const bVocab = h('button', 'btn primary', '＋ 加入生词本');
    const bNote = h('button', 'btn', '＋ 加入笔记本');
    bVocab.disabled = bNote.disabled = true;
    ft.append(bVocab, bNote);

    card.append(hd, bd, ft);
    shadow.appendChild(card);
    document.documentElement.appendChild(host);

    const done = (resp) => {
      if (myId !== reqId) return; // 已被关闭或新请求取代
      bd.textContent = '';
      if (!resp || !resp.ok) {
        const err = h('div', 'err');
        if (resp && resp.error === 'NO_KEY') {
          err.append('还没有配置 API Key，');
          const a = h('a', null, '点此去设置');
          a.onclick = () => chrome.runtime.sendMessage({ type: 'openManager' });
          err.appendChild(a);
        } else {
          err.textContent = (resp && resp.error) || '请求失败';
        }
        bd.appendChild(err);
        return;
      }
      cache.set(text + '||' + context, resp.data);
      renderResult(bd, resp.data);
      bindSave(bVocab, bNote, text, context, resp.data);
    };

    // 已经点过悬浮图标，进来就直接解析；期间弹窗可能已被关闭/替换，需校验标识符
    const startAsk = () => {
      if (myId !== reqId) return;
      bd.textContent = '';
      const loading = h('div', 'loading');
      loading.append(h('span', 'dot'), h('span', 'dot'), h('span', 'dot'), document.createTextNode(' AI 解析中'));
      bd.appendChild(loading);
      chrome.runtime.sendMessage({ type: 'ask', text, context }, done);
    };

    // 缓存命中不消耗 API，直接展示；未命中就直接解析
    const cached = cache.get(text + '||' + context);
    if (cached) done({ ok: true, data: cached });
    else startAsk();
  }

  function renderResult(bd, d) {
    const tags = h('div', 'tags');
    if (d.pos) tags.appendChild(h('span', 'tag blue', d.pos));
    if (d.base_form && d.kind !== 'sentence') tags.appendChild(h('span', 'tag', '原形 ' + d.base_form));
    if (d.romanization) tags.appendChild(h('span', 'tag', d.romanization));
    if (tags.children.length) bd.appendChild(tags);

    if (d.meaning) bd.appendChild(h('div', 'meaning', d.meaning));

    const section = (label, text) => {
      if (!text) return;
      const s = h('div', 'sec');
      s.appendChild(h('div', 'lb', label));
      s.appendChild(h('p', 'p', text));
      bd.appendChild(s);
    };
    if (Array.isArray(d.breakdown) && d.breakdown.length) {
      const s = h('div', 'sec');
      s.appendChild(h('div', 'lb', '逐词解析'));
      d.breakdown.forEach((b) => {
        const row = h('div', 'bk');
        row.appendChild(h('span', 'bk-ko', b.ko || ''));
        const info = h('span', 'bk-info');
        const meta = [b.base, b.pos].filter(Boolean).join(' · ');
        if (meta) info.appendChild(h('span', 'bk-meta', meta));
        info.appendChild(h('span', 'bk-zh', b.zh || ''));
        if (b.note) info.appendChild(h('span', 'bk-note', b.note));
        row.appendChild(info);
        s.appendChild(row);
      });
      bd.appendChild(s);
    }
    section(d.kind === 'sentence' ? '补充' : '用法说明', d.detail);
    section('活用拆解', d.conjugation);

    if (Array.isArray(d.grammar) && d.grammar.length) {
      const s = h('div', 'sec');
      s.appendChild(h('div', 'lb', d.kind === 'sentence' ? '整体句型' : '语法点'));
      d.grammar.forEach((g) => {
        const box = h('div', 'g');
        const line = h('p', 'p');
        line.appendChild(h('b', null, g.pattern || ''));
        line.appendChild(document.createTextNode(g.explain ? '  ' + g.explain : ''));
        box.appendChild(line);
        if (g.example) box.appendChild(h('p', 'p ex', g.example));
        s.appendChild(box);
      });
      bd.appendChild(s);
    }
    if (Array.isArray(d.examples) && d.examples.length) {
      const s = h('div', 'sec');
      s.appendChild(h('div', 'lb', '例句'));
      d.examples.forEach((e) => s.appendChild(h('p', 'p ex', `${e.ko || ''} — ${e.zh || ''}`)));
      bd.appendChild(s);
    }
  }

  async function addItem(key, item, dedupe) {
    const store = await chrome.storage.local.get(key);
    const list = store[key] || [];
    const dup = list.find(dedupe);
    if (dup) return false;
    list.unshift(item);
    await chrome.storage.local.set({ [key]: list });
    return true;
  }

  function bindSave(bVocab, bNote, text, context, d) {
    const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    bVocab.disabled = bNote.disabled = false;

    bVocab.onclick = async () => {
      const ko = (d.kind !== 'sentence' && d.base_form) || text;
      const first = (d.examples && d.examples[0]) || null;
      const ok = await addItem(
        'vocab',
        {
          id: id(), ko, zh: d.meaning || '', pos: d.pos || '',
          example: first ? `${first.ko} — ${first.zh}` : '',
          time: Date.now()
        },
        (v) => v.ko === ko
      );
      bVocab.textContent = ok ? '已加入生词本 ✓' : '生词本已存在 ✓';
      bVocab.disabled = true;
    };

    bNote.onclick = async () => {
      const ok = await addItem(
        'notes',
        {
          id: id(), text, ctx: context, kind: d.kind || 'word',
          base_form: d.base_form || '', pos: d.pos || '', meaning: d.meaning || '',
          detail: d.detail || '', conjugation: d.conjugation || '',
          grammar: d.grammar || [], breakdown: d.breakdown || [],
          examples: d.examples || [], time: Date.now()
        },
        (n) => n.text === text && n.ctx === context
      );
      bNote.textContent = ok ? '已加入笔记本 ✓' : '笔记本已存在 ✓';
      bNote.disabled = true;
    };
  }

  /* ---------- 三击：只选中一句话（浏览器默认会选中整段） ---------- */
  const TERM_ALWAYS = /[!?。！？…]/;
  const TERM_TAIL = /[.!?。！？…]/;
  const CLOSERS = /["'”’)\]」』»]/;
  const QUOTATIVE = /^\s*(이?라(고|는|며|면서)|하(고|며|면서)|고\s|며\s)/;

  function caretFromPoint(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  }

  // 找到包含这句话的“块”：PDF 阅读器用整页文字层，普通网页用最近的块级元素
  function findContainer(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    const layer = el && el.closest && el.closest('.textLayer');
    if (layer) return layer;
    while (el && el.parentElement && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
    return el;
  }

  // 把容器内所有文本拼成一个字符串，并记录每个文本节点的起始位置；<br> 视为换行
  function collectText(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let text = '';
    const map = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 1) {
        if (n.tagName === 'BR') text += '\n';
        continue;
      }
      const tag = n.parentElement && n.parentElement.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
      map.push({ node: n, start: text.length, len: n.nodeValue.length });
      text += n.nodeValue;
    }
    return { text, map };
  }

  function isTerminator(t, i) {
    const c = t[i];
    if (TERM_ALWAYS.test(c)) return true;
    if (c === '.') return i + 1 >= t.length || !/[0-9A-Za-z]/.test(t[i + 1]); // 排除 3.5、e.g. 这类
    return false;
  }

  function splitSentences(t) {
    const spans = [];
    let start = 0;
    let i = 0;
    while (i < t.length) {
      if (t[i] === '\n') {
        if (i > start) spans.push([start, i]);
        start = ++i;
        continue;
      }
      if (isTerminator(t, i)) {
        let j = i + 1;
        while (j < t.length && TERM_TAIL.test(t[j])) j++;
        const afterTerm = j;
        while (j < t.length && CLOSERS.test(t[j])) j++;
        // 引用句后面接 라고/라는/하고 等引述词时，句子还没结束（如："좋아요." 라고 말했어요.）
        if (j > afterTerm && QUOTATIVE.test(t.slice(j, j + 8))) {
          i = j;
          continue;
        }
        spans.push([start, j]);
        start = i = j;
        continue;
      }
      i++;
    }
    if (start < t.length) spans.push([start, t.length]);
    // 去掉首尾空白
    return spans
      .map(([a, b]) => {
        while (a < b && /\s/.test(t[a])) a++;
        while (b > a && /\s/.test(t[b - 1])) b--;
        return [a, b];
      })
      .filter(([a, b]) => b > a);
  }

  function locate(map, pos, isEnd) {
    const p = isEnd ? pos - 1 : pos;
    const m = map.find((x) => x.len > 0 && p >= x.start && p < x.start + x.len);
    return m ? { node: m.node, offset: pos - m.start } : null;
  }

  // 返回选中的句子是否成功；只在句子里含韩文时才接管，其他文字保持浏览器默认的三击行为
  function selectSentenceAt(x, y) {
    const caret = caretFromPoint(x, y);
    if (!caret || !caret.node || caret.node.nodeType !== 3) return false;
    const container = findContainer(caret.node);
    if (!container) return false;
    const { text, map } = collectText(container);
    const self = map.find((m) => m.node === caret.node);
    if (!self) return false;
    const idx = Math.min(self.start + Math.min(caret.offset, self.len - 1), text.length - 1);
    const spans = splitSentences(text);
    const span = spans.find(([a, b]) => idx < b) || spans[spans.length - 1];
    if (!span || !HANGUL.test(text.slice(span[0], span[1]))) return false;
    const from = locate(map, span[0], false);
    const to = locate(map, span[1], true);
    if (!from || !to) return false;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  // 第三次按下鼠标时（detail === 3）抢在浏览器之前，把“选中整段”换成“选中一句”
  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.detail !== 3 || e.button !== 0) return;
      if (host && e.composedPath().includes(host)) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      try {
        if (selectSentenceAt(e.clientX, e.clientY)) e.preventDefault();
      } catch (err) {
        /* 失败时回退到浏览器默认行为 */
      }
    },
    true
  );

  // 页面滚动/缩放后选区位置会变，先把图标收起来
  window.addEventListener('scroll', closeIcon, true);
  window.addEventListener('resize', closeIcon);

  // 选中或双击（双击也会产生选区）后触发：只在选区右上角浮出插件图标，不发起请求
  document.addEventListener('mouseup', (e) => {
    const path = e.composedPath();
    if (iconHost && path.includes(iconHost)) return;
    if (host && path.includes(host)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (!text || text.length > MAX_LEN || !HANGUL.test(text)) return;
      if (text === lastText && host) return;
      if (pending && text === pending.text) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      showIcon(rect, text, getContext(sel, text));
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    const path = e.composedPath();
    if (iconHost && !path.includes(iconHost)) closeIcon();
    if (host && !path.includes(host)) closePopup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeIcon();
      closePopup();
    }
  });
})();
