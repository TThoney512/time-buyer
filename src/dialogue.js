// Module: dialogue.js
// v0.3 里程碑「抉择前对话」—— 三个岔路口，各有一位"人"先跟你说话：
//   第 1 次（1500 天）：父亲；第 2 次（8000 天）：老友；第 3 次（15000 天）：镜中的自己。
// 设计铁律（延续 v0.2 离线=默认体验）：
//   1. 无 BYOK 时走 LOCAL_SCRIPTS 固定台词 —— 对话**永远发生**，AI 只是让台词更"懂你这局"；
//   2. 有 BYOK 时让模型以该人格重写 3 句台词（一次请求拿全部，省调用次数）；
//      失败/超时/格式不对 → 静默换回本地台词，玩家视角只是"他开口了"；
//   3. 本模块不 import ui.js；GAME_STATE 由调用方（logic/ui）传入，保持叶子友好。

import { getLang, t } from './i18n.js';
import { applyLLMQuirks, estimateTokens, getLLMConfig, reconcileUsage, tryConsumeBudget } from './llm.js';

export const DIALOGUE_SPEAKERS = ['father', 'friend', 'mirror'];

// 本地固定台词（zh/en 双语，键与 i18n 的 dlg.fallback.* 对应）。
const LOCAL_SCRIPTS = {
  father: {
    zh: [
      '孩子，路是自己选出来的。钱花在哪儿，人就是哪儿。',
      '有点样子了。别飘——顺势而为，还是把短处补上？',
      '最后一步。要么做到极致，要么把时间本身拿回来。'
    ],
    en: [
      'Kid, a road is chosen, not found. Spend on what, and you become that.',
      'Not bad. Don\'t get cocky — ride the momentum, or fix the weak side?',
      'Last step. Master one thing utterly, or take time itself back.'
    ]
  },
  friend: {
    zh: [
      '哟，花出名气了？接下来是加码猛冲，还是补补短板？',
      '都小有成就了！要不要干脆全都要，稳字当头？',
      '巅峰就眼前——大师之路还是传奇权限，替我选个爽的！'
    ],
    en: [
      'Well well, you\'re spending like someone now! Double down, or patch the holes?',
      'Small fame already! Why not have it all — steady wins?',
      'Peak\'s in sight — master title or legendary pass? Pick a fun one for me!'
    ]
  },
  mirror: {
    zh: [
      '你买下的每一样，都成了你。下一个岔口，你想成为谁？',
      '你已经不是当初那个人。继续锋利，还是转向完整？',
      '这一生只剩一个定义权。你要哪一种？'
    ],
    en: [
      'Everything you bought became you. At the next fork — who do you want to be?',
      'You are not the person you were. Stay sharp, or turn whole?',
      'One definition left for this life. Which one?'
    ]
  }
};

export function getDialogueSpeakerAt(milestoneIndex) {
  return DIALOGUE_SPEAKERS[Math.max(0, Math.min(2, milestoneIndex | 0))];
}

export function localDialogueLines(speaker, milestoneIndex) {
  const script = LOCAL_SCRIPTS[speaker] || LOCAL_SCRIPTS.father;
  const lang = getLang() === 'en' ? 'en' : 'zh';
  const idx = Math.max(0, Math.min(2, milestoneIndex | 0));
  return [script[lang][idx]]; // 每位人格此刻只说一句（衔接其后的抉择面板）
}

function lifeBrief(gameData) {
  const cats = gameData.categorySpent || {};
  const sorted = Object.keys(cats)
    .map(function (id) { return { id: id, spent: cats[id] }; })
    .filter(function (c) { return c.spent > 0; })
    .sort(function (a, b) { return b.spent - a.spent; });
  const total = sorted.reduce(function (acc, c) { return acc + c.spent; }, 0) || 1;
  const top = sorted.slice(0, 3).map(function (c) {
    return c.id + ' ' + Math.round(c.spent / total * 100) + '%';
  }).join(', ');
  const low = sorted.slice(-2).map(function (c) { return c.id; }).join(', ');
  return 'spend: ' + (gameData.totalSpent || 0) + ' days; top [' + top + ']; low [' + low + ']';
}

function parseLines(content, fallback) {
  const text = String(content || '').trim()
    .replace(/^["“「『]+|["”」』]+$/g, '');
  const line = text.split(/[\r\n]+/)[0].trim();
  if (!line || line.length > 120) {
    return fallback;
  }
  return [line];
}

/**
 * 生成某位人格在某个里程碑的对话台词。
 * 返回 Promise<{ speaker, lines: string[], ai: boolean }>。
 * 无 BYOK → 立即 resolve 本地台词（ai:false）。
 */
export function buildMilestoneDialogue(speaker, milestoneIndex, gameData) {
  const fallback = localDialogueLines(speaker, milestoneIndex);
  const config = getLLMConfig();
  if (!config) {
    return Promise.resolve({ speaker: speaker, lines: fallback, ai: false });
  }
  const lang = getLang() === 'en' ? 'English' : '中文';
  const persona = {
    father: { zh: '一位话不多但句句落地的父亲', en: 'a taciturn father whose words land heavy' },
    friend: { zh: '一位插科打诨却懂你的多年老友', en: 'a joking old friend who secretly reads you' },
    mirror: { zh: '镜中的自己——冷静、不客气', en: 'the player\'s own reflection — calm and ruthless' }
  }[speaker] || { zh: '一位长辈', en: 'an elder' };
  const system = '你在为人生模拟器游戏写一句过场台词。说话者身份：' + persona[lang === '中文' ? 'zh' : 'en'] +
    '。要求：只用' + lang + '输出**一行**台词，不超过40字（英文不超过20词），' +
    '口语化、有性格、禁止说教、禁止引号、禁止解释。只写"在人生岔路口前"对玩家说的一句话。';
  const user = '玩家此刻刚消费掉约 ' + (gameData.totalSpent || 0) + ' 天（寿命即货币）。' +
    lifeBrief(gameData) + '\n写这句台词。';
  // 额度门禁：耗尽时静默走本地台词（岔路口不该被弹窗打断），结算页才弹选择框。
  const estimate = estimateTokens(system + user) + 60;
  const gate = tryConsumeBudget(estimate);
  if (!gate.allowed) {
    return Promise.resolve({ speaker: speaker, lines: fallback, ai: false, overBudget: true });
  }
  const url = String(config.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 1.0,
    max_tokens: 80
  };
  applyLLMQuirks(config, body);
  const timed = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, 12000);
  });
  const call = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
    body: JSON.stringify(body)
  })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      const actual = data && data.usage && Number(data.usage.total_tokens);
      reconcileUsage(estimate, actual);
      const content = data && data.choices && data.choices[0] &&
        data.choices[0].message && data.choices[0].message.content;
      if (!content) { return null; }
      return parseLines(content, fallback);
    })
    .catch(function () { refundBudget(estimate); return null; });

  return Promise.race([call, timed]).then(function (lines) {
    if (!lines) {
      return { speaker: speaker, lines: fallback, ai: false };
    }
    return { speaker: speaker, lines: lines, ai: true };
  });
}

// 测试钩子：直接请求 AI 改写台词（冒烟里 mock OpenAI 服务端验证 ai:true 路径）
export function _requestDialogueAI(speaker, milestoneIndex, gameData) {
  return buildMilestoneDialogue(speaker, milestoneIndex, gameData);
}

// 冒烟/调试用：导出本地台词表
export { LOCAL_SCRIPTS };
