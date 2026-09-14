// Module: llm.js
// v0.2 BYOK（Bring Your Own Key）—— 开源版的 AI 层只有一件事：
// 用一个 OpenAI 兼容客户端，为你的这一生写一句墓志铭。
// 设计约束（作品集铁律）：
//   1. Key 只存本机（tt.storage → 浏览器 localStorage），代码里不存在任何中间服务器；
//   2. 无 Key / 失败 / 超时 → 返回 {ok:false}，由调用方降级到本地模板引擎（离线模式即默认体验）；
//   3. 除 fetch 与 DOM 外零依赖，Node（冒烟测试）环境可安全 import。

import { getTT } from './utils.js';
import { t, toggleLang, getLang } from './i18n.js';

const LLM_CONFIG_KEY = 'tb_llm_config';
const LLM_USAGE_KEY = 'tb_llm_usage';
const REQUEST_TIMEOUT_MS = 25000;
const MAX_COMMENT_CHARS = 50; // N7 定稿：仅保留墓志铭一段，≤50 字
const EPITAPH_MAX_CHARS = 50;
// token 预算：跨局累计制（烧的是玩家自己的钱）。
// tokenBudget 存于配置对象；0 / 缺失 / null = 不限额。
export const BUDGET_PRESETS = [50000, 200000, 1000000];
export const BUDGET_UNLIMITED = 0;

function readUsage() {
  const ttApi = getTT();
  if (!ttApi || !ttApi.getStorageSync) {
    return { used: 0 };
  }
  try {
    const raw = ttApi.getStorageSync(LLM_USAGE_KEY);
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    return { used: Number(parsed.used) || 0 };
  } catch (error) {
    return { used: 0 };
  }
}

function writeUsage(used) {
  const ttApi = getTT();
  if (!ttApi || !ttApi.setStorageSync) {
    return false;
  }
  try {
    ttApi.setStorageSync(LLM_USAGE_KEY, JSON.stringify({ used: Math.max(0, Math.round(used)) }));
    return true;
  } catch (error) {
    return false;
  }
}

// 端点没回 usage 时的兜底估算：≈3 字符/token（中英混排的保守值）。UI 侧要标"≈"。
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 3);
}

export function getUsage() {
  const config = getLLMConfig();
  const budget = config ? (Number(config.tokenBudget) || 0) : 0;
  const used = readUsage().used;
  return {
    used: used,
    budget: budget,
    unlimited: budget <= 0,
    remaining: budget > 0 ? Math.max(0, budget - used) : Infinity
  };
}

// 每次 LLM 调用前经过去电闸：超额 → { allowed:false, reason:'over-budget' }。
// 调用方（epitaph / dialogue）收到该信号后走各自的离线降级路径。
export function tryConsumeBudget(estimatedTokens) {
  const config = getLLMConfig();
  if (!config) {
    return { allowed: false, reason: 'no-config' };
  }
  const budget = Number(config.tokenBudget) || 0;
  const usage = readUsage();
  if (budget > 0 && usage.used + Math.max(1, estimatedTokens) > budget) {
    return { allowed: false, reason: 'over-budget', used: usage.used, budget: budget };
  }
  const next = usage.used + Math.max(1, estimatedTokens);
  writeUsage(next);
  return { allowed: true, used: next, budget: budget };
}

// 拿到真实 usage 后回填差额（估算与真实的差值，可为负）。
export function reconcileUsage(estimatedTokens, actualTokens) {
  const est = Math.max(1, Number(estimatedTokens) || 0);
  const act = Math.max(0, Number(actualTokens) || 0);
  if (act === 0) {
    return readUsage();
  }
  const usage = readUsage();
  const next = Math.max(0, usage.used - est + act);
  writeUsage(next);
  return { used: next };
}

// 明确不会产生计费的失败（未送达 / 401 / 403）退回预估扣费，不白扣玩家额度。
export function refundBudget(estimatedTokens) {
  const usage = readUsage();
  return writeUsage(usage.used - Math.max(1, Number(estimatedTokens) || 0));
}

