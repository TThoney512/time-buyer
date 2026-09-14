// Module: replay.js（v0.4 人生回放导出）
// 把 GAME_STATE 里已有的三张日志（purchaseLedger / randomEventLog / decisionLog）
// 合并成一条按"人生第 N 天"排序的时间线，导出 Markdown。
// 架构红线：本模块是叶子——只 import config/db/utils/i18n/state 级别的纯数据模块，
// 绝不 import ui/settlement（防 TDZ 环）。墓志铭文本由调用方传入。
// 内容层约定：商品/事件名保持中文（范围 A），壳层标题跟随当前界面语言。

import { CATEGORY_META, DECISION_MILESTONES_V2, GAME_CONFIG } from './config.js';
import { getProductById } from './db.js';
import { getGlobalStats } from './state.js';
import { fmtDays, getLang } from './i18n.js';

const EN = function () {
  return getLang() === 'en';
};

// Markdown 表格单元格转义：AI 生成的墓志铭或事件名里的 "|" 会撕破表格。
function cell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

// —— 时间线合并 ——
// purchaseLedger 自 v0.4 起带 consumedDays；旧局/缺字段用 elapsedSeconds 线性回退估算，
// 保证"200 天买的技能"不会排在"50 天买的面包"前面。
function timelineEntries(state) {
  const startDays = state.startingDays || GAME_CONFIG.initialDays;
  const roundSeconds = GAME_CONFIG.roundSeconds || 900;
  const estimate = function (item) {
    if (typeof item.consumedDays === 'number') {
      return item.consumedDays;
    }
    if (typeof item.consumedDaysAt === 'number') {
      return item.consumedDaysAt;
    }
    const sec = item.elapsedSeconds || 0;
    return Math.round(startDays * Math.min(1, sec / roundSeconds));
  };
  const out = [];
  (state.purchaseLedger || []).forEach(function (item) {
    const product = getProductById(item.productId);
    out.push({
      day: estimate(item),
      kind: 'buy',
      text: (item.source === 'decision' ? '🎯 ' : '🛒 ') + (product ? product.name : item.productId),
      days: item.price
    });
  });
  (state.randomEventLog || []).forEach(function (item) {
    let text = '🎲 ' + (item.name || item.eventId);
    if (item.shielded) {
      text += EN() ? ' (shielded)' : '（已挡）';
    }
    out.push({
      day: estimate(item),
      kind: 'event',
      text: text,
      delta: item.currencyChange || 0
    });
  });
  (state.decisionLog || []).forEach(function (item) {
    const milestone = DECISION_MILESTONES_V2.find(function (m) {
      return m.id === item.milestoneId;
    });
    let text = '⏭️ ';
    if (item.gaveUp) {
      text += EN() ? 'Crossroads skipped' : '岔路口，没有作答';
    } else {
      const choice = milestone
        ? (milestone.choices || []).find(function (c) { return c.id === item.choiceId; })
        : null;
      text += (milestone ? '「' + milestone.title + '」' : '') + (choice ? choice.text : (item.choiceId || '?'));
      if (item.creed) {
        text += (EN() ? ' — "' : ' — 「') + item.creed + (EN() ? '"' : '」');
      }
      if (item.productId) {
        const p = getProductById(item.productId);
        if (p) {
          text += ' → ' + p.name;
        }
      }
    }
    out.push({ day: estimate(item), kind: 'decision', text: text });
  });
  out.sort(function (a, b) {
    return a.day - b.day || (a.kind === 'decision' ? -1 : 1);
  });
  return out;
}

