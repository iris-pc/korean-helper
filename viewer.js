import * as pdfjsLib from './lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

const $ = (s) => document.querySelector(s);
const abs = (p) => chrome.runtime.getURL(p);
const DOC_OPTS = {
  cMapUrl: abs('lib/cmaps/'),
  cMapPacked: true,
  standardFontDataUrl: abs('lib/standard_fonts/'),
  wasmUrl: abs('lib/wasm/'),
  iccUrl: abs('lib/iccs/')
};

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let pdf = null;
let scale = 1.2;
let fit = true;
let buildToken = 0;
let observer = null;
const pagesEl = $('#pages');

/* ---------- 状态提示 ---------- */
function setStatus(msg, isErr, extra) {
  const el = $('#status');
  el.className = isErr ? 'err' : '';
  el.style.display = msg ? 'block' : 'none';
  el.textContent = msg || '';
  if (extra) el.appendChild(document.createElement('br')), el.appendChild(extra);
}

/* ---------- 加载 ---------- */
function titleFromUrl(src) {
  try {
    const seg = new URL(src).pathname.split('/').filter(Boolean).pop() || 'PDF';
    return decodeURIComponent(seg);
  } catch {
    return 'PDF';
  }
}

async function loadFromUrl(src) {
  $('#drop').style.display = 'none';
  setStatus('正在下载 PDF…');
  document.title = titleFromUrl(src) + ' · 韩语阅读助手';
  $('#title').textContent = titleFromUrl(src);
  let buf;
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    buf = await res.arrayBuffer();
  } catch (e) {
    let btn = null;
    let msg = '无法下载该 PDF：' + e.message;
    if (/^https?:/i.test(src)) {
      msg += '。可能是网站的跨域限制导致，授权后即可重试。';
      btn = h('button', null, '授权访问该网站并重试');
      btn.onclick = async () => {
        const ok = await chrome.permissions.request({ origins: [new URL(src).origin + '/*'] });
        if (ok) loadFromUrl(src);
      };
    } else if (/^file:/i.test(src)) {
      msg += '。请在 chrome://extensions 中打开本扩展详情，开启“允许访问文件网址”，或直接把文件拖进来。';
    }
    setStatus(msg, true, btn);
    return;
  }
  await openData(buf, titleFromUrl(src));
}

async function openData(buf, name) {
  $('#drop').style.display = 'none';
  setStatus('正在解析…');
  $('#title').textContent = name;
  document.title = name + ' · 韩语阅读助手';
  try {
    if (pdf) pdf.destroy();
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buf), ...DOC_OPTS });
    task.onPassword = (update, reason) => {
      const pw = prompt(reason === 2 ? '密码错误，请重新输入：' : '此 PDF 需要密码：');
      if (pw) update(pw);
      else setStatus('已取消，未输入密码', true);
    };
    pdf = await task.promise;
  } catch (e) {
    setStatus('PDF 解析失败：' + (e.message || e), true);
    return;
  }
  setStatus('');
  fit = true;
  await build();
}

/* ---------- 排版与渲染 ---------- */
function currentPageIndex() {
  const y = window.scrollY + window.innerHeight / 3;
  const kids = pagesEl.children;
  let idx = 0;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].offsetTop <= y) idx = i;
    else break;
  }
  return idx;
}

function updateLabels() {
  $('#zoomLabel').textContent = Math.round(scale * 100) + '%';
  if (pdf) $('#pageInfo').textContent = `${currentPageIndex() + 1} / ${pdf.numPages}`;
}

async function build() {
  if (!pdf) return;
  const token = ++buildToken;
  const keep = pagesEl.children.length ? currentPageIndex() : 0;
  if (observer) observer.disconnect();
  pagesEl.textContent = '';

  const first = await pdf.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  if (fit) scale = Math.min(document.documentElement.clientWidth - 32, 1100) / vp1.width;
  if (token !== buildToken) return;

  observer = new IntersectionObserver(
    (entries) => entries.forEach((en) => en.isIntersecting && renderPage(en.target, token)),
    { rootMargin: '800px 0px' }
  );
  for (let i = 1; i <= pdf.numPages; i++) {
    const div = h('div', 'page');
    div.dataset.n = i;
    div.style.width = vp1.width * scale + 'px';
    div.style.height = vp1.height * scale + 'px';
    pagesEl.appendChild(div);
    observer.observe(div);
  }
  if (keep > 0) window.scrollTo(0, pagesEl.children[keep].offsetTop - 56);
  updateLabels();
}

async function renderPage(div, token) {
  if (div.dataset.done || token !== buildToken) return;
  div.dataset.done = '1';
  try {
    const page = await pdf.getPage(+div.dataset.n);
    if (token !== buildToken) return;
    const vp = page.getViewport({ scale });
    div.style.width = vp.width + 'px';
    div.style.height = vp.height + 'px';
    div.style.setProperty('--total-scale-factor', scale);

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + 'px';
    canvas.style.height = vp.height + 'px';
    div.appendChild(canvas);
    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
    }).promise;

    // 文字层：让文字可以被选中（取词依赖它）
    const tl = h('div', 'textLayer');
    div.appendChild(tl);
    const layer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: tl,
      viewport: vp
    });
    await layer.render();
    tl.appendChild(h('div', 'endOfContent'));
  } catch (e) {
    console.error('渲染第', div.dataset.n, '页失败', e);
  }
}

/* ---------- 工具栏 ---------- */
function zoom(factor) {
  fit = false;
  scale = Math.min(4, Math.max(0.4, scale * factor));
  build();
}
$('#zoomIn').onclick = () => zoom(1.15);
$('#zoomOut').onclick = () => zoom(1 / 1.15);
$('#fit').onclick = () => { fit = true; build(); };

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { updateLabels(); ticking = false; });
});

let lastW = document.documentElement.clientWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = document.documentElement.clientWidth;
    if (fit && pdf && w !== lastW) build();
    lastW = w;
  }, 250);
});

// 选择文字时避免选区跳到页尾（沿用 PDF.js 的做法）
document.addEventListener('mousedown', (e) => {
  const tl = e.target.closest && e.target.closest('.textLayer');
  if (tl) tl.classList.add('selecting');
});
document.addEventListener('mouseup', () => {
  document.querySelectorAll('.textLayer.selecting').forEach((t) => t.classList.remove('selecting'));
});

/* ---------- 本地文件 / 拖放 ---------- */
async function openFile(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return setStatus('请选择 PDF 文件', true);
  openData(await file.arrayBuffer(), file.name);
}
$('#openLocal').onclick = () => $('#file').click();
$('#file').onchange = (e) => openFile(e.target.files[0]);
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  openFile(e.dataTransfer.files[0]);
});

/* ---------- 启动 ---------- */
const src = new URLSearchParams(location.search).get('src');
if (src) loadFromUrl(src);
else $('#drop').style.display = 'block';