// 玩家在额度耗尽弹窗选"继续使用"：budget = used + addAmount（追加式，不回到"不限"除非显式选择）。
export function extendBudget(addAmount) {
  const config = getLLMConfig();
  if (!config || !addAmount) {
    return false;
  }
  const usage = readUsage();
  config.tokenBudget = usage.used + Math.max(1, Number(addAmount) || 0);
  return setLLMConfig(config);
}

export const LLM_PRESETS = [
  { id: 'deepseek', nameKey: 'byok.preset.deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', cors: true },
  { id: 'openai', nameKey: 'byok.preset.openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', cors: false },
  { id: 'ollama', nameKey: 'byok.preset.ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', cors: true },
  { id: 'custom', nameKey: 'byok.preset.custom', baseUrl: '', model: '', cors: true }
];

export function getLLMConfig() {
  const ttApi = getTT();
  if (!ttApi || !ttApi.getStorageSync) {
    return null;
  }
  try {
    const raw = ttApi.getStorageSync(LLM_CONFIG_KEY);
    if (!raw) {
      return null;
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && parsed.apiKey && parsed.baseUrl && parsed.model) {
      return parsed;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export function setLLMConfig(config) {
  const ttApi = getTT();
  if (!ttApi || !ttApi.setStorageSync) {
    return false;
  }
  try {
    ttApi.setStorageSync(LLM_CONFIG_KEY, JSON.stringify(config || null));
    return true;
  } catch (error) {
    return false;
  }
}

export function clearLLMConfig() {
  return setLLMConfig(null);
}

/**
 * Provider quirks（2026-09-13 修复 empty-response）：
 * DeepSeek V4 系列默认开启"深度思考"，reasoning token 与正文共用 max_tokens 预算——
 * 小预算（我们原来 64/80）会被思维链吃光，返回 HTTP 200 但 content 为空。
 * 对策：① DeepSeek 显式关思考（官方 OpenAI 兼容参数 thinking:{type:'disabled'}，
 *         其他兼容端点按惯例忽略未知字段）；
 * ② 输出一律抬到 ≥1024 兜底（覆盖 deepseek-reasoner 这类关不掉思考的模型；
 *      一句墓志铭/台词的实际输出远小于此，多给预算不增加实际费用）。
 */
export function applyLLMQuirks(config, body) {
  body.max_tokens = Math.max(body.max_tokens || 0, 1024);
  const hint = String((config && config.model) || '') + ' ' + String((config && config.baseUrl) || '');
  if (/deepseek/i.test(hint)) {
    body.thinking = { type: 'disabled' };
  }
  return body;
}

// 把对局数据压成一段"喂给模型的人生档案"。控制体积，只给叙事需要的部分。
function buildEpitaphBrief(gameData) {
  const lines = [];
  const cats = gameData.categorySpent || {};
  const sorted = Object.keys(cats)
    .map(function (id) { return { id: id, spent: cats[id] }; })
    .filter(function (c) { return c.spent > 0; })
    .sort(function (a, b) { return b.spent - a.spent; });
  const total = sorted.reduce(function (acc, c) { return acc + c.spent; }, 0) || 1;
  sorted.slice(0, 5).forEach(function (c) {
    lines.push('- ' + c.id + '：' + Math.round(c.spent / total * 100) + '%');
  });
  const zero = sorted.length === 0 ? Object.keys(cats) : [];
  lines.push('（几乎没花时间的方向：' + (gameData.lowCategories || zero).join('、') + '）');
  const products = (gameData.topProducts || []).slice(0, 6).map(function (p) {
    return typeof p === 'string' ? p : (p.name || p.id || '');
  }).filter(Boolean);
  if (products.length) {
    lines.push('（买过的代表：' + products.join('、') + '）');
  }
  const creeds = (gameData.creeds || []).slice(0, 3);
  if (creeds.length) {
    lines.push('（TA 在人生岔路口立下的信条：' + creeds.join('；') + '）');
  }
  lines.push('（结局：' + (gameData.endReason === 'time-out' ? '寿终正寝' : '天数耗尽') +
    '，共消费 ' + (gameData.totalSpent || 0) + ' 天）');
  return lines.join('\n');
}

export function buildEpitaphMessages(gameData) {
  const lang = getLang() === 'en' ? 'English' : '中文';
  const system = '你是一位为人生模拟器游戏写墓志铭的撰稿人。风格要求：' + lang + '，不超过50个字，' +
    '一句话，要直击人心——或犀利、或温柔、或有反差感。必须包含至少一个来自这位玩家人生里的具体数字或具体物品名，' +
    '禁止泛泛而谈的鸡汤与说教，禁止出现"墓志铭"三个字本身，禁止引号包裹。' +
    '只输出这一句话，不要任何解释。';
  const user = '这位玩家的一生（时间为货币，共30000天）：\n' + buildEpitaphBrief(gameData) +
    '\n请为 TA 写下这一生的一句话。';
  return { system: system, user: user };
}

function sanitizeComment(text) {
  let out = String(text || '').trim();
  out = out.replace(/^["“「『]+|["”」』]+$/g, '').trim();
  out = out.replace(/[\r\n]+/g, ' ').trim();
  if (out.length > MAX_COMMENT_CHARS) {
    // LLM 不守字数规矩是常态：截到 50 内最近的句读（连同标点保留），兜底硬截。
    const window = out.slice(0, MAX_COMMENT_CHARS);
    const cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'),
      window.lastIndexOf('.'), window.lastIndexOf('!'), window.lastIndexOf('?'));
    out = (cut >= 20 ? window.slice(0, cut + 1) : window).trim();
  }
  return out;
}

/**
 * 一次"短输出"BYOK 调用的共享原语：配置检查 → 额度门禁 → fetch → usage 回填/退款 → 超时。
 * messages:{system,user}; opts:{temperature, maxTokens(输出余量估算), timeoutMs}。
 * 返回 { ok, text?, error? }。无配置 → ok:false, error:'no-config'（离线路径正常信号）。
 * 调用方负责各自的清洗（墓志铭去引号截断 / 摸鱼控字数 / 信条取值）。
 */
export function runQuickLLM(messages, opts) {
  const config = getLLMConfig();
  if (!config) {
    return Promise.resolve({ ok: false, error: 'no-config' });
  }
  const options = opts || {};
  const outHeadroom = options.maxTokens != null ? options.maxTokens : 60;
  const estimate = estimateTokens(String(messages.system || '') + String(messages.user || '')) + outHeadroom;
  const gate = tryConsumeBudget(estimate);
  if (!gate.allowed) {
    return Promise.resolve({ ok: false, error: gate.reason, used: gate.used, budget: gate.budget });
  }
  const url = String(config.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user }
    ],
    temperature: options.temperature != null ? options.temperature : 0.9,
    max_tokens: 64
  };
  applyLLMQuirks(config, body);

  let timedOut = false;
  const timeout = new Promise(function (resolve) {
    setTimeout(function () {
      timedOut = true;
      resolve({ ok: false, error: 'timeout' });
    }, options.timeoutMs || REQUEST_TIMEOUT_MS);
  });

  const call = fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.apiKey
    },
    body: JSON.stringify(body)
  })
    .then(function (res) {
      if (!res.ok) {
        // 鉴权失败 = 请求没产生费用，退回预估扣额
        if (res.status === 401 || res.status === 403) {
          refundBudget(estimate);
        }
        return { ok: false, error: 'http-' + res.status };
      }
      return res.json().then(function (data) {
        const actual = data && data.usage && Number(data.usage.total_tokens);
        reconcileUsage(estimate, actual);
        const choice = data && data.choices && data.choices[0];
        const content = choice && choice.message && choice.message.content;
        if (!content || !String(content).trim()) {
          // 细分错误信号：choices 缺失 vs 思考吃光预算（finish_reason=length 且正文空）。
          return { ok: false, error: choice ? 'empty-content:' + (choice.finish_reason || '?') : 'no-choices' };
        }
        return { ok: true, text: String(content) };
      });
    })
    .catch(function (error) {
      // 网络层失败 = 请求未送达，退回预估（超时不退回：服务端可能已在计费）
      refundBudget(estimate);
      return { ok: false, error: (error && error.message) || 'network' };
    });

  return Promise.race([call, timeout]).then(function (result) {
    if (timedOut) {
      return { ok: false, error: 'timeout' };
    }
    return result;
  });
}