// —— Markdown 构建（纯函数，Node 可测）——
export function buildLifeReplayMarkdown(state, epigraph) {
  if (!state) {
    return '';
  }
  const en = EN();
  const startDays = state.startingDays || GAME_CONFIG.initialDays;
  const remaining = Math.max(0, state.remainingDays || 0);
  const consumed = Math.max(0, startDays - remaining);
  const global = getGlobalStats();
  const lifeNo = (global.totalPlayCount || 0);
  const lines = [];
  const hr = '---';

  lines.push('# ' + (en ? 'Time Buyer · Life Replay' : '时间买手 · 人生回放'));
  lines.push('');
  lines.push('> ' + (en
    ? 'My time, my call. — 30,000 days was all I had.'
    : '我的时间，由我支配 —— 我一生拥有 30,000 天。'));
  lines.push('');
  lines.push('## ' + (en ? 'Vital records' : '人生档案'));
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| ' + (en ? 'Life #' : '这是第') + ' | ' + lifeNo + (en ? '' : ' 世') + ' |');
  const endReason = state.endReason === 'time-out'
    ? (en ? 'Clock ran out (15 min of lived time)' : '钟声落下，15 分钟的一生过完（寿终）')
    : (en ? 'Days exhausted' : '天数耗尽');
  lines.push('| ' + (en ? 'Ending' : '结局') + ' | ' + endReason + ' |');
  lines.push('| ' + (en ? 'Days spent' : '花掉') + ' | ' + fmtDays(Math.floor(consumed)) + ' |');
  lines.push('| ' + (en ? 'Days left' : '剩余') + ' | ' + fmtDays(Math.floor(remaining)) + ' |');
  const owned = (state.ownedProductIds || []).length;
  lines.push('| ' + (en ? 'Things owned' : '拥有之物') + ' | ' + owned + (en ? '' : ' 件') + ' |');
  const events = (state.randomEventLog || []).length;
  lines.push('| ' + (en ? 'Random events met' : '际遇') + ' | ' + events + (en ? '' : ' 次') + ' |');
  if (epigraph) {
    lines.push('| ' + (en ? 'Epitaph' : '墓志铭') + ' | “' + cell(epigraph) + '” |');
  }
  lines.push('');

  lines.push('## ' + (en ? 'Where the days went' : '时间都去哪儿了'));
  lines.push('');
  lines.push('| ' + (en ? 'Category' : '类目') + ' | ' + (en ? 'Days' : '天数') + ' | % | ' + (en ? 'Items' : '件数') + ' |');
  lines.push('|---|---:|---:|---:|');
  const categorySpent = state.categorySpent || {};
  const totalSpent = state.totalSpent || 0;
  CATEGORY_META.forEach(function (meta) {
    const spent = categorySpent[meta.id] || 0;
    if (spent <= 0) {
      return;
    }
    const pct = totalSpent > 0 ? Math.round(spent / totalSpent * 100) : 0;
    lines.push('| ' + meta.emoji + ' ' + meta.name + ' | ' + Math.floor(spent).toLocaleString() + ' | ' + pct + '% | ' + (state.categoryPurchaseCount && state.categoryPurchaseCount[meta.id] || 0) + ' |');
  });
  if (totalSpent <= 0) {
    lines.push('| ' + (en ? '(spent nothing)' : '（一生什么都没买）') + ' | 0 | 0% | 0 |');
  }
  lines.push('');

  lines.push('## ' + (en ? 'Timeline' : '一生大事记'));
  lines.push('');
  lines.push(en ? '_Day 0 = birth. 30,000 days ≈ one lifespan._' : '_第 0 天 = 出生，30,000 天 ≈ 一生。_');
  lines.push('');
  const entries = timelineEntries(state);
  lines.push('| ' + (en ? 'Day' : '人生第几天') + ' | ' + (en ? 'Event' : '发生了什么') + ' | ' + (en ? 'Days' : '天') + ' |');
  lines.push('|---:|---|---:|');
  entries.forEach(function (e) {
    let tail = '';
    if (typeof e.days === 'number') {
      tail = '-' + Math.floor(e.days).toLocaleString();
    } else if (typeof e.delta === 'number' && e.delta !== 0) {
      tail = (e.delta > 0 ? '+' : '') + Math.floor(e.delta).toLocaleString();
    }
    lines.push('| ' + Math.floor(e.day).toLocaleString() + ' | ' + cell(e.text) + ' | ' + tail + ' |');
  });
  lines.push('');
  lines.push(hr);
  lines.push('');
  lines.push(en
    ? '_Exported from [Time Buyer](https://github.com/TThoney512/time-buyer) — an open-source life simulator._'
    : '_本文由开源人生模拟器「时间买手」导出——你的一生值得被完整记录。_');
  return lines.join('\n');
}

// —— 下载：Blob + a[download]。Node/无 DOM 环境返回 false（冒烟只测构建器）。——
export function downloadTextFile(filename, text) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return false;
  }
  try {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
    return true;
  } catch (error) {
    return false;
  }
}

// —— 剪贴板：navigator.clipboard 需要安全上下文（https/localhost）。
// http://127.0.0.1 或 file:// 下浏览器禁用该 API——降级 textarea+execCommand。——
export function copyTextToClipboard(text) {
  return new Promise(function (resolve) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        resolve(true);
      }, function () {
        resolve(fallbackCopy(text));
      });
      return;
    }
    resolve(fallbackCopy(text));
  });
}

function fallbackCopy(text) {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (error) {
    return false;
  }
}

// 组合动作：先下载、再尽力复制；返回 {downloaded, copied} 供 toast 措辞。
export function exportLifeReplay(state, epigraph) {
  const global = getGlobalStats();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = 'time-buyer-life-' + (global.totalPlayCount || 0) + '-' + stamp + '.md';
  const markdown = buildLifeReplayMarkdown(state, epigraph);
  const downloaded = downloadTextFile(filename, markdown);
  return copyTextToClipboard(markdown).then(function (copied) {
    return { ok: markdown.length > 0, downloaded: downloaded, copied: copied, filename: filename };
  });
}
