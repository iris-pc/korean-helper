function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const params = new URLSearchParams(location.search);
const type = params.get('type') || 'vocab';
const cols = params.get('cols') === '4' ? 4 : 2;
const doc = document.getElementById('doc');

function fmtDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function header(title, count) {
  doc.appendChild(h('h1', null, title));
  doc.appendChild(h('div', 'meta', `共 ${count} 条 · 导出于 ${fmtDate(Date.now())}`));
}

function renderVocab(list) {
  document.title = '生词本';
  header('📖 生词本', list.length);
  const table = h('table');
  const thead = h('thead');
  const hr = h('tr');
  const heads = cols === 2 ? ['韩文', '中文'] : ['韩文', '', '中文', ''];
  heads.forEach((t) => hr.appendChild(h('th', null, t)));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = h('tbody');
  list.forEach((v) => {
    const tr = h('tr');
    if (cols === 2) {
      tr.append(h('td', 'ko', v.ko), h('td', null, v.zh));
    } else {
      // 4 列：韩文 | 空白 | 中文 | 空白
      tr.append(h('td', 'ko', v.ko), h('td'), h('td', null, v.zh), h('td'));
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  doc.appendChild(table);
}

function renderNotes(list) {
  document.title = '语法笔记本';
  header('📝 语法笔记本', list.length);
  list.forEach((n) => {
    const e = h('div', 'entry');
    e.appendChild(h('h2', null, n.text));

    const tags = h('div', 'tags');
    tags.appendChild(h('span', 'tag blue', n.kind === 'sentence' ? '句子' : '词汇'));
    if (n.pos) tags.appendChild(h('span', 'tag', n.pos));
    if (n.base_form && n.kind !== 'sentence') tags.appendChild(h('span', 'tag', '原形 ' + n.base_form));
    tags.appendChild(h('span', 'tag', fmtDate(n.time)));
    e.appendChild(tags);

    if (n.meaning) e.appendChild(h('div', 'callout', n.meaning));
    if (n.breakdown && n.breakdown.length) {
      e.appendChild(h('div', 'label', '逐词解析'));
      const t = h('table', 'bk');
      n.breakdown.forEach((b) => {
        const tr = h('tr');
        tr.appendChild(h('td', 'bk-ko', b.ko || ''));
        const meta = [b.base, b.pos].filter(Boolean).join(' · ');
        const td = h('td');
        if (meta) td.appendChild(h('div', 'sub', meta));
        td.appendChild(h('div', null, b.zh || ''));
        if (b.note) td.appendChild(h('div', 'bk-note', b.note));
        tr.appendChild(td);
        t.appendChild(tr);
      });
      e.appendChild(t);
    }
    if (n.detail) e.appendChild(h('p', null, n.detail));
    if (n.conjugation) {
      e.appendChild(h('div', 'label', '活用拆解'));
      e.appendChild(h('p', null, n.conjugation));
    }
    if (n.grammar && n.grammar.length) {
      e.appendChild(h('div', 'label', n.kind === 'sentence' ? '整体句型' : '语法点'));
      const ul = h('ul');
      n.grammar.forEach((g) => {
        const li = h('li');
        li.appendChild(h('b', null, g.pattern || ''));
        li.appendChild(document.createTextNode(g.explain ? '  ' + g.explain : ''));
        if (g.example) li.appendChild(h('div', 'sub', g.example));
        ul.appendChild(li);
      });
      e.appendChild(ul);
    }
    if (n.examples && n.examples.length) {
      e.appendChild(h('div', 'label', '例句'));
      const ul = h('ul');
      n.examples.forEach((x) => ul.appendChild(h('li', 'sub', `${x.ko || ''} — ${x.zh || ''}`)));
      e.appendChild(ul);
    }
    if (n.ctx && n.ctx !== n.text) {
      e.appendChild(h('div', 'label', '原文语境'));
      e.appendChild(h('div', 'ctx', n.ctx));
    }
    doc.appendChild(e);
  });
}

(async () => {
  const r = await chrome.storage.local.get(['vocab', 'notes']);
  if (type === 'notes') renderNotes((r.notes || []).slice().reverse());
  else renderVocab((r.vocab || []).slice().reverse()); // 按加入时间从早到晚
  document.getElementById('print').onclick = () => window.print();
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  setTimeout(() => window.print(), 500);
})();