// 轻量敏感词兜底（平台合规线）：命中即整条作废走本地降级——
// 宁可少一句金句，不多一行风险。主防线在 prompt，这里是代码层保险。
const BLOCKED_PATTERNS = [
  '傻逼', '妈的', '去死', '自杀', '自残',
  '白痴', '废物', '畜生', '王八', 'nmsl'
];

export function containsBlockedWords(text) {
  const lower = String(text || '').toLowerCase();
  return BLOCKED_PATTERNS.some(function (word) {
    return lower.indexOf(word.toLowerCase()) >= 0;
  });
}

/**
 * BYOK 墓志铭。返回 { ok, comment?, error? }。
 * 无配置直接 ok:false —— 这不是故障，是离线模式的正常路径。
 */
export function requestLLMEpitaph(gameData) {
  const messages = buildEpitaphMessages(gameData);
  return runQuickLLM(messages, { temperature: 0.9, maxTokens: 60 }).then(function (r) {
    if (!r.ok) {
      return r;
    }
    const comment = sanitizeComment(r.text);
    if (!comment) {
      return { ok: false, error: 'empty-content' };
    }
    return { ok: true, comment: comment };
  });
}

// —— N6 摸鱼吐槽：一局一次带上下文，≤40 字毒舌，失败/敏感词由调用方降级本地池 ——
export function buildRoastMessages(roastData) {
  const lang = getLang() === 'en' ? 'English' : '中文';
  const system = '你在为人生模拟器游戏写一句"摸鱼被抓"的毒舌吐槽。要求：' + lang + '，不超过40个字（英文不超过18词），' +
    '一句话，冷幽默、扎心但不辱骂，必须与玩家这一局的真实消费数据有关，禁止说教，禁止引号，只输出这一句。';
  const user = '玩家人生数据：已花 ' + (roastData.totalSpent || 0) + ' 天；' +
    '买过最多的方向：' + (roastData.topCategory || '没有') + '；最荒疏的方向：' + (roastData.lowCategories || []).join('、') + '；' +
    (roastData.focusProduct ? '反复购买：' + roastData.focusProduct + '；' : '') +
    '这次摸鱼浪费 ' + (roastData.lostDays || 0) + ' 天。写这句吐槽。';
  return { system: system, user: user };
}

