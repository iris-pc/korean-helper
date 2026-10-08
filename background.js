const PROVIDERS = {
  deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
};

const SYSTEM_PROMPT = `你是专业的韩语老师，学生是中文母语者。用户会给出阅读中选中的韩文片段，以及它所在的上下文。
请结合上下文解析，只输出一个 JSON 对象（json），不要输出任何其他内容。字段如下：
{
  "kind": "word 或 sentence（单词/词组为 word，完整句子或较长片段为 sentence）",
  "base_form": "词典形（如 먹었어요 -> 먹다；本身就是原形则原样返回；sentence 留空字符串）",
  "pos": "词性，如 动词/名词/形容词/副词/助词/惯用语（sentence 留空字符串）",
  "romanization": "罗马音或发音提示（sentence 留空字符串）",
  "meaning": "word：简明中文释义，适合记入生词本，20字以内；sentence：整句中文翻译",
  "detail": "补充说明",
  "conjugation": "活用拆解",
  "grammar": [ { "pattern": "语法形式，如 -(으)ㄹ 수 있다", "explain": "中文讲解与接续规则", "example": "韩文例句 — 中文翻译" } ],
  "breakdown": [ { "ko": "句中的词或成分，如 학교에서", "base": "原形/词干，如 학교 + 에서；无变化则留空", "pos": "词性或语法作用，如 名词+助词", "zh": "该部分的中文意思，简短", "note": "若该成分含语法点或活用，在这里一并讲清（形式、接续、含义），没有则空字符串" } ],
  "examples": [ { "ko": "韩文例句", "zh": "中文翻译" } ]
}

【kind = word 时】
- detail：结合上下文的含义、用法、近义词辨析，简洁。
- conjugation：若有活用/助词结合，拆解说明，如 먹었어요 = 먹다 + 았/었 + 어요；没有则空字符串。
- grammar：仅在确实含有语法点时填写，否则空数组。
- breakdown：空数组。
- examples：1-2 条。

【kind = sentence 时】（版面要紧凑，信息只讲一次，不要重复）
- breakdown：按句子原有顺序，把整句话从头到尾每一部分都解析到，不得遗漏（名词、动词、形容词、副词、助词、连接词尾、终结词尾都要有；“名词+助词”可合并成一项）。所有语法点、活用、词尾含义都写进对应条目的 note 里，例如 note 写“-(으)ㄹ 거예요：表示将来计划，接动词词干后”。
- grammar：只放跨越多个成分、无法归入单个 breakdown 条目的句型（如 A-(으)면 B-(으)ㄹ 거예요 这种整体结构），且不得重复 note 里已讲过的内容；通常为空数组，最多 2 条。
- detail：只写语气、语感或需要注意的点，不超过 30 字；没有就返回空字符串。不要复述翻译或 breakdown 的内容。
- conjugation：必须是空字符串（已在 note 里说明）。
- examples：空数组。`;

const viewerUrl = (src) => chrome.runtime.getURL('viewer.html') + '?src=' + encodeURIComponent(src);

// 点击图标：当前页是 PDF 就用本插件的阅读器打开，否则打开生词本/笔记本管理页
chrome.action.onClicked.addListener((tab) => {
  const url = tab && tab.url;
  if (url && /^(https?|file):/i.test(url) && /\.pdf($|[?#])/i.test(url)) {
    chrome.tabs.update(tab.id, { url: viewerUrl(url) });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  }
});

// 自动接管：在设置里开启后，浏览器打开的 PDF（按响应类型判断，不依赖 .pdf 后缀）会跳转到本插件的阅读器
chrome.webRequest.onHeadersReceived.addListener(
  async (d) => {
    try {
      if (d.type !== 'main_frame' || d.tabId < 0 || (d.statusCode && d.statusCode >= 400)) return;
      const headers = d.responseHeaders || [];
      const get = (n) => (headers.find((x) => x.name.toLowerCase() === n) || {}).value || '';
      if (!/^application\/pdf/i.test(get('content-type').trim())) return;
      if (/^\s*attachment/i.test(get('content-disposition'))) return; // 明确要求下载的不拦截
      const { settings = {} } = await chrome.storage.local.get('settings');
      if (!settings.autoPdf) return;
      chrome.tabs.update(d.tabId, { url: viewerUrl(d.url) });
    } catch (e) {
      console.warn('PDF 接管失败', e);
    }
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  ['responseHeaders']
);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'ask') {
    ask(msg.text, msg.context)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true; // 异步响应
  }
  if (msg.type === 'openManager') {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html#settings') });
  }
});

async function ask(text, context) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const provider = settings.provider || 'deepseek';
  if (!settings.apiKey) throw new Error('NO_KEY');

  let url;
  if (provider === 'custom' || settings.baseUrl) {
    const base = (settings.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('请在设置中填写自定义 Base URL');
    url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
  } else {
    url = PROVIDERS[provider].url;
  }
  const model = settings.model || (PROVIDERS[provider] || PROVIDERS.openai).model;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + settings.apiKey
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `选中的韩文：${text}\n所在上下文：${context || text}` }
        ]
      })
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '请求超时' : '网络错误：' + e.message);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API 返回 ${res.status}：${body.slice(0, 200)}`);
  }
  const json = await res.json();
  let content = json.choices?.[0]?.message?.content || '';
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('AI 返回内容无法解析：' + content.slice(0, 120));
  }
}
