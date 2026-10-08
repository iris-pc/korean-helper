const $ = (s) => document.querySelector(s);

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function getAll() {
  const r = await chrome.storage.local.get(['vocab', 'notes', 'settings']);
  return { vocab: r.vocab || [], notes: r.notes || [], settings: r.settings || {} };
}

/* ---------- 标签页 ---------- */
function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

/* ---------- 生词本 ---------- */
async function renderVocab() {
  const { vocab } = await getAll();
  $('#cVocab').textContent = vocab.length ? `(${vocab.length})` : '';
  const body = $('#vocabBody');
  body.textContent = '';
  vocab.forEach((v) => {
    const tr = h('tr');
    tr.append(h('td', 'ko', v.ko), h('td', null, v.zh), h('td', null, v.pos), h('td', 'ex', v.example));
    const td = h('td');
    const del = h('button', 'del', '✕');
    del.title = '删除';
    del.onclick = async () => {
      const all = await getAll();
      await chrome.storage.local.set({ vocab: all.vocab.filter((x) => x.id !== v.id) });
      renderVocab();
    };
    td.appendChild(del);
    tr.appendChild(td);
    body.appendChild(tr);
  });
  $('#vocabEmpty').style.display = vocab.length ? 'none' : 'block';
  $('.tbl').style.display = vocab.length ? 'table' : 'none';
}

$('#exportVocab').onclick = async () => {
  const { vocab } = await getAll();
  if (!vocab.length) return alert('生词本是空的');
  const cols = $('#vocabCols').value;
  chrome.tabs.create({ url: chrome.runtime.getURL(`export.html?type=vocab&cols=${cols}`) });
};
$('#clearVocab').onclick = async () => {
  if (confirm('确定清空生词本？此操作不可恢复。')) {
    await chrome.storage.local.set({ vocab: [] });
    renderVocab();
  }
};

/* ---------- 笔记本 ---------- */
async function renderNotes() {
  const { notes } = await getAll();
  $('#cNotes').textContent = notes.length ? `(${notes.length})` : '';
  const list = $('#notesList');
  list.textContent = '';
  notes.forEach((n) => {
    const box = h('div', 'note');
    const top = h('div', 'top');
    top.appendChild(h('div', 't', n.text));
    const del = h('button', 'del', '✕');
    del.onclick = async () => {
      const all = await getAll();
      await chrome.storage.local.set({ notes: all.notes.filter((x) => x.id !== n.id) });
      renderNotes();
    };
    top.appendChild(del);
    box.appendChild(top);
    if (n.meaning) box.appendChild(h('div', 'm', n.meaning));
    (n.breakdown || []).forEach((b) => {
      const row = h('div', 's');
      row.appendChild(h('b', null, (b.ko || '') + '  '));
      const meta = [b.base, b.pos].filter(Boolean).join(' · ');
      row.appendChild(document.createTextNode((meta ? meta + '　' : '') + (b.zh || '')));
      if (b.note) {
        const nt = h('div', 's', b.note);
        nt.style.color = '#c4554d';
        row.appendChild(nt);
      }
      box.appendChild(row);
    });
    if (n.detail) box.appendChild(h('div', null, n.detail));
    if (n.conjugation) box.appendChild(h('div', 's', '活用：' + n.conjugation));
    (n.grammar || []).forEach((g) => {
      const gd = h('div', 'g');
      const p = h('div');
      p.appendChild(h('b', null, g.pattern || ''));
      p.appendChild(document.createTextNode(g.explain ? '  ' + g.explain : ''));
      gd.appendChild(p);
      if (g.example) gd.appendChild(h('div', 's', g.example));
      box.appendChild(gd);
    });
    list.appendChild(box);
  });
  $('#notesEmpty').style.display = notes.length ? 'none' : 'block';
}
$('#exportNotes').onclick = async () => {
  const { notes } = await getAll();
  if (!notes.length) return alert('笔记本是空的');
  chrome.tabs.create({ url: chrome.runtime.getURL('export.html?type=notes') });
};
$('#clearNotes').onclick = async () => {
  if (confirm('确定清空笔记本？此操作不可恢复。')) {
    await chrome.storage.local.set({ notes: [] });
    renderNotes();
  }
};

/* ---------- 设置 ---------- */
function setMsg(text, cls) {
  const m = $('#msg');
  m.textContent = text;
  m.className = 'msg ' + (cls || '');
}

async function loadSettings() {
  const { settings: s } = await getAll();
  $('#provider').value = s.provider || 'deepseek';
  $('#apiKey').value = s.apiKey || '';
  $('#model').value = s.model || '';
  $('#baseUrl').value = s.baseUrl || '';
  $('#autoPdf').checked = !!s.autoPdf;
}

async function saveSettings() {
  const settings = {
    provider: $('#provider').value,
    apiKey: $('#apiKey').value.trim(),
    model: $('#model').value.trim(),
    baseUrl: $('#baseUrl').value.trim(),
    autoPdf: $('#autoPdf').checked
  };
  // 需要额外网站权限的功能：自定义接口地址、自动接管 PDF（必须在点击事件内尽早申请）
  const origins = [];
  if (settings.baseUrl) {
    try {
      origins.push(new URL(settings.baseUrl).origin + '/*');
    } catch {
      setMsg('Base URL 格式不正确', 'bad');
      return false;
    }
  }
  if (settings.autoPdf) origins.push('http://*/*', 'https://*/*');
  if (origins.length) {
    const granted = await chrome.permissions.request({ origins });
    if (!granted) {
      setMsg('未授予所需权限，相关功能无法使用', 'bad');
      if (settings.autoPdf) $('#autoPdf').checked = false;
      return false;
    }
  }
  await chrome.storage.local.set({ settings });
  setMsg('已保存 ✓', 'ok');
  return true;
}

$('#save').onclick = saveSettings;
$('#test').onclick = async () => {
  if (!(await saveSettings())) return;
  setMsg('测试中…');
  chrome.runtime.sendMessage({ type: 'ask', text: '안녕하세요', context: '안녕하세요' }, (resp) => {
    if (resp && resp.ok) setMsg('连接成功 ✓ ' + (resp.data.meaning || ''), 'ok');
    else setMsg('失败：' + ((resp && resp.error) || '未知错误'), 'bad');
  });
};

/* ---------- 初始化 ---------- */
renderVocab();
renderNotes();
loadSettings();
const hash = location.hash.replace('#', '');
if (['vocab', 'notes', 'settings'].includes(hash)) switchTab(hash);
chrome.storage.onChanged.addListener(() => { renderVocab(); renderNotes(); });