export function requestLLMRoast(roastData) {
  const messages = buildRoastMessages(roastData);
  return runQuickLLM(messages, { temperature: 1.0, maxTokens: 50, timeoutMs: 8000 }).then(function (r) {
    if (!r.ok) {
      return r;
    }
    let text = String(r.text || '').trim()
      .replace(/^["“「『]+|["”」』]+$/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim();
    // 只取第一句，40 字硬顶（摸鱼提示停留短，长文等于没读）
    const cut = text.search(/[。！？.!?]/);
    if (cut > 0 && cut < 40) {
      text = text.slice(0, cut + 1);
    }
    if (!text || text.length > 44 || containsBlockedWords(text)) {
      return { ok: false, error: 'roast-rejected' };
    }
    return { ok: true, text: text };
  });
}

// —— N3 人生信条：把刚做完的抉择命名成一句话（≤20 字），由调用方写入 decisionLog ——
export function buildCreedMessages(creedData) {
  const lang = getLang() === 'en' ? 'English' : '中文';
  const system = '玩家刚在人生模拟器里做完一个重大抉择。用' + lang + '替他把这个选择凝练成一句"人生信条"，' +
    '不超过20个字（英文不超过10词），第一人称（"我要…/我不再…"），有决心感，不喊口号，禁止引号，只输出这一句。';
  const user = '抉择：' + (creedData.choiceText || '') + '——' + (creedData.choiceDesc || '') +
    '（人生第 ' + (creedData.consumedDays || 0) + ' 天，此前主要把时间花在 ' + (creedData.topCategory || '没有') + '）。' +
    '写这句信条。';
  return { system: system, user: user };
}

export function requestLLMCreed(creedData) {
  const messages = buildCreedMessages(creedData);
  return runQuickLLM(messages, { temperature: 0.95, maxTokens: 40, timeoutMs: 8000 }).then(function (r) {
    if (!r.ok) {
      return r;
    }
    let text = String(r.text || '').trim()
      .replace(/^["“「『]+|["”」』]+$/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim();
    if (!text || text.length > 26 || containsBlockedWords(text)) {
      return { ok: false, error: 'creed-rejected' };
    }
    return { ok: true, creed: text };
  });
}

// —— N4/N5 场景改写：AI 把际遇/奇遇的"标题+描述"按这局人生重新讲述 ——
// 铁律：只改叙事文案，触发、数值、选项及其效果永远归代码；校验失败静默保留原文案。
export function buildRewriteMessages(sceneData) {
  const lang = getLang() === 'en' ? 'English' : '中文';
  const system = '你在为人生模拟器游戏改写一段场景旁白（类型：' + (sceneData.kind || '际遇') + '）。' +
    '用' + lang + '输出严格 JSON：{"title":"不超12字的标题","desc":"不超120字的场景描述，保留原文中的数值与后果"}。' +
    '让描述与玩家的人生经历产生呼应，但不得改变事件的性质、数字与选项。禁止输出 JSON 以外的任何字符。';
  const user = '原场景：' + (sceneData.title || '') + ' —— ' + (sceneData.desc || '') +
    '\n玩家人生近况：' + (sceneData.brief || '') + '\n输出 JSON。';
  return { system: system, user: user };
}

function parseRewriteJSON(text) {
  const raw = String(text || '')
    .replace(/```(json)?/gi, '')
    .trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (error) {
    return null;
  }
}

export function requestSceneRewrite(sceneData) {
  const messages = buildRewriteMessages(sceneData);
  return runQuickLLM(messages, { temperature: 0.9, maxTokens: 160, timeoutMs: 10000 }).then(function (r) {
    if (!r.ok) {
      return r;
    }
    const obj = parseRewriteJSON(r.text);
    const title = obj && String(obj.title || '').trim().replace(/^["“「『]+|["”」』]+$/g, '');
    const desc = obj && String(obj.desc || '').trim().replace(/[\r\n]+/g, ' ');
    if (!title || title.length > 14 || !desc || desc.length < 12 || desc.length > 140 ||
      containsBlockedWords(title + ' ' + desc)) {
      return { ok: false, error: 'rewrite-rejected' };
    }
    return { ok: true, title: title, desc: desc };
  });
}

// —— N8 前世回响：把最近几世的墓志铭凝练成开局一句话 ——
export function buildEchoMessages(pastLines) {
  const lang = getLang() === 'en' ? 'English' : '中文';
  const system = '人生模拟器游戏中，玩家即将投胎转世。已知他前几世的墓志铭。' +
    '用' + lang + '写一句"前世回响"作为开局的旁白：不超过28个字（英文不超过14词），' +
    '有宿命感、不阴森，呼应前几世但不逐条复述，禁止引号，只输出这一句。';
  const user = pastLines.map(function (line, i) {
    return '第 ' + (i + 1) + ' 条：' + line;
  }).join('\n') + '\n写这句回响。';
  return { system: system, user: user };
}

export function requestPastLifeEcho(pastLines) {
  const messages = buildEchoMessages(pastLines);
  return runQuickLLM(messages, { temperature: 0.95, maxTokens: 50, timeoutMs: 8000 }).then(function (r) {
    if (!r.ok) {
      return r;
    }
    let text = String(r.text || '').trim()
      .replace(/^["“「『]+|["”」』]+$/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim();
    if (!text || text.length > 34 || containsBlockedWords(text)) {
      return { ok: false, error: 'echo-rejected' };
    }
    return { ok: true, echo: text };
  });
}

// ============ 浏览器内设置面板（canvas 之外的一层薄 DOM） ============
// 说明：canvas 里做文字输入性价比极低；v0.2 用一层与游戏同风格的 DOM 浮层。
// 抖音版不会加载本模块（main.js 不 import 它，只有 web 入口与设置按钮路径会用到）。

let _panelEl = null;

export function openLLMSettingsPanel() {
  if (typeof document === 'undefined') {
    return false;
  }
  // 每次打开都重建：语言可能已切换，静态文案必须跟随 i18n。
  if (_panelEl) {
    _panelEl.remove();
    _panelEl = null;
  }
  const cfg = getLLMConfig() || { baseUrl: '', apiKey: '', model: '' };

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,8,20,0.82);z-index:90;' +
    'display:flex;align-items:center;justify-content:center;font-family:sans-serif';
  const panel = document.createElement('div');
  panel.style.cssText = 'width:min(92vw,360px);background:rgba(15,25,55,0.98);border:1px solid rgba(233,196,106,0.6);' +
    'border-radius:22px;padding:20px 22px;color:#F5F8FF';
  panel.innerHTML =
    '<div style="font:bold 17px sans-serif;color:#F7E2A0">' + t('byok.title') + '</div>' +
    '<div style="font:11px sans-serif;color:#A7B4D8;margin:6px 0 14px;line-height:1.5">' +
    t('byok.desc') + '</div>' +
    '<label style="font:12px sans-serif;color:#A7B4D8">' + t('byok.preset') + '</label>' +
    '<select id="tbPreset" style="width:100%;margin:4px 0 10px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#F5F8FF">' +
    LLM_PRESETS.map(function (p) { return '<option value="' + p.id + '">' + t(p.nameKey) + '</option>'; }).join('') +
    '</select>' +
    '<label style="font:12px sans-serif;color:#A7B4D8">' + t('byok.baseUrl') + '</label>' +
    '<input id="tbBase" value="' + (cfg.baseUrl || '') + '" placeholder="https://api.deepseek.com/v1" style="width:100%;box-sizing:border-box;margin:4px 0 10px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#F5F8FF">' +
    '<label style="font:12px sans-serif;color:#A7B4D8">API Key</label>' +
    '<input id="tbKey" type="password" value="' + (cfg.apiKey || '') + '" placeholder="sk-..." style="width:100%;box-sizing:border-box;margin:4px 0 10px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#F5F8FF">' +
    '<label style="font:12px sans-serif;color:#A7B4D8">Model</label>' +
    '<input id="tbModel" value="' + (cfg.model || '') + '" placeholder="deepseek-chat" style="width:100%;box-sizing:border-box;margin:4px 0 10px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#F5F8FF">' +
    '<label style="font:12px sans-serif;color:#A7B4D8">' + t('byok.budget') + '</label>' +
    '<input id="tbBudget" type="number" min="0" value="' + (cfg.tokenBudget || 0) + '" placeholder="200000" style="width:100%;box-sizing:border-box;margin:4px 0 4px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#F5F8FF">' +
    '<div style="font:11px sans-serif;color:#7D9CFF;margin-bottom:10px">' + t('byok.budgetUsed', { u: usage.used.toLocaleString() }) + '</div>' +
    '<div id="tbStatus" style="font:11px sans-serif;color:#7D9CFF;min-height:16px;margin-bottom:8px"></div>' +
    '<div style="display:flex;gap:10px">' +
    '<button id="tbSave" style="flex:1;padding:10px;border-radius:14px;border:none;background:rgba(233,196,106,0.25);color:#F7E2A0;font:bold 14px sans-serif;cursor:pointer">' + t('byok.save') + '</button>' +
    '<button id="tbTest" style="flex:1;padding:10px;border-radius:14px;border:1px solid #5B8CFF;background:rgba(91,140,255,0.15);color:#A7C4FF;font:bold 14px sans-serif;cursor:pointer">' + t('byok.test') + '</button>' +
    '<button id="tbClose" style="flex:1;padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,0.25);background:none;color:#A7B4D8;font:14px sans-serif;cursor:pointer">' + t('byok.close') + '</button>' +
    '</div>';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  _panelEl = overlay;

  const el = function (id) { return panel.querySelector('#' + id); };
  const status = function (text, ok) {
    el('tbStatus').textContent = text;
    el('tbStatus').style.color = ok === false ? '#FF8FA3' : ok === true ? '#7BC67E' : '#7D9CFF';
  };
  el('tbPreset').addEventListener('change', function () {
    const preset = LLM_PRESETS.find(function (p) { return p.id === el('tbPreset').value; });
    if (preset && preset.id !== 'custom') {
      el('tbBase').value = preset.baseUrl;
      el('tbModel').value = preset.model;
      status(preset.cors ? '' : t('byok.corsWarn'), preset.cors ? null : false);
    }
  });
  el('tbClose').addEventListener('click', function () { overlay.style.display = 'none'; });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) { overlay.style.display = 'none'; } });
  el('tbSave').addEventListener('click', function () {
    const next = {
      baseUrl: el('tbBase').value.trim(),
      apiKey: el('tbKey').value.trim(),
      model: el('tbModel').value.trim(),
      tokenBudget: Math.max(0, parseInt(el('tbBudget').value, 10) || 0)
    };
    if (!next.baseUrl || !next.apiKey || !next.model) {
      status(t('byok.fillThree'), false);
      return;
    }
    setLLMConfig(next);
    status(t('byok.saved'), true);
  });
  el('tbTest').addEventListener('click', function () {
    const next = {
      baseUrl: el('tbBase').value.trim(),
      apiKey: el('tbKey').value.trim(),
      model: el('tbModel').value.trim()
    };
    setLLMConfig(next.baseUrl && next.apiKey && next.model ? next : null);
    status(t('byok.testing', { m: next.model || '?' }));
    requestLLMEpitaph({
      categorySpent: { career: 12000, health: 100, family: 900 },
      totalSpent: 13000,
      endReason: 'empty',
      lowCategories: ['health', 'fun'],
      topProducts: [{ name: '996 的福报' }, { name: '一次说走就走的旅行' }]
    }).then(function (r) {
      if (r.ok) {
        status('🤖 ' + r.comment, true);
      } else {
        const err = String(r.error || '');
        let hint = '';
        if (err === 'network') { hint = t('byok.corsHint'); }
        else if (err.indexOf('empty-content') === 0 || err === 'no-choices') { hint = t('byok.thinkingHint'); }
        else if (err === 'http-401' || err === 'http-403') { hint = t('byok.keyHint'); }
        status(t('byok.failPrefix') + err + hint, false);
      }
    });
  });
  const langRow = document.createElement('button');
  langRow.textContent = t('platform.lang');
  langRow.style.cssText = 'margin-top:10px;width:100%;padding:6px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:none;color:#A7B4D8;font:12px sans-serif;cursor:pointer';
  langRow.addEventListener('click', function () {
    toggleLang();
    openLLMSettingsPanel(); // 重建以刷新全部文案
  });
  panel.appendChild(langRow);
  const clearBtn = document.createElement('button');
  clearBtn.textContent = t('byok.clear');
  clearBtn.style.cssText = 'margin-top:8px;width:100%;padding:6px;border-radius:10px;border:none;background:none;color:#6A7B8D;font:11px sans-serif;cursor:pointer;text-decoration:underline';
  clearBtn.addEventListener('click', function () {
    clearLLMConfig();
    el('tbKey').value = '';
    status(t('byok.cleared'), null);
  });
  panel.appendChild(clearBtn);
  return true;
}
